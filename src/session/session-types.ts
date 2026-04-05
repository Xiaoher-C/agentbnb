import { z } from 'zod';
import { loadCoreConfig } from '../core-config.js';

// ---------------------------------------------------------------------------
// Session configuration — loaded from @agentbnb/core or fallback defaults
// ---------------------------------------------------------------------------

/** Session configuration shape (mirrors config/session.json in agentbnb-core). */
export interface SessionConfig {
  pricing: {
    default_model: SessionPricingModel;
    per_message_base_rate: number;
    per_minute_base_rate: number;
    per_session_flat_rate: number;
    max_messages_per_session: number;
    max_minutes_per_session: number;
  };
  timeouts: {
    idle_timeout_ms: number;
    max_session_duration_ms: number;
    message_timeout_ms: number;
  };
  abuse: {
    max_concurrent_sessions_per_agent: number;
    max_sessions_per_hour: number;
    min_message_interval_ms: number;
  };
  quality: {
    min_provider_reputation_for_session: number;
    auto_refund_on_timeout: boolean;
    partial_refund_ratio: number;
  };
}

/** Default config used when @agentbnb/core is not installed. */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  pricing: {
    default_model: 'per_message',
    per_message_base_rate: 2,
    per_minute_base_rate: 1,
    per_session_flat_rate: 10,
    max_messages_per_session: 50,
    max_minutes_per_session: 30,
  },
  timeouts: {
    idle_timeout_ms: 120_000,
    max_session_duration_ms: 1_800_000,
    message_timeout_ms: 90_000,
  },
  abuse: {
    max_concurrent_sessions_per_agent: 5,
    max_sessions_per_hour: 20,
    min_message_interval_ms: 1_000,
  },
  quality: {
    min_provider_reputation_for_session: 0.5,
    auto_refund_on_timeout: true,
    partial_refund_ratio: 0.5,
  },
};

/**
 * Loads session config from @agentbnb/core, falling back to built-in defaults.
 */
export function loadSessionConfig(): SessionConfig {
  const core = loadCoreConfig<Partial<SessionConfig>>('session');
  if (!core) return DEFAULT_SESSION_CONFIG;
  return {
    pricing: { ...DEFAULT_SESSION_CONFIG.pricing, ...core.pricing },
    timeouts: { ...DEFAULT_SESSION_CONFIG.timeouts, ...core.timeouts },
    abuse: { ...DEFAULT_SESSION_CONFIG.abuse, ...core.abuse },
    quality: { ...DEFAULT_SESSION_CONFIG.quality, ...core.quality },
  };
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Session lifecycle statuses. */
export type SessionStatus = 'open' | 'active' | 'closing' | 'settled' | 'closed';

/** Pricing model for a session. */
export type SessionPricingModel = 'per_message' | 'per_minute' | 'per_session';

/** Why a session ended. */
export type SessionEndReason = 'completed' | 'timeout' | 'budget_exhausted' | 'error' | 'cancelled';

/** A single message within a session. */
export interface SessionMessage {
  id: string;
  session_id: string;
  sender: 'requester' | 'provider';
  content: string;
  timestamp: string;
  cost?: number;
  metadata?: {
    model?: string;
    latency_ms?: number;
    tokens_used?: number;
  };
}

/** A full session record. */
export interface Session {
  id: string;
  requester_id: string;
  provider_id: string;
  skill_id: string;
  card_id: string;
  status: SessionStatus;
  escrow_id: string;
  budget: number;
  spent: number;
  pricing_model: SessionPricingModel;
  messages: SessionMessage[];
  created_at: string;
  updated_at: string;
  ended_at?: string;
  end_reason?: SessionEndReason;
}

// ---------------------------------------------------------------------------
// Zod schemas for relay message validation
// ---------------------------------------------------------------------------

export const SessionPricingModelSchema = z.enum(['per_message', 'per_minute', 'per_session']);

/** Requester → Relay: Open a new session. */
export const SessionOpenMessageSchema = z.object({
  type: z.literal('session_open'),
  session_id: z.string().uuid(),
  requester_id: z.string().min(1),
  provider_id: z.string().min(1),
  card_id: z.string().min(1),
  skill_id: z.string().min(1),
  budget: z.number().positive(),
  pricing_model: SessionPricingModelSchema.default('per_message'),
  initial_message: z.string().min(1),
  ucan_token: z.string().optional(),
});

/** Relay → Requester: Session opened successfully. */
export const SessionAckMessageSchema = z.object({
  type: z.literal('session_ack'),
  session_id: z.string(),
  escrow_id: z.string(),
  status: z.literal('open'),
});

/** Either party → Relay: Send a message within a session. */
export const SessionMessageMessageSchema = z.object({
  type: z.literal('session_message'),
  session_id: z.string().uuid(),
  sender: z.enum(['requester', 'provider']),
  content: z.string().min(1),
  metadata: z.object({
    model: z.string().optional(),
    latency_ms: z.number().optional(),
    tokens_used: z.number().optional(),
  }).optional(),
});

/** Either party → Relay: End a session. */
export const SessionEndMessageSchema = z.object({
  type: z.literal('session_end'),
  session_id: z.string().uuid(),
  reason: z.enum(['completed', 'timeout', 'budget_exhausted', 'error', 'cancelled']).default('completed'),
  summary: z.string().optional(),
});

/** Relay → Both: Session settled with final cost. */
export const SessionSettledMessageSchema = z.object({
  type: z.literal('session_settled'),
  session_id: z.string(),
  total_cost: z.number(),
  messages_count: z.number(),
  duration_seconds: z.number(),
  refunded: z.number(),
});

/** Relay → Either: Session error. */
export const SessionErrorMessageSchema = z.object({
  type: z.literal('session_error'),
  session_id: z.string(),
  code: z.string(),
  message: z.string(),
});

// Inferred TypeScript types
export type SessionOpenMessage = z.infer<typeof SessionOpenMessageSchema>;
export type SessionAckMessage = z.infer<typeof SessionAckMessageSchema>;
export type SessionMessageMessage = z.infer<typeof SessionMessageMessageSchema>;
export type SessionEndMessage = z.infer<typeof SessionEndMessageSchema>;
export type SessionSettledMessage = z.infer<typeof SessionSettledMessageSchema>;
export type SessionErrorMessage = z.infer<typeof SessionErrorMessageSchema>;

/** Union of all session-related relay messages. */
export type SessionRelayMessage =
  | SessionOpenMessage
  | SessionAckMessage
  | SessionMessageMessage
  | SessionEndMessage
  | SessionSettledMessage
  | SessionErrorMessage;

/** Discriminating type literal values for session messages. */
export const SESSION_MESSAGE_TYPES = new Set([
  'session_open',
  'session_ack',
  'session_message',
  'session_end',
  'session_settled',
  'session_error',
]);
