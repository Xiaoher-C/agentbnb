import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CapabilityCardSchema } from '../types/index.js';
import type { CapabilityCard, Skill } from '../types/index.js';
import { insertCard } from '../registry/store.js';
import type { SkillConfig } from './skill-config.js';

/**
 * Parsed capability entry from a SOUL.md H2 section.
 */
export interface ParsedCapability {
  /** H2 heading text — used as capability name. */
  name: string;
  /** Body text under the H2 heading — used as capability description. */
  description: string;
  /** Optional custom pricing extracted from `pricing: N` line in the H2 body. */
  pricing?: number;
}

/**
 * Parsed result from a SOUL.md file.
 * Contains the data needed to build a CapabilityCard.
 */
export interface ParsedSoul {
  /** Agent name from first H1. */
  name: string;
  /** Description from first paragraph after H1. */
  description: string;
  /** Capability level — defaults to 2 (Pipeline). */
  level: 1 | 2 | 3;
  /** Capabilities extracted from H2 sections. */
  capabilities: ParsedCapability[];
  /** Unknown section names encountered during parsing. */
  unknownSections: string[];
}

/**
 * Parses a SOUL.md markdown string into structured data for building a CapabilityCard.
 *
 * Parsing strategy (defensive, regex-based — no markdown parser dependency):
 * - First H1 (`# ...`) → agent name
 * - First paragraph (non-heading, non-empty line before first H2) → description
 * - H2 sections (`## ...`) → capability entries with name + body text
 * - Defaults level to 2 (Pipeline) per RESEARCH.md open question resolution
 * - Unknown/unrecognized section types are flagged rather than causing errors
 *
 * @param content - Raw SOUL.md markdown content.
 * @returns ParsedSoul with extracted fields.
 */
