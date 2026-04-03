import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// ----- Module mocks (hoisted by vitest) -----

const mockSpawn = vi.fn();
const mockUnref = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return { ...orig, spawn: mockSpawn };
});

vi.mock('./resolve-self-cli.js', () => ({
  resolveSelfCli: () => '/fake/cli/index.js',
}));

/**
 * Find a PID that is not running on this machine (for stale-pid testing).
 */
function findStalePidCandidate(): number {
  let candidate = 900_000;
  while (candidate < 1_500_000) {
    try {
      process.kill(candidate, 0);
      candidate++;
    } catch (err) {
      const killErr = err as NodeJS.ErrnoException;
      if (killErr.code === 'ESRCH') {
        return candidate;
      }
      candidate++;
    }
  }
  return 9_999_999;
}

describe('daemon', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-daemon-'));
    vi.stubEnv('AGENTBNB_DIR', tmpDir);

    mockSpawn.mockReset();
    mockUnref.mockReset();
    mockSpawn.mockReturnValue({ pid: 123456, unref: mockUnref });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readDaemonPid returns null when no PID file exists', async () => {
    const { readDaemonPid } = await import('./daemon.js');
    expect(readDaemonPid()).toBeNull();
  });

  it('readDaemonPid returns null and cleans up stale PID file', async () => {
    const stalePid = findStalePidCandidate();
    writeFileSync(join(tmpDir, 'serve.pid'), String(stalePid));

    const { readDaemonPid } = await import('./daemon.js');
    expect(readDaemonPid()).toBeNull();
    expect(existsSync(join(tmpDir, 'serve.pid'))).toBe(false);
  });

  it('readDaemonPid returns null and cleans up non-numeric PID file', async () => {
    writeFileSync(join(tmpDir, 'serve.pid'), 'not-a-number');

    const { readDaemonPid } = await import('./daemon.js');
    expect(readDaemonPid()).toBeNull();
    expect(existsSync(join(tmpDir, 'serve.pid'))).toBe(false);
  });

  it('readDaemonPid returns PID when process is alive (current process)', async () => {
    writeFileSync(join(tmpDir, 'serve.pid'), String(process.pid));

    const { readDaemonPid } = await import('./daemon.js');
    expect(readDaemonPid()).toBe(process.pid);
  });

  it('stopDaemon removes PID file for stale process', async () => {
    const stalePid = findStalePidCandidate();
    writeFileSync(join(tmpDir, 'serve.pid'), String(stalePid));

    const { stopDaemon } = await import('./daemon.js');
    stopDaemon();
    expect(existsSync(join(tmpDir, 'serve.pid'))).toBe(false);
  });

  it('stopDaemon prints not-running when no daemon exists', async () => {
    const { stopDaemon } = await import('./daemon.js');
    const consoleSpy = vi.spyOn(console, 'log');

    stopDaemon();

    expect(consoleSpy).toHaveBeenCalledWith('AgentBnB serve is not running.');
    consoleSpy.mockRestore();
  });

  it('daemonStatus does not throw when no daemon is running', async () => {
    const { daemonStatus } = await import('./daemon.js');
    const consoleSpy = vi.spyOn(console, 'log');

    expect(() => daemonStatus()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith('AgentBnB serve is not running.');
    consoleSpy.mockRestore();
  });

  it('daemonStatus reports running when PID file points to live process', async () => {
    writeFileSync(join(tmpDir, 'serve.pid'), String(process.pid));

    const { daemonStatus } = await import('./daemon.js');
    const consoleSpy = vi.spyOn(console, 'log');

    daemonStatus();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(`PID: ${process.pid}`),
    );
    consoleSpy.mockRestore();
  });

  it('startDaemon creates PID file via spawn', async () => {
    const { startDaemon } = await import('./daemon.js');

    startDaemon(['--announce']);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnArgs = mockSpawn.mock.calls[0]!;
    expect(spawnArgs[1] as string[]).toEqual(
      expect.arrayContaining(['serve', '--announce']),
    );

    // PID file should be written
    const pidContent = readFileSync(join(tmpDir, 'serve.pid'), 'utf-8').trim();
    expect(pidContent).toBe('123456');

    expect(mockUnref).toHaveBeenCalledOnce();
  });

  it('startDaemon filters out daemon flags from child args', async () => {
    const { startDaemon } = await import('./daemon.js');

    startDaemon(['--daemon', '--announce', '--status', '--port', '8080']);

    const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).toContain('--announce');
    expect(spawnArgs).toContain('--port');
    expect(spawnArgs).toContain('8080');
    expect(spawnArgs).not.toContain('--daemon');
    expect(spawnArgs).not.toContain('--status');
  });
});
