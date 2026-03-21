import type { AgentBnBConfig } from '../cli/config.js';
import type { AnyCard } from '../types/index.js';
import type {
  ServiceCoordinator,
  ServiceOptions,
  ServiceStatus,
  HealthResult,
} from '../runtime/service-coordinator.js';

export interface DiscoverQuery {
  capability?: string;
  onlineOnly?: boolean;
  minReputation?: number;
  sort?: 'reputation_desc' | 'price_asc';
}

export interface RentCapabilityParams {
  cardId: string;
  skillId?: string;
  maxCredits: number;
  taskParams: Record<string, unknown>;
}

export interface RentResult {
  transactionId: string;
  result: unknown;
}

export interface ShareCapabilityInput {
  // TODO: finalize after supply bridge design
}

export interface FeedbackInput {
  transactionId: string;
  providerId: string;
  skillId?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  resultQuality: 'excellent' | 'good' | 'acceptable' | 'poor';
  wouldReuse: boolean;
  costValueRatio: 'great' | 'fair' | 'overpriced';
}

export class AgentBnBService {
  constructor(
    coordinator: ServiceCoordinator,
    config: AgentBnBConfig,
  ) {}

  async ensureRunning(opts?: ServiceOptions): Promise<'started' | 'already_running'> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async getNodeStatus(): Promise<ServiceStatus> {
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

  // local-first discovery; remote merge comes later in implementation
  async discoverCapabilities(query: DiscoverQuery): Promise<AnyCard[]> {
    throw new Error('NOT_IMPLEMENTED');
  }

  // requester-side only; must not call provider-side executeCapabilityRequest directly
  async rentCapability(params: RentCapabilityParams): Promise<RentResult> {
    throw new Error('NOT_IMPLEMENTED');
  }

  // TODO: final input shape decided with supply bridge
  async shareCapability(input: ShareCapabilityInput): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async submitFeedback(feedback: FeedbackInput): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }

  async getBalance(): Promise<number> {
    throw new Error('NOT_IMPLEMENTED');
  }
}