export function parseSoulMd(content: string): ParsedSoul {
  const lines = content.split('\n');

  let name = '';
  let description = '';
  const capabilities: ParsedCapability[] = [];
  const unknownSections: string[] = [];

  let currentSection: 'preamble' | 'capability' | null = null;
  let currentCapabilityName = '';
  let currentCapabilityLines: string[] = [];
  let currentCapabilityPricing: number | undefined = undefined;
  let descriptionLines: string[] = [];
  let pastFirstH1 = false;
  let pastFirstH2 = false;

  const flushCapability = () => {
    if (currentCapabilityName) {
      const cap: ParsedCapability = {
        name: currentCapabilityName,
        description: currentCapabilityLines.join(' ').trim(),
      };
      if (currentCapabilityPricing !== undefined) {
        cap.pricing = currentCapabilityPricing;
      }
      capabilities.push(cap);
      currentCapabilityName = '';
      currentCapabilityLines = [];
      currentCapabilityPricing = undefined;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // H1 — agent name (only first H1 matters)
    if (/^# /.test(trimmed) && !pastFirstH1) {
      name = trimmed.slice(2).trim();
      pastFirstH1 = true;
      currentSection = 'preamble';
      continue;
    }

    // H2 — capability section
    if (/^## /.test(trimmed)) {
      // Flush any in-progress capability
      flushCapability();

      const capName = trimmed.slice(3).trim();
      currentCapabilityName = capName;
      currentSection = 'capability';
      pastFirstH2 = true;
      continue;
    }

    // H3+ — unknown subsections, flag them
    if (/^#{3,} /.test(trimmed)) {
      const sectionName = trimmed.replace(/^#+\s*/, '');
      if (!unknownSections.includes(sectionName)) {
        unknownSections.push(sectionName);
      }
      continue;
    }

    // Skip empty lines for content parsing
    if (trimmed === '') continue;

    // Non-heading content
    if (currentSection === 'preamble' && !pastFirstH2) {
      // Collect description from preamble paragraphs
      descriptionLines.push(trimmed);
    } else if (currentSection === 'capability') {
      // Check for pricing: N directive — extract and skip from description
      const pricingMatch = trimmed.match(/^pricing:\s*(\d+(?:\.\d+)?)$/i);
      if (pricingMatch) {
        const val = parseFloat(pricingMatch[1]!);
        if (!isNaN(val) && val >= 0) {
          currentCapabilityPricing = val;
        }
        // Do not add pricing line to description text
      } else {
        currentCapabilityLines.push(trimmed);
      }
    }
  }

  // Flush last capability
  flushCapability();

  // Use first preamble paragraph as description
  if (descriptionLines.length > 0) {
    description = descriptionLines[0] ?? '';
  }

  return {
    name,
    description,
    level: 2,
    capabilities,
    unknownSections,
  };
}

/**
 * Parses a SOUL.md string, builds a full CapabilityCard, and inserts it into the registry.
 *
 * Defaults applied:
 * - id: randomUUID()
 * - level: 2 (Pipeline)
 * - pricing.credits_per_call: 10
 * - availability.online: true
 * - inputs/outputs: one generic text input/output derived from capabilities
 *
 * @param db - Open registry database instance.
 * @param soulContent - Raw SOUL.md markdown content.
 * @param owner - Agent owner identifier.
 * @returns The created CapabilityCard (after Zod validation and insertion).
 * @throws {AgentBnBError} with code VALIDATION_ERROR if the card fails schema validation.
 */
export function publishFromSoul(
  db: Database.Database,
  soulContent: string,
  owner: string,
): CapabilityCard {
  const parsed = parseSoulMd(soulContent);

  // Build description from capabilities if none was extracted from preamble
  const capsSummary = parsed.capabilities.map((c) => c.name).join(', ');
  const description =
    parsed.description.length > 0
      ? parsed.description.slice(0, 500)
      : capsSummary.slice(0, 500);

  const card: CapabilityCard = {
    spec_version: '1.0',
    id: randomUUID(),
    owner,
    name: parsed.name || 'Unknown Agent',
    description,
    level: parsed.level,
    inputs: [
      {
        name: 'input',
        type: 'text',
        description: 'Input for the capability',
        required: true,
      },
    ],
    outputs: [
      {
        name: 'output',
        type: 'text',
        description: 'Output from the capability',
        required: true,
      },
    ],
    pricing: {
      credits_per_call: 10,
    },
    availability: {
      online: true,
    },
    metadata: {
      tags: parsed.capabilities.map((c) => c.name.toLowerCase().replace(/\s+/g, '-')),
    },
  };

  // Validate with Zod schema (will throw VALIDATION_ERROR if invalid)
  CapabilityCardSchema.parse(card);

  insertCard(db, card);

  return card;
}

/**
 * Converts a SkillConfig (execution schema from skills.yaml) to a Skill (card schema).
 *
 * Maps execution-first config fields to the registry Skill shape.
 * SkillExecutor skills are treated as Pipeline level (2) by default.
 * Input/output schemas are left empty — not declared in skills.yaml today.
 *
 * @param config - Parsed SkillConfig from skills.yaml.
 * @returns A Skill object suitable for inclusion in a CapabilityCardV2.
 */
export function skillConfigToSkill(config: SkillConfig): Skill {
  const hardTimeoutMs = typeof config.timeout_ms === 'number' ? config.timeout_ms : undefined;
  return {
    id: config.id,
    name: config.name,
    description: config.description ?? '',
    level: 2,
    inputs: [],
    outputs: [],
    pricing: config.pricing,
    ...(config.expected_duration_ms !== undefined && { expected_duration_ms: config.expected_duration_ms }),
    ...(hardTimeoutMs !== undefined && { hard_timeout_ms: hardTimeoutMs }),
    ...(config.capability_types !== undefined && { capability_types: config.capability_types }),
    ...(config.requires_capabilities !== undefined && { requires_capabilities: config.requires_capabilities }),
    ...(config.visibility !== undefined && { visibility: config.visibility }),
  };
}
