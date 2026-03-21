import { dirname, join } from 'node:path';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { AgentBnBError } from '../types/index.js';

export interface PidFileContent {
  pid: number;
  started_at: string; // ISO 8601
  port: number;
  owner: string;
}

export class ProcessGuard {
  private readonly pidFilePath: string;

  /**
   * Creates a ProcessGuard that controls single-process ownership via pid file.
   *
   * @param pidFilePath - Absolute path to pid file. Defaults to ~/.agentbnb/.pid.
   */
  constructor(pidFilePath?: string) {
    this.pidFilePath = pidFilePath ?? join(homedir(), '.agentbnb', '.pid');
  }

  /**
   * Acquires process lock atomically.
   *
   * Uses fs open mode 'wx' so lock creation is a single atomic operation.
   * If a pid file already exists, stale pids are cleaned automatically and
   * acquisition is retried.
   *
   * @param meta - Lock metadata excluding pid (pid is always current process pid).
   * @throws {AgentBnBError} PROCESS_ALREADY_RUNNING if another live process holds lock.
   */
  acquire(meta: Omit<PidFileContent, 'pid'>): void {
    mkdirSync(dirname(this.pidFilePath), { recursive: true });
    const payload: PidFileContent = {
      pid: process.pid,
      started_at: meta.started_at,
      port: meta.port,
      owner: meta.owner,
    };

    // One retry after stale cleanup to handle EEXIST races.
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd: number | null = null;
      try {
        fd = openSync(this.pidFilePath, 'wx');
        writeFileSync(fd, `${JSON.stringify(payload)}\n`, 'utf8');
        return;
      } catch (err) {
        const fsErr = err as NodeJS.ErrnoException;
        if (fsErr.code !== 'EEXIST') {
          throw err;
        }

        const cleaned = this.cleanupStaleLock();
        if (cleaned) {
          continue;
        }

        const running = this.readPidFile();
        const details = running
          ? `pid=${running.pid} owner=${running.owner} port=${running.port}`
          : `pid-file=${this.pidFilePath}`;
        throw new AgentBnBError(
          `AgentBnB process already running (${details})`,
          'PROCESS_ALREADY_RUNNING',
        );
      } finally {
        if (fd !== null) {
          closeSync(fd);
        }
      }
    }

    throw new AgentBnBError(
      `Failed to acquire process lock: ${this.pidFilePath}`,
      'PROCESS_GUARD_ACQUIRE_FAILED',
    );
  }

  /**
   * Releases process lock.
   *
   * Removes pid file only when:
   * - lock belongs to current process, or
   * - lock holder pid is stale.
   */
  release(): void {
    const current = this.readPidFile();
    if (!current) return;

    if (current.pid === process.pid || !this.isPidAlive(current.pid)) {
      this.safeUnlink();
    }
  }

  /**
   * Returns running process metadata if lock holder pid is alive.
   * Automatically clears stale pid files.
   *
   * @returns Running metadata or null when no live lock holder exists.
   */
  getRunningMeta(): PidFileContent | null {
    const meta = this.readPidFile();
    if (!meta) return null;

    if (!this.isPidAlive(meta.pid)) {
      this.safeUnlink();
      return null;
    }
    return meta;
  }

  /**
   * Returns true when a live lock holder exists.
   */
  isRunning(): boolean {
    return this.getRunningMeta() !== null;
  }

  private readPidFile(): PidFileContent | null {
    if (!existsSync(this.pidFilePath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.pidFilePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isPidFileContent(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private cleanupStaleLock(): boolean {
    const existing = this.readPidFile();

    // Corrupted pid file is treated as stale to avoid dead locks.
    if (!existing) {
      return this.safeUnlink();
    }

    if (this.isPidAlive(existing.pid)) {
      return false;
    }
    return this.safeUnlink();
  }

  private safeUnlink(): boolean {
    try {
      unlinkSync(this.pidFilePath);
      return true;
    } catch (err) {
      const fsErr = err as NodeJS.ErrnoException;
      if (fsErr.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  private isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      const killErr = err as NodeJS.ErrnoException;
      if (killErr.code === 'EPERM') {
        // Process exists but cannot be signaled by current user.
        return true;
      }
      if (killErr.code === 'ESRCH') {
        return false;
      }
      return false;
    }
  }
}

function isPidFileContent(value: unknown): value is PidFileContent {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record['pid']) &&
    typeof record['started_at'] === 'string' &&
    Number.isInteger(record['port']) &&
    typeof record['owner'] === 'string'
  );
}
