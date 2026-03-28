import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {
  RelayMessageSchema,
  type IncomingRequestMessage,
  type ResponseMessage,
  type ErrorMessage,
} from './types.js';

/** Result of handling an incoming relay request */
export interface RelayHandlerResult {
  result?: unknown;
  error?: { code: number; message: string };
}

/** Options for the RelayClient constructor */
/** V8 Phase 3: Additional agent to register on the same connection */
export interface DelegatedAgent {
  agent_id: string;
  display_name: string;
  cards: Record<string, unknown>[];
  delegation_token?: Record<string, unknown>;
}

/** Options for the RelayClient constructor */
export interface RelayClientOptions {
  /** Registry WebSocket URL (e.g., "wss://hub.agentbnb.dev/ws") */
  registryUrl: string;
  /** Agent owner identifier */
  owner: string;
  /** V8: Cryptographic agent identity */
  agent_id?: string;
  /** V8 Phase 3: Server identifier for multi-agent delegation */
  server_id?: string;
  /** Authentication token */
  token: string;
  /** Capability card data to register */
  card: Record<string, unknown>;
  /** Additional cards to register alongside the primary card (e.g., conductor card) */
  cards?: Record<string, unknown>[];
  /** V8 Phase 3: Additional agents served by this connection */
  agents?: DelegatedAgent[];
  /** Handler for incoming relay requests from other agents */
  onRequest: (req: IncomingRequestMessage) => Promise<RelayHandlerResult>;
  /** Suppress logging. Default false. */
  silent?: boolean;
}

/** Options for making a relay request to another agent */
export interface RelayRequestOptions {
  targetOwner: string;
  /** V8: Target agent's cryptographic identity. Preferred for routing. */
  targetAgentId?: string;
  cardId: string;
  skillId?: string;
  params: Record<string, unknown>;
  requester?: string;
  escrowReceipt?: Record<string, unknown>;
  timeoutMs?: number;
  /** Optional callback invoked when the provider sends relay_progress heartbeats. */
  onProgress?: (progress: { id: string; progress?: number; message?: string }) => void;
}

/** Pending outbound request tracking */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  onProgress?: (progress: { id: string; progress?: number; message?: string }) => void;
}

