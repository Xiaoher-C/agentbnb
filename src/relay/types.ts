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

/** Discriminated union of all relay messages */
export const RelayMessageSchema = z.discriminatedUnion('type', [
  RegisterMessageSchema,
  RegisteredMessageSchema,
  RelayRequestMessageSchema,
  IncomingRequestMessageSchema,
  RelayResponseMessageSchema,
  ResponseMessageSchema,
  ErrorMessageSchema,
]);

// TypeScript types derived from Zod schemas
export type RegisterMessage = z.infer<typeof RegisterMessageSchema>;
export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>;
export type RelayRequestMessage = z.infer<typeof RelayRequestMessageSchema>;
export type IncomingRequestMessage = z.infer<typeof IncomingRequestMessageSchema>;
export type RelayResponseMessage = z.infer<typeof RelayResponseMessageSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type RelayMessage = z.infer<typeof RelayMessageSchema>;

/** Rate limit state per agent */
export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** Pending relay request tracking */
export interface PendingRelayRequest {
  originOwner: string;
  timeout: ReturnType<typeof setTimeout>;
}

/** Relay server state returned from registerWebSocketRelay */
export interface RelayState {
  /** Number of currently connected agents */
  getOnlineCount(): number;
  /** List of connected agent owners */
  getOnlineOwners(): string[];
  /** Graceful shutdown — close all connections */
  shutdown(): void;
}
