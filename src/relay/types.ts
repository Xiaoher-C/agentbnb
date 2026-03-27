import { z } from 'zod';

/**
 * WebSocket relay message types for agent-to-registry communication.
 * All messages are JSON-encoded with a discriminating `type` field.
 */

/** Agent → Registry: Register agent and card on connect */
export const RegisterMessageSchema = z.object({
  type: z.literal('register'),
  owner: z.string().min(1),
  token: z.string().min(1),
  card: z.record(z.unknown()), // CapabilityCard (validated separately)
  cards: z.array(z.record(z.unknown())).optional(), // Additional cards (e.g., conductor card)
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
  card_id: z.string(),
  skill_id: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  requester: z.string().optional(),
  escrow_receipt: z.record(z.unknown()).optional(),
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
  HeartbeatMessageSchema,
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
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
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
  timeout: ReturnType<typeof setTimeout>;
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
