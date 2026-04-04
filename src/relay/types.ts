import { z } from 'zod';

/**
 * WebSocket relay message types for agent-to-registry communication.
 * All messages are JSON-encoded with a discriminating `type` field.
 */

/** Agent → Registry: Register agent and card on connect */
export const RegisterMessageSchema = z.object({
  type: z.literal('register'),
  owner: z.string().min(1),
  /** V8: Cryptographic agent identity. When present, used as the canonical key. */
  agent_id: z.string().optional(),
  /** V8 Phase 3: Server identifier for multi-agent delegation. */
  server_id: z.string().optional(),
  token: z.string().min(1),
  card: z.record(z.unknown()), // CapabilityCard (validated separately)
  cards: z.array(z.record(z.unknown())).optional(), // Additional cards (e.g., conductor card)
  /** V8 Phase 3: Additional agents served by this server (multi-agent registration). */
  agents: z.array(z.object({
    agent_id: z.string().min(1),
    display_name: z.string().min(1),
    cards: z.array(z.record(z.unknown())),
    delegation_token: z.record(z.unknown()).optional(),
  })).optional(),
});

/** Registry → Agent: Acknowledge registration */
export const RegisteredMessageSchema = z.object({
  type: z.literal('registered'),
  agent_id: z.string(),
});

/** Agent A → Registry: Request relay to another agent */
export const RelayRequestMessageSchema = z.object({
  type: z.literal('relay_request'),
  id: z.string().uuid(),
  target_owner: z.string().min(1),
  /** V8: Target agent's cryptographic identity. Preferred over target_owner. */
  target_agent_id: z.string().optional(),
  card_id: z.string(),
  skill_id: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  requester: z.string().optional(),
  escrow_receipt: z.record(z.unknown()).optional(),
  /** Optional UCAN token for capability delegation. */
  ucan_token: z.string().optional(),
});

/** Registry → Agent B: Incoming request forwarded from Agent A */
export const IncomingRequestMessageSchema = z.object({
  type: z.literal('incoming_request'),
  id: z.string().uuid(),
  from_owner: z.string().min(1),
  card_id: z.string(),
  skill_id: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  requester: z.string().optional(),
  escrow_receipt: z.record(z.unknown()).optional(),
  /** Optional UCAN token for capability delegation. */
  ucan_token: z.string().optional(),
});

/** Agent B → Registry: Response to a relayed request */
export const RelayResponseMessageSchema = z.object({
  type: z.literal('relay_response'),
  id: z.string().uuid(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
});

/** Registry → Agent A: Forwarded response from Agent B */
export const ResponseMessageSchema = z.object({
  type: z.literal('response'),
  id: z.string().uuid(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
});

/** Error message (either direction) */
export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  request_id: z.string().optional(),
});

/** Agent B → Registry: Progress heartbeat for a long-running relayed request */
export const RelayProgressMessageSchema = z.object({
  type: z.literal('relay_progress'),
  id: z.string().uuid(),       // request ID this progress relates to
  progress: z.number().min(0).max(100).optional(), // optional percentage
  message: z.string().optional(), // optional status message
});

/** Agent B → Registry: Provider acknowledged request and has started work */
export const RelayStartedMessageSchema = z.object({
  type: z.literal('relay_started'),
  id: z.string().uuid(),
  message: z.string().optional(),
});

/** Agent → Registry: Heartbeat with capacity data and self summary */
export const HeartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  owner: z.string().min(1),
  capacity: z.object({
    current_load: z.number(),
    max_concurrent: z.number(),
    queue_depth: z.number(),
  }),
  self_summary: z.object({
    capabilities: z.array(z.string()),
    success_rate: z.number(),
    credit_balance: z.number(),
    total_completed: z.number(),
    provider_number: z.number(),
    reliability: z.object({
      current_streak: z.number(),
      repeat_hire_rate: z.number(),
      avg_feedback: z.number(),
    }),
  }),
});

