import { describe, expect, it } from 'vitest';
import { resolveSelfCliWithDeps } from './resolve-self-cli.js';

interface TestDepsOverrides {
  argv1?: string;
  platform?: NodeJS.Platform;
  existsPaths?: string[];
  runWhichResult?: string;
  requireResolveResult?: string;
  nodeExecDir?: string;
}

function makeDeps(overrides: TestDepsOverrides = {}) {
  const existing = new Set(overrides.existsPaths ?? []);
  return {
    argv1: overrides.argv1,
    cwd: '/workspace',
    platform: overrides.platform ?? 'darwin',
    homeDir: '/Users/tester',
    envPath: '/usr/bin:/bin',
    nodeExecDir: overrides.nodeExecDir,
    exists: (path: string) => existing.has(path),
    realpath: (path: string) => path,
    runWhich: () => {
      if (overrides.runWhichResult !== undefined) return overrides.runWhichResult;
      throw new Error('which failed');
    },
    requireResolve: () => {
      if (overrides.requireResolveResult !== undefined) return overrides.requireResolveResult;
      throw new Error('not found');
    },
  };
}

describe('resolveSelfCliWithDeps', () => {
  it('resolves npm global agentbnb path', () => {
    const resolved = resolveSelfCliWithDeps(
      makeDeps({
        existsPaths: ['/usr/local/bin/agentbnb'],
      }),
    );
    expect(resolved).toBe('/usr/local/bin/agentbnb');
  });

  it('resolves pnpm global agentbnb path', () => {
    const resolved = resolveSelfCliWithDeps(
      makeDeps({
        platform: 'linux',
        existsPaths: ['/Users/tester/.local/share/pnpm/agentbnb'],
      }),
    );
    expect(resolved).toBe('/Users/tester/.local/share/pnpm/agentbnb');
  });

  it('resolves repo-local cli via require.resolve fallback', () => {
    const resolved = resolveSelfCliWithDeps(
      makeDeps({
        requireResolveResult: '/workspace/node_modules/agentbnb/dist/cli/index.js',
        existsPaths: ['/workspace/node_modules/agentbnb/dist/cli/index.js'],
      }),
    );
    expect(resolved).toBe('/workspace/node_modules/agentbnb/dist/cli/index.js');
  });

  it('resolves agentbnb in the same directory as the node executable (nvm case)', () => {
    const resolved = resolveSelfCliWithDeps(
      makeDeps({
        nodeExecDir: '/Users/tester/.nvm/versions/node/v24.13.1/bin',
        existsPaths: ['/Users/tester/.nvm/versions/node/v24.13.1/bin/agentbnb'],
      }),
    );
    expect(resolved).toBe('/Users/tester/.nvm/versions/node/v24.13.1/bin/agentbnb');
  });

  it('throws helpful error when no CLI path can be resolved', () => {
    expect(() =>
      resolveSelfCliWithDeps(makeDeps()),
    ).toThrowError(/Unable to resolve absolute path to agentbnb CLI/);

    try {
      resolveSelfCliWithDeps(makeDeps());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('Paths tried:');
      expect(message).toContain('/usr/local/bin/agentbnb');
      expect(message).toContain('/opt/homebrew/bin/agentbnb');
      expect(message).toContain('require.resolve(agentbnb/dist/cli/index.js) failed');
    }
  });
});