/**
 * WebSocket client for connecting to an AgentBnB registry relay.
 * Handles registration, auto-reconnect, incoming requests, and outbound relay requests.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly opts: RelayClientOptions;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private registered = false;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RelayClientOptions) {
    this.opts = opts;
  }

  /**
   * Connect to the registry relay and register.
   * Resolves when registration is acknowledged.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.intentionalClose = false;
      this.registered = false;

      const wsUrl = this.buildWsUrl();
      this.ws = new WebSocket(wsUrl);

      let resolved = false;

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.startPingInterval();

        // Send registration with optional additional cards
        this.send({
          type: 'register',
          owner: this.opts.owner,
          ...(this.opts.agent_id ? { agent_id: this.opts.agent_id } : {}),
          ...(this.opts.server_id ? { server_id: this.opts.server_id } : {}),
          token: this.opts.token,
          card: this.opts.card,
          ...(this.opts.cards && this.opts.cards.length > 0 ? { cards: this.opts.cards } : {}),
          ...(this.opts.agents && this.opts.agents.length > 0 ? { agents: this.opts.agents } : {}),
        });
      });

      this.ws.on('message', (raw: Buffer | string) => {
        this.handleMessage(raw, (err) => {
          if (!resolved) {
            resolved = true;
            if (err) reject(err);
            else resolve();
          }
        });
      });

      this.ws.on('close', () => {
        this.cleanup();
        if (!this.intentionalClose) {
          if (!resolved) {
            resolved = true;
            reject(new Error('WebSocket closed before registration'));
          }
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      // Connection timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection timeout'));
          this.ws?.close();
        }
      }, 10_000);
    });
  }

  /**
   * Disconnect from the registry relay.
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    if (this.ws) {
      try { this.ws.close(1000, 'Client disconnect'); } catch { /* ignore */ }
      this.ws = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Send a relay request to another agent via the registry.
   * @returns The result from the target agent.
   */
  async request(opts: RelayRequestOptions): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.registered) {
      throw new Error('Not connected to registry relay');
    }

    const id = randomUUID();
    const timeoutMs = opts.timeoutMs ?? 300_000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Relay request timeout'));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout, timeoutMs, onProgress: opts.onProgress });

      this.send({
        type: 'relay_request',
        id,
        target_owner: opts.targetOwner,
        ...(opts.targetAgentId ? { target_agent_id: opts.targetAgentId } : {}),
        card_id: opts.cardId,
        skill_id: opts.skillId,
        params: opts.params,
        requester: opts.requester ?? this.opts.owner,
        escrow_receipt: opts.escrowReceipt,
      });
    });
  }

  /**
   * Send a relay_progress message to the relay server for a given request.
   * Used by the onRequest handler to forward SkillExecutor progress updates
   * to the requesting agent so it can reset its timeout window.
   *
   * @param requestId - The relay request ID to associate progress with.
   * @param info - Progress details (step, total, message).
   */
  sendProgress(requestId: string, info: { step: number; total: number; message: string }): void {
    this.send({
      type: 'relay_progress',
      id: requestId,
      progress: Math.round((info.step / info.total) * 100),
      message: info.message,
    });
  }

  /** Whether the client is connected and registered */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.registered;
  }

  // ── Private methods ─────────────────────────────────────────────────────────

  private buildWsUrl(): string {
    let url = this.opts.registryUrl;

    // Normalize protocol
    if (url.startsWith('http://')) {
      url = 'ws://' + url.slice(7);
    } else if (url.startsWith('https://')) {
      url = 'wss://' + url.slice(8);
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = 'wss://' + url;
    }

    // Ensure /ws path
    if (!url.endsWith('/ws')) {
      url = url.replace(/\/$/, '') + '/ws';
    }

    return url;
  }

  private handleMessage(raw: Buffer | string, onRegistered?: (err?: Error) => void): void {
    let data: unknown;
    try {
      data = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
    } catch {
      return;
    }

    const parsed = RelayMessageSchema.safeParse(data);
    if (!parsed.success) return;

    const msg = parsed.data;

    switch (msg.type) {
      case 'registered':
        this.registered = true;
        if (!this.opts.silent) {
          console.log(`  ✓ Registered with registry (agent_id: ${msg.agent_id})`);
        }
        onRegistered?.();
        break;

      case 'incoming_request':
        this.handleIncomingRequest(msg as IncomingRequestMessage);
        break;

      case 'response':
        this.handleResponse(msg as ResponseMessage);
        break;

      case 'error':
        this.handleError(msg as ErrorMessage);
        break;

      case 'relay_progress':
        this.handleProgress(msg as import('./types.js').RelayProgressMessage);
        break;

      default:
        break;
    }
  }

  private async handleIncomingRequest(msg: IncomingRequestMessage): Promise<void> {
    try {
      const result = await this.opts.onRequest(msg);
      this.send({
        type: 'relay_response',
        id: msg.id,
        result: result.result,
        error: result.error,
      });
    } catch (err) {
      this.send({
        type: 'relay_response',
        id: msg.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      });
    }
  }

  private handleResponse(msg: ResponseMessage): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleError(msg: ErrorMessage): void {
    if (msg.request_id) {
      const pending = this.pendingRequests.get(msg.request_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.request_id);
        pending.reject(new Error(`${msg.code}: ${msg.message}`));
      }
    }
  }

  private handleProgress(msg: import('./types.js').RelayProgressMessage): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return; // Unknown request ID — ignore

    // Reset the outbound request timeout so a slow but alive provider doesn't get cut off
    clearTimeout(pending.timeout);
    const newTimeout = setTimeout(() => {
      this.pendingRequests.delete(msg.id);
      pending.reject(new Error('Relay request timeout'));
    }, pending.timeoutMs);
    pending.timeout = newTimeout;

    // Invoke the caller's onProgress callback if provided
    if (pending.onProgress) {
      pending.onProgress({ id: msg.id, progress: msg.progress, message: msg.message });
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval();

    // Send ping every 30s, expect pong within 45s
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();

        this.pongTimeout = setTimeout(() => {
          if (!this.opts.silent) {
            console.log('  ⚠ Registry pong timeout, reconnecting...');
          }
          this.ws?.terminate();
        }, 15_000); // 15s pong grace period
      }
    }, 30_000);

    // Reset pong timeout on pong
    this.ws?.on('pong', () => {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
    });
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private cleanup(): void {
    this.stopPingInterval();
    this.registered = false;
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectTimer) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    if (!this.opts.silent) {
      console.log(`  ↻ Reconnecting to registry in ${delay / 1000}s...`);
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        if (!this.opts.silent) {
          console.log('  ✓ Reconnected to registry');
        }
      } catch {
        // connect() will trigger another close → scheduleReconnect
      }
    }, delay);
  }
}