// ---------------------------------------------------------------------------
// V8 Phase 2: Explicit escrow messages (P2P with relay verification)
// ---------------------------------------------------------------------------

/** Consumer → Relay: Request escrow hold before P2P execution */
export const EscrowHoldMessageSchema = z.object({
  type: z.literal('escrow_hold'),
  consumer_agent_id: z.string().min(1),
  provider_agent_id: z.string().min(1),
  skill_id: z.string().min(1),
  amount: z.number().positive(),
  request_id: z.string().uuid(),
  signature: z.string().optional(),
  public_key: z.string().optional(),
});

/** Relay → Consumer: Hold confirmed */
export const EscrowHoldConfirmedMessageSchema = z.object({
  type: z.literal('escrow_hold_confirmed'),
  request_id: z.string(),
  escrow_id: z.string(),
  hold_amount: z.number(),
  consumer_remaining: z.number(),
});

/** Consumer → Relay: Request escrow settlement after P2P execution */
export const EscrowSettleMessageSchema = z.object({
  type: z.literal('escrow_settle'),
  escrow_id: z.string().min(1),
  request_id: z.string().uuid(),
  success: z.boolean(),
  failure_reason: z.enum(['bad_execution', 'overload', 'timeout', 'auth_error', 'not_found']).optional(),
  result_hash: z.string().optional(),
  signature: z.string().optional(),
  public_key: z.string().optional(),
  consumer_agent_id: z.string().optional(),
});

/** Relay → Both: Settlement confirmed */
export const EscrowSettledMessageSchema = z.object({
  type: z.literal('escrow_settled'),
  escrow_id: z.string(),
  request_id: z.string(),
  provider_earned: z.number(),
  network_fee: z.number(),
  consumer_remaining: z.number(),
  provider_balance: z.number(),
});

/** Consumer → Relay: Sync balance from relay (source of truth) */
export const BalanceSyncMessageSchema = z.object({
  type: z.literal('balance_sync'),
  agent_id: z.string().min(1),
});

/** Relay → Consumer: Balance sync response */
export const BalanceSyncResponseMessageSchema = z.object({
  type: z.literal('balance_sync_response'),
  agent_id: z.string(),
  balance: z.number(),
});

// ---------------------------------------------------------------------------
// Session messages (agent-to-agent interactive sessions)
// ---------------------------------------------------------------------------

import {
  SessionOpenMessageSchema,
  SessionAckMessageSchema,
  SessionMessageMessageSchema,
  SessionEndMessageSchema,
  SessionSettledMessageSchema as SessionSettledMsgSchema,
  SessionErrorMessageSchema,
} from '../session/session-types.js';

export {
  SessionOpenMessageSchema,
  SessionAckMessageSchema,
  SessionMessageMessageSchema,
  SessionEndMessageSchema,
  SessionErrorMessageSchema,
};
export { SessionSettledMsgSchema as SessionSettledMessageSchema };

/** Discriminated union of all relay messages */
export const RelayMessageSchema = z.discriminatedUnion('type', [
  RegisterMessageSchema,
  RegisteredMessageSchema,
  RelayRequestMessageSchema,
  IncomingRequestMessageSchema,
  RelayResponseMessageSchema,
  ResponseMessageSchema,
  ErrorMessageSchema,
  RelayProgressMessageSchema,
  RelayStartedMessageSchema,
  HeartbeatMessageSchema,
  EscrowHoldMessageSchema,
  EscrowHoldConfirmedMessageSchema,
  EscrowSettleMessageSchema,
  EscrowSettledMessageSchema,
  BalanceSyncMessageSchema,
  BalanceSyncResponseMessageSchema,
  SessionOpenMessageSchema,
  SessionAckMessageSchema,
  SessionMessageMessageSchema,
  SessionEndMessageSchema,
  SessionSettledMsgSchema,
  SessionErrorMessageSchema,
]);

