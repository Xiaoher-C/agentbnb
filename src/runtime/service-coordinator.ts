import type { AgentBnBConfig } from '../cli/config.js';
import { ProcessGuard } from './process-guard.js';

export interface ServiceOptions {
  port?: number;
  skillsYamlPath?: string;
  registryUrl?: string;
  relay?: boolean;
  conductorEnabled?: boolean;
}

export interface ServiceStatus {
  state: 'running' | 'stopped' | 'unknown';
  pid: number | null;
  port: number | null;
  owner: string | null;
  relayConnected: boolean;
  uptime_ms: number | null;
}

export interface HealthResult {
  ok: boolean;
  agentbnb: boolean;
  latency_ms: number;
  version?: string;
  owner?: string;
}

export class ServiceCoordinator {
  constructor(config: AgentBnBConfig, guard: ProcessGuard) {}

  async ensureRunning(opts?: ServiceOptions): Promise<'started' | 'already_running'> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async getStatus(): Promise<ServiceStatus> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async stop(): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async restart(opts?: ServiceOptions): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async healthCheck(): Promise<HealthResult> {
    throw new Error('NOT_IMPLEMENTED');
  }
}
