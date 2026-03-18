/**
 * Smart onboarding orchestrator — auto-detects agent capabilities
 * and builds v2.0 cards from docs, env vars, or interactive templates.
 *
 * Detection priority chain (stops at first match):
 * 1. --from <file> → parse specified file
 * 2. SOUL.md → existing publishFromSoulV2() flow
 * 3. CLAUDE.md / AGENTS.md / README.md → regex doc parser
 * 4. Environment variables → existing detectApiKeys() flow
 * 5. Interactive template menu (TTY only, handled by CLI)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CapabilityCardV2Schema } from '../types/index.js';
import type { CapabilityCardV2 } from '../types/index.js';
import { detectApiKeys, KNOWN_API_KEYS } from '../cli/onboarding.js';
import { detectFromDocs } from './detect-from-docs.js';
import type { DetectedCapability } from './capability-templates.js';

// Re-exports for convenience
export { detectFromDocs } from './detect-from-docs.js';
export { parseSelection, interactiveTemplateMenu } from './interactive.js';
export { API_PATTERNS, INTERACTIVE_TEMPLATES } from './capability-templates.js';
export type { DetectedCapability, PatternEntry } from './capability-templates.js';

/**
 * Result of the capability detection chain.
 * The `source` field indicates which detection method succeeded.
 */
export interface DetectionResult {
  /** Which detection method produced results */
  source: 'soul' | 'docs' | 'env' | 'none';
  /** Detected capabilities (for 'docs' source) */
  capabilities: DetectedCapability[];
  /** Raw SOUL.md content (for 'soul' source — caller passes to publishFromSoulV2) */
  soulContent?: string;
  /** Detected env var names (for 'env' source — caller passes to buildDraftCard) */
  envKeys?: string[];
  /** Which file was used for detection */
  sourceFile?: string;
}

/**
 * Options for the detection chain.
 */
export interface DetectOptions {
  /** Explicit file to parse (--from flag) */
  fromFile?: string;
  /** Working directory to search for doc files (default: process.cwd()) */
  cwd?: string;
}

/** Doc files to scan, in priority order */
const DOC_FILES = ['SOUL.md', 'CLAUDE.md', 'AGENTS.md', 'README.md'];

/**
 * Runs the capability detection priority chain.
 *
 * Checks sources in order and stops at the first one that produces results:
 * 1. --from <file> → detectFromDocs()
 * 2. SOUL.md → returns raw content for publishFromSoulV2()
 * 3. CLAUDE.md / AGENTS.md / README.md → detectFromDocs()
 * 4. Environment variables → detectApiKeys()
 * 5. Returns { source: 'none' } if nothing found
 *
 * @param opts - Detection options (fromFile, cwd)
 * @returns Detection result with source indicator and data
 */
export function detectCapabilities(opts: DetectOptions = {}): DetectionResult {
  const cwd = opts.cwd ?? process.cwd();

  // Priority 1: Explicit --from <file>
  if (opts.fromFile) {
    const filePath = opts.fromFile.startsWith('/')
      ? opts.fromFile
      : join(cwd, opts.fromFile);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const capabilities = detectFromDocs(content);
      if (capabilities.length > 0) {
        return { source: 'docs', capabilities, sourceFile: filePath };
      }
    }
    return { source: 'none', capabilities: [] };
  }

  // Priority 2-3: Scan doc files in order
  for (const fileName of DOC_FILES) {
    const filePath = join(cwd, fileName);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, 'utf-8');

    // SOUL.md gets special treatment — use existing publishFromSoulV2 flow
    if (fileName === 'SOUL.md') {
      return { source: 'soul', capabilities: [], soulContent: content, sourceFile: filePath };
    }

    // Other doc files — regex-based detection
    const capabilities = detectFromDocs(content);
    if (capabilities.length > 0) {
      return { source: 'docs', capabilities, sourceFile: filePath };
    }
  }

  // Priority 4: Environment variable scan
  const envKeys = detectApiKeys(KNOWN_API_KEYS);
  if (envKeys.length > 0) {
    return { source: 'env', capabilities: [], envKeys };
  }

  // Nothing found
  return { source: 'none', capabilities: [] };
}

/**
 * Converts detected capabilities into a v2.0 CapabilityCard with skills.
 *
 * Each DetectedCapability becomes a Skill on the card. The card is validated
 * via CapabilityCardV2Schema before returning.
 *
 * @param capabilities - Detected capabilities to convert
 * @param owner - Agent owner name
 * @param agentName - Optional agent display name (defaults to owner)
 * @returns A valid v2.0 CapabilityCard
 */
export function capabilitiesToV2Card(
  capabilities: DetectedCapability[],
  owner: string,
  agentName?: string,
): CapabilityCardV2 {
  const now = new Date().toISOString();

  const skills = capabilities.map((cap) => ({
    id: cap.key,
    name: cap.name,
    description: `${cap.name} capability — ${cap.category}`,
    level: 1 as const,
    category: cap.category.toLowerCase().replace(/\s+/g, '_'),
    inputs: [{ name: 'input', type: 'text' as const, required: true }],
    outputs: [{ name: 'output', type: 'text' as const, required: true }],
    pricing: { credits_per_call: cap.credits_per_call },
    availability: { online: true },
    metadata: {
      tags: cap.tags,
    },
  }));

  const card = {
    spec_version: '2.0' as const,
    id: randomUUID(),
    owner,
    agent_name: agentName ?? owner,
    skills,
    availability: { online: true },
    created_at: now,
    updated_at: now,
  };

  // Validate via Zod — throws on invalid shape
  return CapabilityCardV2Schema.parse(card);
}
