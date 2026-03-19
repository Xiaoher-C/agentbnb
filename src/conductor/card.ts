import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { CapabilityCardV2Schema } from '../types/index.js';
import type { CapabilityCardV2 } from '../types/index.js';

/** Fixed owner identifier for the Conductor agent. */
export const CONDUCTOR_OWNER = 'agentbnb-conductor';

/**
 * Deterministic UUID for the Conductor card (singleton).
 * Generated once — the Conductor is a single built-in agent.
 */
const CONDUCTOR_CARD_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Generate a deterministic UUID-v4-shaped ID from an owner string.
 * Uses SHA-256 hash of the owner, sliced to fit UUID format.
 */
function ownerToCardId(owner: string): string {
  const hash = createHash('sha256').update(owner).digest('hex').slice(0, 32);
  // Format as UUID v4 shape: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Builds the Conductor's CapabilityCardV2.
 *
 * The Conductor exposes two skills:
 * - `orchestrate` (5 cr): Decomposes and executes multi-agent tasks
 * - `plan` (1 cr): Returns an execution plan with cost estimate only
 *
 * When `owner` is provided, the card is attributed to that agent owner
 * with a deterministic owner-specific ID. When omitted, uses the default
 * singleton CONDUCTOR_OWNER and fixed UUID.
 *
 * The returned card is validated against CapabilityCardV2Schema before return.
 *
 * @param owner - Optional agent owner. When provided, card is owner-specific.
 * @returns A valid CapabilityCardV2 for the Conductor.
 */
export function buildConductorCard(owner?: string): CapabilityCardV2 {
  const cardOwner = owner ?? CONDUCTOR_OWNER;
  const cardId = owner ? ownerToCardId(owner) : CONDUCTOR_CARD_ID;

  const card = {
    spec_version: '2.0' as const,
    id: cardId,
    owner: cardOwner,
    agent_name: 'AgentBnB Conductor',
    skills: [
      {
        id: 'orchestrate',
        name: 'Task Orchestration',
        description:
          'Decomposes complex tasks and coordinates multi-agent execution',
        level: 3 as const,
        inputs: [
          {
            name: 'task',
            type: 'text' as const,
            description: 'Natural language task description',
          },
        ],
        outputs: [
          {
            name: 'result',
            type: 'json' as const,
            description: 'Aggregated execution results',
          },
        ],
        pricing: { credits_per_call: 5 },
      },
      {
        id: 'plan',
        name: 'Execution Planning',
        description:
          'Returns an execution plan with cost estimate without executing',
        level: 1 as const,
        inputs: [
          {
            name: 'task',
            type: 'text' as const,
            description: 'Natural language task description',
          },
        ],
        outputs: [
          {
            name: 'plan',
            type: 'json' as const,
            description: 'Execution plan with cost breakdown',
          },
        ],
        pricing: { credits_per_call: 1 },
      },
    ],
    availability: { online: true },
  };

  // Validate before returning
  return CapabilityCardV2Schema.parse(card);
}

/**
 * Registers the Conductor card in the given SQLite database.
 *
 * Idempotent: uses INSERT OR REPLACE to handle repeated calls gracefully.
 * Stores the v2.0 card as JSON in the same `capability_cards` table used
 * by the registry, following the same (id, owner, data, created_at, updated_at) schema.
 *
 * @param db - Open better-sqlite3 database instance (with migrations applied).
 * @returns The registered CapabilityCardV2.
 */
export function registerConductorCard(db: Database.Database): CapabilityCardV2 {
  const card = buildConductorCard();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id FROM capability_cards WHERE id = ?')
    .get(card.id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(card), now, card.id);
  } else {
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(card.id, card.owner, JSON.stringify(card), now, now);
  }

  return card;
}
