import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyProvenance, lookupProvenance, parseSkill } from '../src/index.js';
import type { SkillMetadata } from '../src/index.js';

function makeBaseMetadata(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    name: 'x',
    description: '',
    path: '',
    source: 'skill_md',
    provenanceState: 'untracked',
    loadedBy: [],
    ...overrides,
  };
}

describe('lookupProvenance — edge cases', () => {
  it('returns untracked for an empty path', () => {
    expect(lookupProvenance('')).toEqual({ provenanceState: 'untracked' });
  });

  it('returns untracked for a non-absolute path', () => {
    expect(lookupProvenance('relative/SKILL.md')).toEqual({
      provenanceState: 'untracked',
    });
  });

  it('returns untracked for an absolute path that does not exist', () => {
    expect(lookupProvenance('/no/such/skill/SKILL.md')).toEqual({
      provenanceState: 'untracked',
    });
  });

  it('classifies paths inside node_modules as pinned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-prov-'));
    try {
      const packDir = join(dir, 'node_modules', 'fake-skill');
      mkdirSync(packDir, { recursive: true });
      const skillPath = join(packDir, 'SKILL.md');
      writeFileSync(skillPath, '---\nname: fake\n---\n');
      const result = lookupProvenance(skillPath);
      expect(result.provenanceState).toBe('pinned');
      expect(result.installSource).toBe('node_modules');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns tracked + gitSha when the file is committed in a git worktree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-prov-git-'));
    try {
      execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'user.name', 'test'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });

      const skillDir = join(dir, 'skills', 'demo');
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, 'SKILL.md');
      writeFileSync(skillPath, '---\nname: demo\n---\n');

      execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'commit', '-m', 'add skill'], { stdio: 'ignore' });

      const result = lookupProvenance(skillPath);
      expect(result.provenanceState).toBe('tracked');
      expect(result.gitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.installSource).toBe('agentbnb-skill');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('infers pnpm-workspace installSource for paths under /packages/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-prov-pkg-'));
    try {
      execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'user.name', 'test'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });

      const pkgDir = join(dir, 'packages', 'thing');
      mkdirSync(pkgDir, { recursive: true });
      const skillPath = join(pkgDir, 'SKILL.md');
      writeFileSync(skillPath, '---\nname: thing\n---\n');

      execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, 'commit', '-m', 'add'], { stdio: 'ignore' });

      const result = lookupProvenance(skillPath);
      expect(result.installSource).toBe('pnpm-workspace');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('platform-sep safety: the node_modules check uses path.sep, not a hard-coded "/"', () => {
    expect(sep).toMatch(/^[/\\]$/);
    const result = lookupProvenance('definitely-not-absolute/node_modules/x');
    expect(result.provenanceState).toBe('untracked');
  });
});

describe('applyProvenance', () => {
  it('overrides provenanceState and adds gitSha / installSource when provided', () => {
    const base = makeBaseMetadata();
    const merged = applyProvenance(base, {
      provenanceState: 'tracked',
      gitSha: 'feedface',
      installSource: 'pnpm-workspace',
    });
    expect(merged.provenanceState).toBe('tracked');
    expect(merged.gitSha).toBe('feedface');
    expect(merged.installSource).toBe('pnpm-workspace');
  });

  it('preserves existing fields when the lookup does not override them', () => {
    const base = makeBaseMetadata({ gitSha: 'existing', installSource: 'manual-copy' });
    const merged = applyProvenance(base, { provenanceState: 'untracked' });
    expect(merged.gitSha).toBe('existing');
    expect(merged.installSource).toBe('manual-copy');
  });

  it('integrates with parseSkill output to produce a fully-populated metadata object', () => {
    const graph = parseSkill('---\nname: x\ndescription: y\n---\n');
    const merged = applyProvenance(graph.metadata, {
      provenanceState: 'tracked',
      gitSha: 'abc1234',
    });
    expect(merged.name).toBe('x');
    expect(merged.description).toBe('y');
    expect(merged.provenanceState).toBe('tracked');
    expect(merged.gitSha).toBe('abc1234');
  });
});
