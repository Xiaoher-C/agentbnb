/**
 * Skills.yaml parser and command path resolver.
 *
 * Provides three pure functions for discovering skills registered in AgentBnB's
 * skills.yaml files (both direct-deploy ~/.agentbnb/ and OpenClaw agent dirs).
 *
 * @module skills-yaml
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import * as yaml from 'js-yaml';
import type { SkillsYamlEntry } from './types.js';

/**
 * Parse a skills.yaml file into SkillsYamlEntry[].
 * Returns empty array if file doesn't exist or is malformed.
 * Never throws.
 */
export function parseSkillsYaml(yamlPath: string): SkillsYamlEntry[] {
  try {
    if (!yamlPath || !existsSync(yamlPath)) return [];
    const raw = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const doc = parsed as Record<string, unknown>;
    const skills = doc.skills;
    if (!Array.isArray(skills)) return [];

    return skills
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).id === 'string')
      .map((s) => {
        const entry = s as Record<string, unknown>;
        return {
          id: String(entry.id),
          name: typeof entry.name === 'string' ? entry.name : String(entry.id),
          type: (['command', 'api', 'conductor', 'skill-md'].includes(String(entry.type))
            ? String(entry.type)
            : 'command') as SkillsYamlEntry['type'],
          ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
          ...(typeof entry.endpoint === 'string' ? { endpoint: entry.endpoint } : {}),
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
        } satisfies SkillsYamlEntry;
      });
  } catch {
    return [];
  }
}

/**
 * Attempt to resolve a command string to a directory containing SKILL.md.
 *
 * Strategy:
 *   1. Extract the first path-like token from the command string.
 *   2. Expand `~` using os.homedir().
 *   3. Resolve relative paths against `yamlDir`.
 *   4. Walk up at most 5 parent levels looking for SKILL.md.
 *   5. Return the directory containing SKILL.md, or null.
 *
 * Returns null for system binaries (/usr/*, /bin/*, /sbin/*), module-style
 * commands (python -m X), docker commands, or empty/undefined input.
 */
export function resolveCommandToSkillPath(
  command: string | undefined,
  yamlDir: string,
): string | null {
  if (!command || typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Extract first path-like token: starts with /, ./, or ~/
  const tokens = trimmed.split(/\s+/);
  let pathToken: string | null = null;
  for (const token of tokens) {
    // Skip common interpreters and flags
    if (token === 'node' || token === 'python' || token === 'python3' || token === 'bash' || token === 'sh') continue;
    if (token.startsWith('-')) continue;
    if (token.startsWith('/') || token.startsWith('./') || token.startsWith('~/')) {
      pathToken = token;
      break;
    }
  }

  if (!pathToken) return null;

  // Expand ~
  if (pathToken.startsWith('~/')) {
    pathToken = join(homedir(), pathToken.slice(2));
  }

  // Reject system binary paths
  if (pathToken.startsWith('/usr/') || pathToken.startsWith('/bin/') || pathToken.startsWith('/sbin/')) {
    return null;
  }

  // Resolve relative paths against yamlDir
  let absPath: string;
  if (isAbsolute(pathToken)) {
    absPath = pathToken;
  } else {
    absPath = resolve(yamlDir, pathToken);
  }

  // The path might point to a file (e.g. dist/index.js) — start from its dir
  // Or a directory — start from it directly
  let startDir: string;
  try {
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      startDir = dirname(absPath);
    } else {
      startDir = absPath;
    }
  } catch {
    return null;
  }

  // Walk up max 5 levels looking for SKILL.md
  let current = startDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(current, 'SKILL.md'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }

  return null;
}

/** Return type for synthesizeRegisteredSkill — mirrors ListedSkill from skill-routes.ts. */
export interface RegisteredSkillEntry {
  skillId: string;
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  source: 'skills_yaml';
  provenanceState: 'registered';
  loadedBy: string[];
  version?: string;
}

/**
 * Synthesize a ListedSkill-like entry for a registered-but-not-inspectable skill.
 * Used when resolveCommandToSkillPath returns null OR the path has no SKILL.md.
 */
export function synthesizeRegisteredSkill(
  entry: SkillsYamlEntry,
  yamlPath: string,
  loadedBy: string[],
): RegisteredSkillEntry {
  const compositeKey = `${yamlPath}#${entry.id}`;
  return {
    skillId: createHash('sha256').update(compositeKey).digest('hex').slice(0, 16),
    name: entry.name || entry.id,
    description: entry.description || `Registered ${entry.type} skill — no SKILL.md`,
    path: yamlPath,
    canonicalPath: yamlPath,
    source: 'skills_yaml',
    provenanceState: 'registered',
    loadedBy,
    ...(entry.version ? { version: entry.version } : {}),
  };
}
