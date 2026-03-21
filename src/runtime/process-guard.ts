export interface PidFileContent {
  pid: number;
  started_at: string; // ISO 8601
  port: number;
  owner: string;
}

export class ProcessGuard {
  constructor(pidFilePath?: string) {}

  acquire(meta: Omit<PidFileContent, 'pid'>): void {
    throw new Error('NOT_IMPLEMENTED');
  }

  release(): void {
    throw new Error('NOT_IMPLEMENTED');
  }

  getRunningMeta(): PidFileContent | null {
    throw new Error('NOT_IMPLEMENTED');
  }

  isRunning(): boolean {
    return this.getRunningMeta() !== null;
  }
}
