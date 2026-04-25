import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import type { SkillMetadata, ProvenanceState, InstallSource } from './types.js';

export interface ProvenanceLookupResult {
  provenanceState: ProvenanceState;
  gitSha?: string;
  installSource?: InstallSource;
}

/**
 * Best-effort provenance lookup for a SKILL.md at an absolute path.
 *
 * Classification:
 * - `tracked`  — path is inside a git worktree AND git log returns a SHA for it.
 *   Also fills `gitSha` and infers `installSource` from the worktree layout.
 * - `pinned`   — path is inside a node_modules directory (treat as dep-locked).
 * - `untracked` — everything else (relative path, missing file, git absent,
 *   git returned empty).
 *
 * All git failures fall through to `untracked`. This helper MUST NOT throw —
 * provenance is informational and the inspector keeps running when git is
 * missing, misconfigured, or refuses to answer.
 */
export function lookupProvenance(skillPath: string): ProvenanceLookupResult {
  if (!skillPath || !isAbsolute(skillPath) || !existsSync(skillPath)) {
    return { provenanceState: 'untracked' };
  }

  if (skillPath.includes(`${sep}node_modules${sep}`)) {
    return { provenanceState: 'pinned', installSource: 'node_modules' };
  }

  const gitRoot = findGitRoot(dirname(skillPath));
  if (gitRoot) {
    const sha = gitShaForPath(gitRoot, skillPath);
    if (sha) {
      return {
        provenanceState: 'tracked',
        gitSha: sha,
        installSource: inferInstallSource(skillPath, gitRoot),
      };
    }
  }

  return { provenanceState: 'untracked' };
}

export function applyProvenance(
  metadata: SkillMetadata,
  lookup: ProvenanceLookupResult,
): SkillMetadata {
  const next: SkillMetadata = {
    ...metadata,
    provenanceState: lookup.provenanceState,
  };
  if (lookup.gitSha) next.gitSha = lookup.gitSha;
  if (lookup.installSource) next.installSource = lookup.installSource;
  return next;
}

function findGitRoot(start: string): string | undefined {
  let current = start;
  while (current) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

function gitShaForPath(gitRoot: string, skillPath: string): string | undefined {
  try {
    const stdout = execFileSync(
      'git',
      ['-C', gitRoot, 'log', '-n', '1', '--format=%H', '--', skillPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return stdout || undefined;
  } catch {
    return undefined;
  }
}

function inferInstallSource(skillPath: string, gitRoot: string): InstallSource | undefined {
  const rel = skillPath.slice(gitRoot.length);
  if (rel.startsWith(`${sep}packages${sep}`)) return 'pnpm-workspace';
  if (rel.startsWith(`${sep}skills${sep}`)) return 'agentbnb-skill';
  if (skillPath.includes(`${sep}.openclaw${sep}`)) return 'openclaw-import';
  return 'manual-copy';
}
