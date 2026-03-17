import type Database from 'better-sqlite3';
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
 * Builds the Conductor's CapabilityCardV2.
 *
 * The Conductor exposes two skills:
 * - `orchestrate` (5 cr): Decomposes and executes multi-agent tasks
 * - `plan` (1 cr): Returns an execution plan with cost estimate only
 *
 * The returned card is validated against CapabilityCardV2Schema before return.
 *
 * @returns A valid CapabilityCardV2 for the Conductor.
 */
export function buildConductorCard(): CapabilityCardV2 {
  const card = {
    spec_version: '2.0' as const,
    id: CONDUCTOR_CARD_ID,
    owner: CONDUCTOR_OWNER,
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
