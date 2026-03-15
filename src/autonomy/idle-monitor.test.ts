import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { openDatabase } from '../registry/store.js';
import { createRequestLogTable } from '../registry/request-log.js';
import { DEFAULT_AUTONOMY_CONFIG } from './tiers.js';
import { IdleMonitor } from './idle-monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inserts a minimal v2.0 card with skills[] directly into the DB.
 * Bypasses Zod validation so we can control the exact JSON shape.
 */
function insertV2Card(
  db: Database.Database,
  opts: {
    owner: string;
    cardId?: string;
    skills: Array<{
      id: string;
      name?: string;
      online?: boolean;
      callsPerHour?: number;
    }>;
  }
): string {
  const cardId = opts.cardId ?? randomUUID();
  const now = new Date().toISOString();

  const skillsData = opts.skills.map((s) => ({
    id: s.id,
    name: s.name ?? 'Test Skill',
    description: 'A test skill',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 0 },
    availability: { online: s.online ?? false },
    metadata: {
      capacity:
        s.callsPerHour !== undefined ? { calls_per_hour: s.callsPerHour } : undefined,
    },
    _internal: {},
  }));

  const cardData = {
    spec_version: '2.0',
    id: cardId,
    owner: opts.owner,
    agent_name: 'Test Agent',
    skills: skillsData,
    availability: { online: false },
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(cardId, opts.owner, JSON.stringify(cardData), now, now);

  return cardId;
}

/**
 * Inserts a v1.0 card (flat shape, no skills[]) directly into the DB.
 */
function insertV1Card(db: Database.Database, owner: string): string {
  const cardId = randomUUID();
  const now = new Date().toISOString();

  const cardData = {
    id: cardId,
    owner,
    name: 'Legacy Skill',
    description: 'A v1.0 card',
    level: 1,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 0 },
    availability: { online: false },
    metadata: {},
  };

  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(cardId, owner, JSON.stringify(cardData), now, now);

  return cardId;
}

/**
 * Inserts a successful request_log row for a skill.
 * @param minsAgo - How many minutes ago this request occurred.
 */
