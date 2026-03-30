/**
 * Workspace scanner — discovers OpenClaw agents and capabilities.
 *
 * Scans ~/.openclaw/workspace/brains/ (primary), ~/.openclaw/agents/ (fallback),
 * and ~/.openclaw/workspace/SOUL.md (workspace-root single-agent) to build a
 * unified view of available agents and their capabilities.
 *
 * Workspace path resolution honours (in priority order):
 *   1. openclaw.json agents.defaults.workspace
 *   2. OPENCLAW_PROFILE env var  → workspace-<profile>
 *   3. Default ~/.openclaw/workspace/
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 * Returns the OpenClaw workspace directory.
 *
 * Resolution order:
 *   1. openclaw.json → agents.defaults.workspace
 *   2. OPENCLAW_PROFILE env → ~/.openclaw/workspace-<profile>
 *   3. Default ~/.openclaw/workspace/
 */
export function getOpenClawWorkspaceDir(): string {
  const openclawDir = join(homedir(), '.openclaw');
  const configPath = join(openclawDir, 'openclaw.json');

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = config['agents'] as Record<string, unknown> | undefined;
      const defaults = agents?.['defaults'] as Record<string, unknown> | undefined;
      const workspace = defaults?.['workspace'];
      if (typeof workspace === 'string' && workspace.length > 0) {
        return workspace;
      }
    } catch { /* fall through */ }
  }

  const profile = process.env['OPENCLAW_PROFILE'];
  if (profile && profile !== 'default') {
    return join(openclawDir, `workspace-${profile}`);
  }

  return join(openclawDir, 'workspace');
}

/**
 * Finds the SOUL.md file for a given agent by searching multiple paths.
 *
 * Search priority:
 *   1. <workspaceDir>/brains/<agentName>/SOUL.md  (multi-agent brain dir)
 *   2. ~/.openclaw/agents/<agentName>/SOUL.md      (legacy agents dir)
 *   3. <workspaceDir>/SOUL.md                      (workspace-root / single-agent)
 *
 * @param agentName - Agent name to search for.
 * @returns Absolute path to SOUL.md, or null if not found.
 */
export function findSoulMd(agentName: string): string | null {
  const openclawDir = join(homedir(), '.openclaw');
  const workspaceDir = getOpenClawWorkspaceDir();

  const candidates: string[] = [
    // Priority 1: brains directory (multi-agent)
    join(workspaceDir, 'brains', agentName, 'SOUL.md'),
    // Priority 2: agents directory (legacy)
    join(openclawDir, 'agents', agentName, 'SOUL.md'),
    // Priority 3: workspace root (single-agent or "main")
    join(workspaceDir, 'SOUL.md'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Infers the brain directory for an agent from a resolved SOUL.md path.
 *
 * Returns the directory containing SOUL.md, unless that directory is the
 * legacy agents/<name> dir (in which case it's not treated as a brainDir).
 *
 * @param soulPath - Absolute path to SOUL.md.
 * @param agentDir - The legacy agents/<name> directory path.
 * @returns Brain directory path, or '' if the soul is in the legacy agent dir.
 */
export function inferBrainDir(soulPath: string, agentDir: string): string {
  const soulDir = dirname(soulPath);
  return soulDir === agentDir ? '' : soulDir;
}

/**
 * Scans for available OpenClaw agents.
 *
 * Primary scan: <workspaceDir>/brains/ (brain-dir agents)
 * Fallback scan: ~/.openclaw/agents/ (legacy agents without brain dirs)
 * Workspace root: <workspaceDir>/SOUL.md → adds "main" agent if not already seen
 * Deduplication: brain-dir agents take precedence; fallback only adds new names.
 *
 * @returns Array of detected agents sorted by name.
 */
export function scanAgents(): DetectedAgent[] {
  const openclawDir = join(homedir(), '.openclaw');
  const workspaceDir = getOpenClawWorkspaceDir();
  const brainsDir = join(workspaceDir, 'brains');
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

  // Workspace root: SOUL.md at workspace root → "main" agent
  const rootSoul = join(workspaceDir, 'SOUL.md');
  if (existsSync(rootSoul) && !seenNames.has('main')) {
    const description = firstParagraph(readFileSync(rootSoul, 'utf-8'));
    results.push({
      name: 'main',
      description,
      skillCount: countSkills(workspaceDir),
      channel: readChannel(agentsDir, 'main'),
      brainDir: workspaceDir,
      agentbnbDir: join(agentsDir, 'main', '.agentbnb'),
    });
    seenNames.add('main');
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

/**
 * Scans the workspace-level skills/ directory for shared SKILL.md files.
 *
 * These are workspace-wide skills (not agent-specific) that can be shared
 * on AgentBnB. Used to populate `agentbnb openclaw skills add` discovery.
 *
 * @returns Array of detected capabilities from workspace/skills/.
 */
export function scanWorkspaceSkills(): DetectedCapability[] {
  const workspaceDir = getOpenClawWorkspaceDir();
  const skillsDir = join(workspaceDir, 'skills');
  const results: DetectedCapability[] = [];

  if (!existsSync(skillsDir)) return results;

  let entries: string[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return results;
  }

  for (const skillDirName of entries) {
    const skillMdPath = join(skillsDir, skillDirName, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, 'utf-8');
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

      results.push({
        name,
        description,
        source: 'skill_md',
        suggestedPrice: heuristicPrice(name),
      });
    } catch {
      // Skip unreadable SKILL.md files
    }
  }

  return results;
}
