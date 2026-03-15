import { Cron } from 'croner';
import type Database from 'better-sqlite3';

import { listCards } from '../registry/store.js';
import { getSkillRequestCount } from '../registry/request-log.js';
import { updateSkillAvailability, updateSkillIdleRate } from '../registry/store.js';
import { getAutonomyTier, insertAuditEvent, DEFAULT_AUTONOMY_CONFIG } from './tiers.js';
import type { AutonomyConfig } from './tiers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration options for the IdleMonitor.
 */
export interface IdleMonitorOptions {
  /** The agent owner identifier — only cards owned by this owner are monitored. */
  owner: string;
  /** Open database instance (from AgentRuntime.registryDb). */
  db: Database.Database;
  /**
   * Poll interval in milliseconds.
   * Defaults to 60_000 (60 seconds). The Cron job fires at second 0 of each minute.
   */
  pollIntervalMs?: number;
  /**
   * Idle rate threshold above which a skill is considered eligible for auto-share.
   * Defaults to 0.70 (70% idle capacity).
   */
  idleThreshold?: number;
  /**
   * Autonomy tier configuration controlling whether auto-share executes, notifies, or pends.
   * Defaults to DEFAULT_AUTONOMY_CONFIG (Tier 3 — ask-before-acting).
   */
  autonomyConfig?: AutonomyConfig;
}

// ---------------------------------------------------------------------------
// Skill shape for v2.0 cards (internal narrowing)
// ---------------------------------------------------------------------------

interface SkillRecord {
  id: string;
  availability?: { online?: boolean };
  metadata?: {
    capacity?: {
      calls_per_hour?: number;
    };
  };
  _internal?: Record<string, unknown>;
}

interface CardV2Record {
  skills?: SkillRecord[];
}

// ---------------------------------------------------------------------------
// IdleMonitor class
// ---------------------------------------------------------------------------

/**
 * IdleMonitor polls the request_log on a 60-second cadence to compute per-skill
 * idle rates. When a skill's idle rate exceeds the configured threshold and the
 * skill is currently offline, the monitor auto-shares it according to the owner's
 * autonomy tier:
 *
 * - **Tier 1**: Flips `availability.online = true` silently.
 * - **Tier 2**: Flips `availability.online = true` AND writes an audit event for notification.
 * - **Tier 3**: Writes a pending audit event only — does NOT flip availability.
 *
 * The idle rate formula is: `idle_rate = Math.max(0, 1 - count / capacity)`.
 * The `Math.max(0, ...)` clamp prevents negative rates when a skill receives
 * more requests than its stated hourly capacity.
 *
 * The monitor uses a croner Cron job constructed in paused state.
 * Call `start()` to resume it. The returned Cron instance can be passed to
 * `AgentRuntime.registerJob()` for lifecycle management.
 */
export class IdleMonitor {
  private readonly job: Cron;
  private readonly owner: string;
  private readonly db: Database.Database;
  private readonly idleThreshold: number;
  private readonly autonomyConfig: AutonomyConfig;

  /**
   * Creates a new IdleMonitor instance. The Cron job is constructed paused.
   * Call `start()` to activate polling.
   *
   * @param opts - IdleMonitor configuration options.
   */
  constructor(opts: IdleMonitorOptions) {
    this.owner = opts.owner;
    this.db = opts.db;
    this.idleThreshold = opts.idleThreshold ?? 0.70;
    this.autonomyConfig = opts.autonomyConfig ?? DEFAULT_AUTONOMY_CONFIG;

    // Cron expression: '0 * * * * *' = second 0 of every minute (6-field croner syntax)
    // Constructed paused — start() calls resume()
    this.job = new Cron('0 * * * * *', { paused: true }, () => {
      void this.poll();
    });
  }

  /**
   * Starts the Cron polling loop by resuming the paused job.
   *
   * @returns The Cron job instance, for registration with AgentRuntime.registerJob().
   */
  start(): Cron {
    this.job.resume();
    return this.job;
  }

  /**
   * Returns the underlying Cron job instance.
   * Used for testing or for registering with AgentRuntime.registerJob() without starting.
   *
   * @returns The Cron job instance.
   */
  getJob(): Cron {
    return this.job;
  }

  /**
   * Polls the registry for all v2.0 cards owned by this agent, computes per-skill
   * idle rates from the past hour of request_log data, and triggers auto-share if eligible.
   *
   * Called automatically by the Cron job every 60 seconds.
   * Can be called directly in tests without needing to wait for the timer.
   */
  async poll(): Promise<void> {
    const cards = listCards(this.db, this.owner);

    for (const card of cards) {
      // Cast to unknown first, then narrow — per project convention (no `any`)
      const maybeV2 = card as unknown as CardV2Record;
      if (!Array.isArray(maybeV2.skills)) {
        // v1.0 card (no skills[] array) — skip
        continue;
      }

      for (const skill of maybeV2.skills) {
        const capacity = skill.metadata?.capacity?.calls_per_hour ?? 60;
        const count = getSkillRequestCount(this.db, skill.id, 60 * 60 * 1000);
        const idleRate = Math.max(0, 1 - count / capacity);

        // Persist idle rate to _internal regardless of threshold or tier
        updateSkillIdleRate(this.db, card.id, skill.id, idleRate);

        // Only trigger auto-share if idle enough AND currently offline
        const isOnline = skill.availability?.online ?? false;
        if (idleRate >= this.idleThreshold && !isOnline) {
          // Auto-share costs 0 credits
          const tier = getAutonomyTier(0, this.autonomyConfig);

          if (tier === 1) {
            updateSkillAvailability(this.db, card.id, skill.id, true);
            insertAuditEvent(this.db, {
              type: 'auto_share',
              skill_id: skill.id,
              tier_invoked: 1,
              idle_rate: idleRate,
            });
          } else if (tier === 2) {
            updateSkillAvailability(this.db, card.id, skill.id, true);
            insertAuditEvent(this.db, {
              type: 'auto_share_notify',
              skill_id: skill.id,
              tier_invoked: 2,
              idle_rate: idleRate,
            });
          } else {
            // Tier 3: write pending event, do NOT flip availability
            insertAuditEvent(this.db, {
              type: 'auto_share_pending',
              skill_id: skill.id,
              tier_invoked: 3,
              idle_rate: idleRate,
            });
          }
        }
      }
    }
  }
}
