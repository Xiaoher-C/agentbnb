import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CapabilityCardV2Schema } from '../types/index.js';
import type { CapabilityCardV2, Skill } from '../types/index.js';
import { parseSoulMd } from '../skills/publish-capability.js';
import { listCards } from '../registry/store.js';
import { AgentBnBError } from '../types/index.js';

/**
 * Parses a SOUL.md markdown string into a v2.0-compatible structure,
 * mapping each H2 section to a Skill entry in the skills array.
 *
 * @param content - Raw SOUL.md markdown content.
 * @returns Object with agentName, description, and skills[].
 */
export function parseSoulMdV2(content: string): {
  agentName: string;
  description: string;
  skills: Skill[];
} {
  const parsed = parseSoulMd(content);

  const skills: Skill[] = parsed.capabilities.map((cap) => {
    // Sanitize: lowercase, spaces to dashes, strip non-alphanumeric-dash chars
    const sanitizedId = cap.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const id = sanitizedId.length > 0 ? sanitizedId : randomUUID();

    return {
      id,
      name: cap.name,
      description: (cap.description.slice(0, 500) || cap.name).slice(0, 500),
      level: 2 as const,
      inputs: [
        {
          name: 'input',
          type: 'text' as const,
          description: 'Input for the skill',
          required: true,
        },
      ],
      outputs: [
        {
          name: 'output',
          type: 'text' as const,
          description: 'Output from the skill',
          required: true,
        },
      ],
      pricing: { credits_per_call: 10 },
      availability: { online: true },
    };
  });

  return {
    agentName: parsed.name || 'Unknown Agent',
    description: parsed.description,
    skills,
  };
}

/**
 * Parses a SOUL.md string and upserts a v2.0 CapabilityCard into the registry.
 *
 * If a v2.0 card already exists for the given owner, it is updated in-place
 * (preserving its id). If no card exists, a new card is inserted with a fresh UUID.
 *
 * @param db - Open registry database instance.
 * @param soulContent - Raw SOUL.md markdown content.
 * @param owner - Agent owner identifier.
 * @returns The upserted CapabilityCardV2.
 * @throws {AgentBnBError} with code VALIDATION_ERROR if SOUL.md has no H2 sections.
 */
export function publishFromSoulV2(
  db: Database.Database,
  soulContent: string,
  owner: string,
): CapabilityCardV2 {
  const { agentName, skills } = parseSoulMdV2(soulContent);

  if (skills.length === 0) {
    throw new AgentBnBError('SOUL.md has no H2 sections', 'VALIDATION_ERROR');
  }

  // Check for existing v2.0 card for this owner
  const existingCards = listCards(db, owner);
  const existingV2 = existingCards.find(
    (c) => (c as unknown as { spec_version?: string }).spec_version === '2.0',
  ) as CapabilityCardV2 | undefined;

  const now = new Date().toISOString();
  const cardId = existingV2?.id ?? randomUUID();

  const card: CapabilityCardV2 = {
    spec_version: '2.0',
    id: cardId,
    owner,
    agent_name: agentName,
    skills,
    availability: { online: true },
    created_at: existingV2?.created_at ?? now,
    updated_at: now,
  };

  // Validate with Zod schema
  CapabilityCardV2Schema.parse(card);

  if (existingV2) {
    // Update existing card via raw SQL (v2.0 cards bypass v1.0 Zod validation in updateCard)
    db.prepare(
      'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(card), now, cardId);
  } else {
    // Insert new card via raw SQL (insertCard only accepts v1.0 cards)
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cardId, owner, JSON.stringify(card), now, now);
  }

  return card;
}
