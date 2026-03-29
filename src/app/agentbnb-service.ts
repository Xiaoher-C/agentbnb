import { randomUUID } from 'node:crypto';
import type { AgentBnBConfig } from '../cli/config.js';
import { getConfigDir } from '../cli/config.js';
import { loadOrRepairIdentity } from '../identity/identity.js';
import { createSignedEscrowReceipt } from '../credit/escrow-receipt.js';
import { settleRequesterEscrow, releaseRequesterEscrow } from '../credit/settlement.js';
import { openDatabase, getCard } from '../registry/store.js';
import { searchCards, filterCards } from '../registry/matcher.js';
import { fetchRemoteCards } from '../cli/remote-registry.js';
import { requestCapability, requestViaRelay as requestCapabilityViaRelay } from '../gateway/client.js';
import { createLedger } from '../credit/create-ledger.js';
import { openCreditDb, getBalance as getLocalBalance } from '../credit/ledger.js';
import { AnyCardSchema, AgentBnBError } from '../types/index.js';
import type { AnyCard, EscrowReceipt } from '../types/index.js';
import { RelayClient } from '../relay/websocket-client.js';
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
  private readonly coordinator: ServiceCoordinator;
  private readonly config: AgentBnBConfig;

  constructor(
    coordinator: ServiceCoordinator,
    config: AgentBnBConfig,
  ) {
    this.coordinator = coordinator;
    this.config = config;
  }

  async ensureRunning(opts?: ServiceOptions): Promise<'started' | 'already_running'> {
    return this.coordinator.ensureRunning(opts);
  }

  async getNodeStatus(): Promise<ServiceStatus> {
    return this.coordinator.getStatus();
  }

  async stop(): Promise<void> {
    await this.coordinator.stop();
  }

  async restart(opts?: ServiceOptions): Promise<void> {
    await this.coordinator.restart(opts);
  }

  async healthCheck(): Promise<HealthResult> {
    return this.coordinator.healthCheck();
  }

  /**
   * Discovers capabilities with local-first strategy, then merges remote registry cards.
   */
  async discoverCapabilities(query: DiscoverQuery): Promise<AnyCard[]> {
    const local = this.discoverLocal(query);
    const remote = await this.discoverRemote(query);
    const merged = mergeCardsLocalFirst(local, remote);

    const filteredByReputation = query.minReputation !== undefined
      ? merged.filter((card) => getCardReputation(card) >= query.minReputation!)
      : merged;

    return sortCards(filteredByReputation, query.sort);
  }

  /**
   * Requester-side capability rental flow.
   *
   * Creates signed escrow on requester side, sends request via gateway client,
   * settles escrow on success, and releases escrow on failure.
   */
  async rentCapability(params: RentCapabilityParams): Promise<RentResult> {
    if (!Number.isFinite(params.maxCredits) || params.maxCredits <= 0) {
      throw new AgentBnBError(
        `maxCredits must be a positive number, got: ${params.maxCredits}`,
        'INVALID_MAX_CREDITS',
      );
    }

    const target = await this.resolveTargetCard(params.cardId);
    const canRelay = target.remote && Boolean(this.config.registry && target.owner);
    if (!target.gatewayUrl && !canRelay) {
      throw new AgentBnBError(
        `Target card ${params.cardId} has no gateway_url; provider may be offline.`,
        'MISSING_GATEWAY_URL',
      );
    }

    const creditDb = openCreditDb(this.config.credit_db_path);
    creditDb.pragma('busy_timeout = 5000');

    try {
      const { keys } = loadOrRepairIdentity(getConfigDir(), this.config.owner);
      const { escrowId, receipt } = createSignedEscrowReceipt(
        creditDb,
        keys.privateKey,
        keys.publicKey,
        {
          owner: this.config.owner,
          amount: params.maxCredits,
          cardId: params.cardId,
          skillId: params.skillId,
        },
      );

      try {
        const requestParams = {
          ...params.taskParams,
          ...(params.skillId ? { skill_id: params.skillId } : {}),
          requester: this.config.owner,
        };
        let result: unknown;

        if (!target.gatewayUrl) {
          result = await this.requestViaRelay({
            targetOwner: target.owner,
            cardId: params.cardId,
            skillId: params.skillId,
            params: requestParams,
            escrowReceipt: receipt,
          });
        } else {
          try {
            result = await requestCapability({
              gatewayUrl: target.gatewayUrl,
              token: target.token,
              cardId: params.cardId,
              params: requestParams,
              escrowReceipt: receipt,
              identity: target.remote ? this.loadIdentityAuth() : undefined,
            });
          } catch (directErr) {
            if (canRelay && isNetworkError(directErr)) {
              result = await this.requestViaRelay({
                targetOwner: target.owner,
                cardId: params.cardId,
                skillId: params.skillId,
                params: requestParams,
                escrowReceipt: receipt,
              });
            } else {
              throw directErr;
            }
          }
        }

        settleRequesterEscrow(creditDb, escrowId);
        return {
          transactionId: escrowId,
          result,
        };
      } catch (err) {
        releaseRequesterEscrow(creditDb, escrowId);
        throw err;
      }
    } finally {
      creditDb.close();
    }
  }

  // TODO: final input shape decided with supply bridge.
  // Keep explicit stub to avoid binding to a premature publish path.
  async shareCapability(input: ShareCapabilityInput): Promise<void> {
    void input;
    throw new AgentBnBError(
      'shareCapability() is intentionally not implemented yet.',
      'NOT_IMPLEMENTED',
    );
  }

  async submitFeedback(feedback: FeedbackInput): Promise<void> {
    void feedback;
    throw new AgentBnBError(
      'submitFeedback() is not implemented yet.',
      'NOT_IMPLEMENTED',
    );
  }

  async getBalance(): Promise<number> {
    if (this.config.registry) {
      try {
        const identity = this.loadIdentityAuth();
        const ledger = createLedger({
          registryUrl: this.config.registry,
          ownerPublicKey: identity.publicKey,
          privateKey: identity.privateKey,
        });
        return await ledger.getBalance(this.config.owner);
      } catch {
        // Fall back to local ledger when registry is unreachable.
      }
    }

    const creditDb = openCreditDb(this.config.credit_db_path);
    try {
      return getLocalBalance(creditDb, this.config.owner);
    } finally {
      creditDb.close();
    }
  }

  private discoverLocal(query: DiscoverQuery): AnyCard[] {
    const db = openDatabase(this.config.db_path);
    try {
      const localRaw = query.capability
        ? searchCards(db, query.capability, {
            online: query.onlineOnly,
            min_reputation: query.minReputation,
          })
        : filterCards(db, {
            online: query.onlineOnly,
            min_reputation: query.minReputation,
          });
      return parseAnyCards(localRaw);
    } finally {
      db.close();
    }
  }

  private async discoverRemote(query: DiscoverQuery): Promise<AnyCard[]> {
    if (!this.config.registry) return [];

    try {
      const cards = await fetchRemoteCards(this.config.registry, {
        q: query.capability,
        online: query.onlineOnly,
      });
      return parseAnyCards(cards);
    } catch {
      return [];
    }
  }

  private async resolveTargetCard(cardId: string): Promise<{
    gatewayUrl: string;
    token: string;
    remote: boolean;
    owner: string;
  }> {
    const db = openDatabase(this.config.db_path);
    try {
      const local = getCard(db, cardId);
      if (local) {
        return {
          gatewayUrl: this.config.gateway_url,
          token: this.config.token,
          remote: false,
          owner: local.owner,
        };
      }
    } finally {
      db.close();
    }

    if (!this.config.registry) {
      throw new AgentBnBError(
        `Card ${cardId} not found locally and no registry configured.`,
        'CARD_NOT_FOUND',
      );
    }

    const response = await fetch(`${this.config.registry.replace(/\/$/, '')}/cards/${cardId}`);
    if (!response.ok) {
      throw new AgentBnBError(
        `Card ${cardId} not found on remote registry (${response.status}).`,
        'CARD_NOT_FOUND',
      );
    }

    const remoteRaw = (await response.json()) as unknown;
    const parsed = AnyCardSchema.safeParse(remoteRaw);
    if (!parsed.success) {
      throw new AgentBnBError(
        `Remote card ${cardId} is invalid: ${parsed.error.message}`,
        'INVALID_REMOTE_CARD',
      );
    }

    const gatewayUrl = readGatewayUrl(parsed.data);
    return {
      gatewayUrl: gatewayUrl ?? '',
      token: '',
      remote: true,
      owner: parsed.data.owner,
    };
  }

  private async requestViaRelay(opts: {
    targetOwner: string;
    cardId: string;
    skillId?: string;
    params: Record<string, unknown>;
    escrowReceipt?: EscrowReceipt;
  }): Promise<unknown> {
    if (!this.config.registry) {
      throw new AgentBnBError('Registry is required for relay fallback.', 'RELAY_NOT_AVAILABLE');
    }

    const requesterId = `${this.config.owner}:req:${randomUUID()}`;
    const tempRelay = new RelayClient({
      registryUrl: this.config.registry,
      owner: requesterId,
      token: this.config.token,
      card: {
        id: randomUUID(),
        owner: requesterId,
        name: requesterId,
        description: 'Requester',
        level: 1,
        spec_version: '1.0',
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 1 },
        availability: { online: false },
      },
      onRequest: async () => ({ error: { code: -32601, message: 'Not serving' } }),
      silent: true,
    });

    try {
      await tempRelay.connect();
      return await requestCapabilityViaRelay(tempRelay, {
        targetOwner: opts.targetOwner,
        cardId: opts.cardId,
        skillId: opts.skillId,
        params: opts.params,
        requester: this.config.owner,
        escrowReceipt: opts.escrowReceipt,
      });
    } finally {
      tempRelay.disconnect();
    }
  }

  private loadIdentityAuth(): import('../gateway/client.js').IdentityAuth {
    const configDir = getConfigDir();
    const { identity, keys } = loadOrRepairIdentity(configDir, this.config.owner);
    return {
      agentId: identity.agent_id,
      publicKey: identity.public_key,
      privateKey: keys.privateKey,
    };
  }
}