function insertRequest(
  db: Database.Database,
  skillId: string,
  minsAgo = 30
): void {
  const ts = new Date(Date.now() - minsAgo * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO request_log
      (id, card_id, card_name, requester, status, latency_ms, credits_charged, created_at, skill_id, action_type, tier_invoked)
    VALUES (?, 'test-card', 'Test', 'requester', 'success', 0, 0, ?, ?, NULL, NULL)
  `).run(randomUUID(), ts, skillId);
}

/**
 * Reads a skill's JSON from the DB and returns it as a parsed record.
 */
function getSkillData(
  db: Database.Database,
  cardId: string,
  skillId: string
): Record<string, unknown> | null {
  const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as
    | { data: string }
    | undefined;
  if (!row) return null;

  const card = JSON.parse(row.data) as { skills?: Array<Record<string, unknown>> };
  return card.skills?.find((s) => s['id'] === skillId) ?? null;
}

// ---------------------------------------------------------------------------
// Tier configs for tests
// ---------------------------------------------------------------------------

const TIER1_CONFIG = { tier1_max_credits: 10, tier2_max_credits: 50 };
const TIER2_CONFIG = { tier1_max_credits: 0, tier2_max_credits: 50 };
const TIER3_CONFIG = DEFAULT_AUTONOMY_CONFIG; // { 0, 0 }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdleMonitor', () => {
  let db: Database.Database;
  const owner = 'test-owner';

  beforeEach(() => {
    db = openDatabase(':memory:');
    createRequestLogTable(db);
  });

  it('computes idle_rate = 1 - (count/capacity) and writes to _internal via updateSkillIdleRate', async () => {
    const skillId = 'skill-alpha';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, callsPerHour: 60 }] });

    // Insert 30 requests in the last hour → idle_rate = 1 - 30/60 = 0.5
    for (let i = 0; i < 30; i++) {
      insertRequest(db, skillId, 30);
    }

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    expect(skill).not.toBeNull();
    const internal = skill!['_internal'] as Record<string, unknown>;
    expect(internal['idle_rate']).toBeCloseTo(0.5, 5);
  });

  it('Tier 1: flips availability.online to true + inserts auto_share audit event', async () => {
    const skillId = 'skill-tier1';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, online: false, callsPerHour: 60 }] });
    // 0 requests → idle_rate = 1.0 >= 0.70

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER1_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    const avail = skill!['availability'] as { online: boolean };
    expect(avail.online).toBe(true);

    const auditRow = db.prepare(
      "SELECT * FROM request_log WHERE action_type = 'auto_share' AND skill_id = ?"
    ).get(skillId) as { tier_invoked: number } | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.tier_invoked).toBe(1);
  });

  it('Tier 2: flips availability.online to true + inserts auto_share_notify audit event', async () => {
    const skillId = 'skill-tier2';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, online: false, callsPerHour: 60 }] });
    // 0 requests → idle_rate = 1.0 >= 0.70

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER2_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    const avail = skill!['availability'] as { online: boolean };
    expect(avail.online).toBe(true);

    const auditRow = db.prepare(
      "SELECT * FROM request_log WHERE action_type = 'auto_share_notify' AND skill_id = ?"
    ).get(skillId) as { tier_invoked: number } | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.tier_invoked).toBe(2);
  });

  it('Tier 3: does NOT flip availability + inserts auto_share_pending audit event', async () => {
    const skillId = 'skill-tier3';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, online: false, callsPerHour: 60 }] });
    // 0 requests → idle_rate = 1.0 >= 0.70

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    const avail = skill!['availability'] as { online: boolean };
    expect(avail.online).toBe(false); // NOT flipped

    const auditRow = db.prepare(
      "SELECT * FROM request_log WHERE action_type = 'auto_share_pending' AND skill_id = ?"
    ).get(skillId) as { tier_invoked: number } | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.tier_invoked).toBe(3);
  });

  it('does not flip availability when skill is already online even if idle_rate >= threshold', async () => {
    const skillId = 'skill-already-online';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, online: true, callsPerHour: 60 }] });
    // 0 requests → idle_rate = 1.0 >= threshold, but skill is already online

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER1_CONFIG });
    await monitor.poll();

    // No audit event should be written
    const auditRow = db.prepare(
      "SELECT * FROM request_log WHERE skill_id = ? AND action_type IS NOT NULL"
    ).get(skillId);
    expect(auditRow).toBeUndefined();

    // Idle rate is still computed and stored
    const skill = getSkillData(db, cardId, skillId);
    const internal = skill!['_internal'] as Record<string, unknown>;
    expect(internal['idle_rate']).toBeDefined();
  });

  it('clamps idle_rate to Math.max(0, ...) when count exceeds capacity', async () => {
    const skillId = 'skill-over-capacity';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId, callsPerHour: 10 }] });

    // Insert 20 requests → count/capacity = 20/10 = 2 → clamped to 0
    for (let i = 0; i < 20; i++) {
      insertRequest(db, skillId, 15);
    }

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    const internal = skill!['_internal'] as Record<string, unknown>;
    expect(internal['idle_rate']).toBe(0);
  });

  it('multi-skill card: busy skill is not shared while idle sibling IS shared (Tier 1)', async () => {
    const busySkillId = 'skill-busy';
    const idleSkillId = 'skill-idle';
    const cardId = insertV2Card(db, {
      owner,
      skills: [
        { id: busySkillId, online: false, callsPerHour: 60 },
        { id: idleSkillId, online: false, callsPerHour: 60 },
      ],
    });

    // Insert 60 requests for busy skill in last hour → idle_rate = 0.0
    for (let i = 0; i < 60; i++) {
      insertRequest(db, busySkillId, 10);
    }
    // No requests for idle skill → idle_rate = 1.0

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER1_CONFIG });
    await monitor.poll();

    const busySkill = getSkillData(db, cardId, busySkillId);
    const idleSkill = getSkillData(db, cardId, idleSkillId);

    const busyAvail = busySkill!['availability'] as { online: boolean };
    const idleAvail = idleSkill!['availability'] as { online: boolean };

    expect(busyAvail.online).toBe(false);   // NOT flipped
    expect(idleAvail.online).toBe(true);    // WAS flipped
  });

  it('defaults capacity to 60 when skill.metadata.capacity.calls_per_hour is undefined', async () => {
    const skillId = 'skill-no-capacity';
    const cardId = insertV2Card(db, { owner, skills: [{ id: skillId }] }); // no callsPerHour

    // Insert 30 requests → idle_rate = 1 - 30/60 = 0.5
    for (let i = 0; i < 30; i++) {
      insertRequest(db, skillId, 20);
    }

    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    await monitor.poll();

    const skill = getSkillData(db, cardId, skillId);
    const internal = skill!['_internal'] as Record<string, unknown>;
    expect(internal['idle_rate']).toBeCloseTo(0.5, 5);
  });

  it('start() returns a Cron job, getJob() returns the same job', () => {
    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    const job1 = monitor.start();
    const job2 = monitor.getJob();

    expect(job1).toBeDefined();
    expect(job1).toBe(job2);

    // Clean up
    job1.stop();
  });

  it('only processes v2.0 cards with skills[]; v1.0 cards are skipped', async () => {
    // Insert a v1.0 card (no skills[])
    insertV1Card(db, owner);

    // Should not throw and no request_log rows should be written
    const monitor = new IdleMonitor({ owner, db, autonomyConfig: TIER3_CONFIG });
    await expect(monitor.poll()).resolves.toBeUndefined();

    const rows = db.prepare('SELECT COUNT(*) as cnt FROM request_log').get() as { cnt: number };
    expect(rows.cnt).toBe(0); // No audit events written for v1.0 cards
  });
});
