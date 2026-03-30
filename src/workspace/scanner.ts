/**
 * Workspace scanner — discovers OpenClaw agents and capabilities.
 *
 * Scans ~/.openclaw/workspace/brains/ (primary) and ~/.openclaw/agents/ (fallback)
 * to build a unified view of available agents and their capabilities.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** A detected OpenClaw agent with its workspace metadata. */
export interface DetectedAgent {
  /** Agent name (directory basename). */
  name: string;
  /** First paragraph of SOUL.md, or empty string if unavailable. */
  description: string;
  /** Number of files found in the skills/ subdirectory. */
  skillCount: number;
  /** Channel type from openclaw.json (e.g. 'telegram', 'webhook'), or 'unknown'. */
  channel: string;
  /** Path to ~/.openclaw/workspace/brains/<agent>, or '' if agent has no brain dir. */
  brainDir: string;
  /** Path to ~/.openclaw/agents/<agent>/.agentbnb (may not exist yet). */
  agentbnbDir: string;
}

/** A detected capability extracted from SOUL.md or a SKILL.md file. */
export interface DetectedCapability {
  /** Capability/skill identifier (derived from section heading or SKILL.md name field). */
  name: string;
  /** One-line description. */
  description: string;
  /** Where this capability was discovered. */
  source: 'soul_md' | 'skill_md';
  /** Suggested price based on heuristics. */
  suggestedPrice: number;
}

/** Pricing heuristic when no market data is available. */
function heuristicPrice(skillName: string): number {
  const lower = skillName.toLowerCase();
  if (/voice|tts|elevenlabs/.test(lower)) return 4;
  if (/crawl|browser|cf/.test(lower)) return 3;
  if (/scrape|stealth/.test(lower)) return 5;
  if (/search|kb|knowledge/.test(lower)) return 2;
  return 3;
}

/** Extracts the first non-empty paragraph from a markdown string. */
function firstParagraph(md: string): string {
  const lines = md.split('\n');
  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headings
    if (trimmed.startsWith('#')) continue;
    // Skip horizontal rules
    if (/^---+$/.test(trimmed)) continue;

    if (trimmed.length > 0) {
      inParagraph = true;
      paragraphLines.push(trimmed);
    } else if (inParagraph) {
      // End of paragraph
      break;
    }
  }

  return paragraphLines.join(' ');
}