function parseAnyCards(cards: unknown[]): AnyCard[] {
  const parsed: AnyCard[] = [];
  for (const card of cards) {
    const result = AnyCardSchema.safeParse(card);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

function mergeCardsLocalFirst(local: AnyCard[], remote: AnyCard[]): AnyCard[] {
  const localIds = new Set(local.map((card) => card.id));
  const merged = [...local];
  for (const card of remote) {
    if (!localIds.has(card.id)) {
      merged.push(card);
    }
  }
  return merged;
}

function sortCards(cards: AnyCard[], sort?: DiscoverQuery['sort']): AnyCard[] {
  if (!sort) return cards;
  const sorted = [...cards];
  if (sort === 'price_asc') {
    sorted.sort((a, b) => getCardPrice(a) - getCardPrice(b));
  } else if (sort === 'reputation_desc') {
    sorted.sort((a, b) => getCardReputation(b) - getCardReputation(a));
  }
  return sorted;
}

function getCardPrice(card: AnyCard): number {
  if (card.spec_version === '1.0') {
    return card.pricing.credits_per_call;
  }
  const prices = card.skills.map((skill) => skill.pricing.credits_per_call);
  return prices.length > 0 ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function getCardReputation(card: AnyCard): number {
  if (card.spec_version === '1.0') {
    return card.metadata?.success_rate ?? 0;
  }
  const values = card.skills
    .map((skill) => skill.metadata?.success_rate)
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readGatewayUrl(card: AnyCard): string | undefined {
  if (card.spec_version === '1.0') {
    return card.gateway_url;
  }
  return card.gateway_url;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof AgentBnBError && err.code === 'NETWORK_ERROR') {
    return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('NETWORK_ERROR')
    || msg.includes('ECONNREFUSED')
    || msg.includes('fetch failed')
    || msg.includes('Network error');
}