// TypeScript types derived from Zod schemas
export type RegisterMessage = z.infer<typeof RegisterMessageSchema>;
export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>;
export type RelayRequestMessage = z.infer<typeof RelayRequestMessageSchema>;
export type IncomingRequestMessage = z.infer<typeof IncomingRequestMessageSchema>;
export type RelayResponseMessage = z.infer<typeof RelayResponseMessageSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type RelayProgressMessage = z.infer<typeof RelayProgressMessageSchema>;
export type RelayStartedMessage = z.infer<typeof RelayStartedMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type EscrowHoldMessage = z.infer<typeof EscrowHoldMessageSchema>;
export type EscrowSettleMessage = z.infer<typeof EscrowSettleMessageSchema>;
export type BalanceSyncMessage = z.infer<typeof BalanceSyncMessageSchema>;
export type {
  SessionOpenMessage,
  SessionAckMessage,
  SessionMessageMessage,
  SessionEndMessage,
  SessionSettledMessage,
  SessionErrorMessage,
} from '../session/session-types.js';
export type RelayMessage = z.infer<typeof RelayMessageSchema>;

/** Rate limit state per agent */
export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** Pending relay request tracking */
export interface PendingRelayRequest {
  /** Connection key used to route the response back (may be a synthetic ID) */
  originOwner: string;
  /** Actual agent owner for credit operations (defaults to originOwner) */
  creditOwner?: string;
  /** Active timeout handle (backward-compatible alias for current phase timer). */
  timeout: ReturnType<typeof setTimeout>;
  /** Idle timeout before provider acknowledges start. */
  idleTimeout?: ReturnType<typeof setTimeout>;
  /** Hard timeout after provider start acknowledgement. */
  hardTimeout?: ReturnType<typeof setTimeout>;
  /** Grace timeout after requester disconnects post-start. */
  graceTimeout?: ReturnType<typeof setTimeout>;
  /** Lifecycle stage tracked by relay for disconnect policy. */
  lifecycle?: 'held' | 'started' | 'progressing' | 'abandoned';
  createdAt?: number;
  startedAt?: number;
  abandonedAt?: number;
  /** Escrow ID for the credit hold, if credits were reserved for this request */
  escrowId?: string;
  /** The target provider owner, needed to release escrow on provider disconnect */
  targetOwner?: string;
  /** Job ID if this request was dispatched from the job queue (relay bridge) */
  jobId?: string;
}

/** Capacity data reported by agent heartbeats */
export interface AgentCapacityData {
  current_load: number;
  max_concurrent: number;
  queue_depth: number;
}

/** Self-summary data reported by agent heartbeats */
export interface AgentSelfSummary {
  capabilities: string[];
  success_rate: number;
  credit_balance: number;
  total_completed: number;
  provider_number: number;
  reliability: {
    current_streak: number;
    repeat_hire_rate: number;
    avg_feedback: number;
  };
}

/** Relay server state returned from registerWebSocketRelay */
export interface RelayState {
  /** Number of currently connected agents */
  getOnlineCount(): number;
  /** List of connected agent owners */
  getOnlineOwners(): string[];
  /** Graceful shutdown -- close all connections */
  shutdown(): void;
  /** Set a callback invoked when an agent registers (comes online) */
  setOnAgentOnline?(cb: (owner: string) => void): void;
  /** Get the active connections map (owner -> WebSocket) */
  getConnections?(): Map<string, unknown>;
  /** Get the pending requests map */
  getPendingRequests?(): Map<string, PendingRelayRequest>;
  /** Send a JSON message over a WebSocket */
  sendMessage?(ws: unknown, msg: Record<string, unknown>): void;
  /** Get capacity data for an agent (from heartbeat) */
  getAgentCapacity?(owner: string): AgentCapacityData | undefined;
  /** Get all agent capacity data */
  getAllCapacities?(): Map<string, AgentCapacityData>;
}