/** Reads openclaw.json from the agents directory and extracts channel type. */
function readChannel(agentsDir: string, agentName: string): string {
  const openclawJsonPath = join(agentsDir, agentName, 'openclaw.json');
  if (!existsSync(openclawJsonPath)) return 'unknown';
  try {
    const raw = readFileSync(openclawJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const channel = parsed['channel'] ?? parsed['type'] ?? 'unknown';
    return typeof channel === 'string' ? channel : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Counts files in skills/ subdirectory of a brain dir. */
function countSkills(brainDir: string): number {
  const skillsDir = join(brainDir, 'skills');
  if (!existsSync(skillsDir)) return 0;
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isFile() || e.isDirectory())
      .length;
  } catch {
    return 0;
  }
}

/**
 * Scans for available OpenClaw agents.
 *
 * Primary scan: ~/.openclaw/workspace/brains/ (brain-dir agents)
 * Fallback scan: ~/.openclaw/agents/ (legacy agents without brain dirs)
 * Deduplication: brain-dir agents take precedence; fallback only adds new names.
 *
 * @returns Array of detected agents sorted by name.
 */
export function scanAgents(): DetectedAgent[] {
  const openclawDir = join(homedir(), '.openclaw');
  const brainsDir = join(openclawDir, 'workspace', 'brains');
  const agentsDir = join(openclawDir, 'agents');
  const results: DetectedAgent[] = [];
  const seenNames = new Set<string>();

  // Primary: workspace/brains/
  if (existsSync(brainsDir)) {
    const entries = readdirSync(brainsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of entries) {
      const brainDir = join(brainsDir, name);
      const soulPath = join(brainDir, 'SOUL.md');
      const description = existsSync(soulPath)
        ? firstParagraph(readFileSync(soulPath, 'utf-8'))
        : '';

      results.push({
        name,
        description,
        skillCount: countSkills(brainDir),
        channel: readChannel(agentsDir, name),
        brainDir,
        agentbnbDir: join(agentsDir, name, '.agentbnb'),
      });
      seenNames.add(name);
    }
  }

  // Fallback: ~/.openclaw/agents/ (for agents without brain dirs)
  if (existsSync(agentsDir)) {
    const entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !seenNames.has(name));

    for (const name of entries) {
      const agentDir = join(agentsDir, name);
      const soulPath = join(agentDir, 'SOUL.md');
      const description = existsSync(soulPath)
        ? firstParagraph(readFileSync(soulPath, 'utf-8'))
        : '';

      results.push({
        name,
        description,
        skillCount: 0,
        channel: readChannel(agentsDir, name),
        brainDir: '',
        agentbnbDir: join(agentDir, '.agentbnb'),
      });
      seenNames.add(name);
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parses H2 sections from SOUL.md as capability declarations.
 * Ignores the "AgentBnB Network Trading" section (already shared).
 *
 * @param soulContent - Raw SOUL.md content.
 * @returns Array of capability names and first-line descriptions.
 */
function parseCapabilitiesFromSoul(soulContent: string): Array<{ name: string; description: string }> {
  const results: Array<{ name: string; description: string }> = [];
  const lines = soulContent.split('\n');
  let currentName: string | null = null;
  const descLines: string[] = [];

  for (const line of lines) {
    const h2Match = /^## (.+)$/.exec(line);
    if (h2Match) {
      if (currentName) {
        results.push({ name: currentName, description: descLines.join(' ').trim() });
      }
      currentName = h2Match[1]!.trim();
      // Skip the AgentBnB section and generic structural sections
      if (
        currentName === 'AgentBnB Network Trading' ||
        currentName.startsWith('Trading') ||
        currentName === 'Overview' ||
        currentName === 'About'
      ) {
        currentName = null;
      }
      descLines.length = 0;
    } else if (currentName && descLines.length === 0 && line.trim().length > 0) {
      // First non-empty line after H2 heading
      descLines.push(line.trim());
    }
  }
  if (currentName) {
    results.push({ name: currentName, description: descLines.join(' ').trim() });
  }

  return results;
}

/**
 * Parses capabilities from a brain directory.
 *
 * Reads SOUL.md H2 sections and skills/<name>/SKILL.md frontmatter,
 * deduplicates by name, and applies heuristic pricing.
 *
 * @param brainDir - Path to ~/.openclaw/workspace/brains/<agent>
 * @returns Array of detected capabilities with suggested prices.
 */
export function scanCapabilities(brainDir: string): DetectedCapability[] {
  const results: DetectedCapability[] = [];
  const seen = new Set<string>();

  // Parse SOUL.md H2 sections
  const soulPath = join(brainDir, 'SOUL.md');
  if (existsSync(soulPath)) {
    const soulContent = readFileSync(soulPath, 'utf-8');
    for (const { name, description } of parseCapabilitiesFromSoul(soulContent)) {
      if (!seen.has(name)) {
        seen.add(name);
        results.push({
          name,
          description,
          source: 'soul_md',
          suggestedPrice: heuristicPrice(name),
        });
      }
    }
  }

  // Parse skills/*/SKILL.md frontmatter
  const skillsDir = join(brainDir, 'skills');
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const skillDirName of entries) {
      const skillMdPath = join(skillsDir, skillDirName, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        // Extract YAML frontmatter (--- block at top)
        const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
        let name = skillDirName;
        let description = '';

        if (fmMatch) {
          const fm = fmMatch[1]!;
          const nameMatch = /^name:\s*(.+)$/m.exec(fm);
          const descMatch = /^description:\s*(.+)$/m.exec(fm);
          if (nameMatch) name = nameMatch[1]!.trim();
          if (descMatch) description = descMatch[1]!.trim();
        }

        if (!seen.has(name)) {
          seen.add(name);
          results.push({
            name,
            description,
            source: 'skill_md',
            suggestedPrice: heuristicPrice(name),
          });
        }
      } catch {
        // Skip unreadable SKILL.md files
      }
    }
  }

  return results;
}
