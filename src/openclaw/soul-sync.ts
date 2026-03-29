import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CapabilityCardV2Schema } from '../types/index.js';
import type { CapabilityCardV2, Skill } from '../types/index.js';
import { parseSoulMd } from '../skills/publish-capability.js';
import { listCards, attachCanonicalAgentId } from '../registry/store.js';
import { AgentBnBError } from '../types/index.js';

/**
 * Regex that matches a metadata bullet within the joined skill description text.
 *
 * parseSoulMd joins each capability's lines with a single space, so original
 * newline-separated bullets appear as `- key: value` segments inside the
 * description string.  We scan the full description for all such patterns.
 *
 * Recognised keys:
 *   capability_types   → split on comma → skill.capability_types
 *   requires           → split on comma → skill.requires_capabilities
 *   requires_capabilities → same
 *   visibility         → 'public' | 'private' → skill.visibility
 *
 * The pattern is anchored to a word boundary so it does not match mid-word
 * hyphens.  The value capture runs until the next metadata bullet or end-of-string.
 */
const SKILL_META_GLOBAL_RE =
  /(?:^|\s)-\s*(capability_types|requires(?:_capabilities)?|visibility)\s*:\s*([^-][^]*?)(?=\s+-\s+(?:capability_types|requires(?:_capabilities)?|visibility)\s*:|$)/gi;

/**
 * Extracts routing metadata embedded as bullet lines in a skill description
 * (as produced by parseSoulMd joining H2 body lines with spaces) and strips
 * those bullet lines from the description prose.
 *
 * @param raw - The joined description string from parseSoulMd.
 * @returns Metadata fields and the cleaned prose description.
 */
function extractSkillMeta(raw: string): {
  description: string;
  capability_types?: string[];
  requires_capabilities?: string[];
  visibility?: 'public' | 'private';
} {
  let capability_types: string[] | undefined;
  let requires_capabilities: string[] | undefined;
  let visibility: 'public' | 'private' | undefined;

  // Collect all matched ranges so we can remove them from the description
  const removedRanges: Array<{ start: number; end: number }> = [];

  // Reset lastIndex before use (global flag)
  SKILL_META_GLOBAL_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = SKILL_META_GLOBAL_RE.exec(raw)) !== null) {
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();

    if (key === 'capability_types') {
      capability_types = val.split(',').map((v) => v.trim()).filter(Boolean);
    } else if (key === 'requires' || key === 'requires_capabilities') {
      requires_capabilities = val.split(',').map((v) => v.trim()).filter(Boolean);
    } else if (key === 'visibility') {
      const vis = val.toLowerCase();
      if (vis === 'public' || vis === 'private') {
        visibility = vis;
      }
    }

    removedRanges.push({ start: m.index, end: m.index + m[0]!.length });
  }

  // Rebuild description by removing matched ranges
  let description = raw;
  // Process ranges in reverse order to preserve indices
  for (const { start, end } of removedRanges.slice().reverse()) {
    description = description.slice(0, start) + description.slice(end);
  }
  description = description.trim();

  return { description, capability_types, requires_capabilities, visibility };
}

/**
 * Parses a SOUL.md markdown string into a v2.0-compatible structure,
 * mapping each H2 section to a Skill entry in the skills array.
 *
 * Skill H2 body lines may include optional routing metadata bullets:
 *   - capability_types: val1, val2
 *   - requires: val1, val2  (or requires_capabilities:)
 *   - visibility: public
 *
 * These lines are stripped from the prose description and placed into the
 * corresponding Skill fields.  Non-metadata lines remain in the description.
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

    // Extract routing metadata bullets embedded in the description
    const { description: cleanDesc, capability_types, requires_capabilities, visibility } =
      extractSkillMeta(cap.description);

    const finalDescription = (cleanDesc || cap.name).slice(0, 500);

    const skill: Skill = {
      id,
      name: cap.name,
      description: finalDescription,
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
      pricing: { credits_per_call: cap.pricing !== undefined ? cap.pricing : 10 },
      availability: { online: true },
    };

    if (capability_types !== undefined) skill.capability_types = capability_types;
    if (requires_capabilities !== undefined) skill.requires_capabilities = requires_capabilities;
    if (visibility !== undefined) skill.visibility = visibility;

    return skill;
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
 * @param sharedSkills - Optional whitelist of skill IDs to publish. When provided,
 *   only skills with matching IDs are included (overrides skill.visibility).
 *   When empty/omitted, respects each skill's `visibility` field ('private' → excluded).
 * @returns The upserted CapabilityCardV2.
 * @throws {AgentBnBError} with code VALIDATION_ERROR if SOUL.md has no publishable H2 sections.
 */
export function publishFromSoulV2(
  db: Database.Database,
  soulContent: string,
  owner: string,
  sharedSkills?: string[],
): CapabilityCardV2 {
  const { agentName, skills: allSkills } = parseSoulMdV2(soulContent);

  // Apply skill visibility / whitelist filter
  const skills = allSkills.filter((skill) => {
    if (sharedSkills && sharedSkills.length > 0) {
      return sharedSkills.includes(skill.id);
    }
    return skill.visibility !== 'private';
  });

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
  const storedCard = attachCanonicalAgentId(db, card);

  // Validate with Zod schema
  CapabilityCardV2Schema.parse(storedCard);

  if (existingV2) {
    // Update existing card via raw SQL (v2.0 cards bypass v1.0 Zod validation in updateCard)
    db.prepare(
      'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(storedCard), now, cardId);
  } else {
    // Insert new card via raw SQL (insertCard only accepts v1.0 cards)
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cardId, storedCard.owner, JSON.stringify(storedCard), now, now);
  }

  return storedCard;
}
