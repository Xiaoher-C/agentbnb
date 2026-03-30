import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { AgentBnBError } from '../types/index.js';

interface ResolveSelfCliDeps {
  argv1?: string;
  cwd: string;
  platform: NodeJS.Platform;
  homeDir: string;
  envPath?: string;
  nodeExecDir?: string;
  exists: (path: string) => boolean;
  realpath: (path: string) => string;
  runWhich: (pathEnv: string) => string;
  requireResolve: (id: string) => string;
}

/**
 * Resolves the absolute path to the current AgentBnB CLI.
 *
 * Priority:
 * 1. process.argv[1] when it resolves to this CLI.
 * 2. `which agentbnb` with a full PATH.
 * 3. npm global paths.
 * 4. pnpm global paths.
 * 5. `require.resolve('agentbnb/dist/cli/index.js')`.
 *
 * Throws CLI_ENTRY_NOT_FOUND with all attempted paths when no candidate works.
 */
export function resolveSelfCli(): string {
  const require = createRequire(import.meta.url);
  return resolveSelfCliWithDeps({
    argv1: process.argv[1],
    cwd: process.cwd(),
    platform: process.platform,
    homeDir: homedir(),
    envPath: process.env['PATH'],
    nodeExecDir: dirname(process.execPath),
    exists: existsSync,
    realpath: realpathSync,
    runWhich: (pathEnv) =>
      execFileSync('which', ['agentbnb'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: pathEnv },
      }).trim(),
    requireResolve: (id) => require.resolve(id),
  });
}

/**
 * Test seam for deterministic resolver behavior.
 */
export function resolveSelfCliWithDeps(deps: ResolveSelfCliDeps): string {
  const tried: string[] = [];

  const tryCandidate = (
    rawPath: string | undefined,
    label: string,
    requireCliShape = false,
  ): string | null => {
    if (!rawPath || rawPath.trim().length === 0) {
      tried.push(`${label}: <empty>`);
      return null;
    }

    const maybeAbsolute = isAbsolute(rawPath) ? rawPath : resolve(deps.cwd, rawPath);
    tried.push(`${label}: ${maybeAbsolute}`);

    if (!deps.exists(maybeAbsolute)) return null;
    const resolvedPath = safeRealpath(deps.realpath, maybeAbsolute);
    if (requireCliShape && !looksLikeAgentbnbCli(resolvedPath)) return null;
    return resolvedPath;
  };

  const argvPath = tryCandidate(deps.argv1, 'process.argv[1]', true);
  if (argvPath) return argvPath;

  const fullPathEnv = buildFullPathEnv(deps.envPath, deps.homeDir, deps.nodeExecDir);
  tried.push(`which agentbnb PATH=${fullPathEnv}`);
  try {
    const whichPath = tryCandidate(deps.runWhich(fullPathEnv), 'which agentbnb');
    if (whichPath) return whichPath;
  } catch (err) {
    tried.push(`which agentbnb failed: ${extractErrorMessage(err)}`);
  }

  const npmGlobalCandidates = ['/usr/local/bin/agentbnb', '/opt/homebrew/bin/agentbnb'];
  for (const candidate of npmGlobalCandidates) {
    const resolvedPath = tryCandidate(candidate, 'npm-global');
    if (resolvedPath) return resolvedPath;
  }

  const pnpmCandidates = getPnpmGlobalCandidates(deps.platform, deps.homeDir);
  for (const candidate of pnpmCandidates) {
    const resolvedPath = tryCandidate(candidate, 'pnpm-global');
    if (resolvedPath) return resolvedPath;
  }

  if (deps.nodeExecDir) {
    const execDirCandidate = tryCandidate(
      join(deps.nodeExecDir, 'agentbnb'),
      'node-execpath-dir',
    );
    if (execDirCandidate) return execDirCandidate;
  }

  try {
    const requireResolved = deps.requireResolve('agentbnb/dist/cli/index.js');
    const resolvedPath = tryCandidate(requireResolved, 'require.resolve(agentbnb/dist/cli/index.js)');
    if (resolvedPath) return resolvedPath;
  } catch (err) {
    tried.push(`require.resolve(agentbnb/dist/cli/index.js) failed: ${extractErrorMessage(err)}`);
  }

  throw new AgentBnBError(
    `Unable to resolve absolute path to agentbnb CLI.\nPaths tried:\n${tried.map((item) => `- ${item}`).join('\n')}`,
    'CLI_ENTRY_NOT_FOUND',
  );
}

function buildFullPathEnv(pathEnv: string | undefined, homeDir: string, nodeExecDir?: string): string {
  const values = new Set<string>();
  for (const item of (pathEnv ?? '').split(':')) {
    if (item.trim()) values.add(item.trim());
  }

  for (const extra of [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    join(homeDir, '.local', 'bin'),
    join(homeDir, 'Library', 'pnpm'),
    join(homeDir, '.local', 'share', 'pnpm'),
  ]) {
    values.add(extra);
  }

  if (nodeExecDir) {
    values.add(nodeExecDir);
  }

  return [...values].join(':');
}

function safeRealpath(realpath: (path: string) => string, path: string): string {
  try {
    return realpath(path);
  } catch {
    return path;
  }
}

function getPnpmGlobalCandidates(platform: NodeJS.Platform, homeDir: string): string[] {
  const candidates = new Set<string>();
  if (platform === 'darwin') {
    candidates.add(join(homeDir, 'Library', 'pnpm', 'agentbnb'));
  }
  if (platform === 'linux') {
    candidates.add(join(homeDir, '.local', 'share', 'pnpm', 'agentbnb'));
  }
  // Defensive cross-platform fallback when runtime platform detection is odd.
  candidates.add(join(homeDir, 'Library', 'pnpm', 'agentbnb'));
  candidates.add(join(homeDir, '.local', 'share', 'pnpm', 'agentbnb'));
  return [...candidates];
}

function looksLikeAgentbnbCli(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const fileName = basename(normalized);
  if (fileName === 'agentbnb' || fileName === 'agentbnb.cmd' || fileName === 'agentbnb.exe') {
    return true;
  }
  return (
    normalized.includes('/agentbnb/dist/cli/index.') ||
    normalized.endsWith('/dist/cli/index.js') ||
    normalized.endsWith('/dist/cli/index.mjs') ||
    normalized.endsWith('/dist/cli/index.cjs')
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
