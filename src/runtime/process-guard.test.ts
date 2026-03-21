import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ProcessGuard } from './process-guard.js';

function findStalePidCandidate(): number {
  // Pick a high pid and verify it does not exist on this machine.
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

describe('ProcessGuard', () => {
  let tmpDir: string;
  let pidFilePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-process-guard-'));
    pidFilePath = join(tmpDir, '.pid');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquire writes pid file with required schema', () => {
    const guard = new ProcessGuard(pidFilePath);
    const startedAt = new Date().toISOString();

    guard.acquire({
      started_at: startedAt,
      port: 7700,
      owner: 'test-owner',
    });

    const raw = readFileSync(pidFilePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      pid: number;
      started_at: string;
      port: number;
      owner: string;
    };

    expect(parsed.pid).toBe(process.pid);
    expect(parsed.started_at).toBe(startedAt);
    expect(parsed.port).toBe(7700);
    expect(parsed.owner).toBe('test-owner');

    guard.release();
  });

  it('acquire fails when a live process already holds lock', () => {
    const first = new ProcessGuard(pidFilePath);
    const second = new ProcessGuard(pidFilePath);

    first.acquire({
      started_at: new Date().toISOString(),
      port: 7700,
      owner: 'owner-a',
    });

    expect(() =>
      second.acquire({
        started_at: new Date().toISOString(),
        port: 7701,
        owner: 'owner-b',
      }),
    ).toThrow(/already running/i);

    first.release();
  });

  it('acquire auto-cleans stale pid lock and replaces metadata', () => {
    const stalePid = findStalePidCandidate();
    writeFileSync(
      pidFilePath,
      JSON.stringify({
        pid: stalePid,
        started_at: '2026-03-21T00:00:00.000Z',
        port: 7000,
        owner: 'stale-owner',
      }),
      'utf8',
    );

    const guard = new ProcessGuard(pidFilePath);
    guard.acquire({
      started_at: '2026-03-21T00:01:00.000Z',
      port: 7700,
      owner: 'fresh-owner',
    });

    const parsed = JSON.parse(readFileSync(pidFilePath, 'utf8')) as {
      pid: number;
      started_at: string;
      port: number;
      owner: string;
    };

    expect(parsed.pid).toBe(process.pid);
    expect(parsed.owner).toBe('fresh-owner');
    expect(parsed.port).toBe(7700);
    expect(parsed.started_at).toBe('2026-03-21T00:01:00.000Z');

    guard.release();
  });

  it('getRunningMeta returns null and removes stale pid file', () => {
    const stalePid = findStalePidCandidate();
    writeFileSync(
      pidFilePath,
      JSON.stringify({
        pid: stalePid,
        started_at: '2026-03-21T00:00:00.000Z',
        port: 7700,
        owner: 'ghost-owner',
      }),
      'utf8',
    );

    const guard = new ProcessGuard(pidFilePath);
    const meta = guard.getRunningMeta();

    expect(meta).toBeNull();
    expect(existsSync(pidFilePath)).toBe(false);
  });
});

