import { z } from 'zod';
import { loadCoreConfig } from '../core-config.js';

// ---------------------------------------------------------------------------
// Session configuration — loaded from @agentbnb/core or fallback defaults
// ---------------------------------------------------------------------------

/**
 * Configuration for OpenClaw-based session engines.
 * Passed to OpenClawSessionExecutor to control agent routing and behavior.
 */
export interface OpenClawSessionEngineConfig {
  /** OpenClaw agent name (maps to brains/ directory). Defaults to workspace default. */
  agent?: string;
  /** Limit loaded plugins to this list. If omitted, all agent plugins are used. */
  plugins?: string[];
  /** Number of SOUL.md lines to use for core identity summary on turn 2+. Default 10. */
  soul_summary_lines?: number;
  /** Override message timeout in milliseconds. Default 90_000. */
  timeout_ms?: number;
}

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

// ---------------------------------------------------------------------------
// v10 Rental Session types — Agent Maturity Rental (ADR-022 / ADR-023 / ADR-024)
// ---------------------------------------------------------------------------

/**
 * Participant role in a rental session.
 * Replaces the binary requester/provider model with a richer schema that
 * supports human + agent on the renter side and observer roles.
 */
export type ParticipantRole =
  | 'renter_human'
  | 'renter_agent'
  | 'rented_agent'
  | 'human_observer';

/** A participant in a session — identified by DID. */
export interface Participant {
  did: string;
  role: ParticipantRole;
}

/** Interaction mode within a session. UI labels use 「透過我的 agent」/「直接和出租 agent 對話」. */
export type SessionMode = 'direct' | 'proxy';

/**
 * A task thread within a session — independent deliverable unit.
 * Threads separate "negotiation" from "concrete work product" so that
 * the outcome page can structure deliverables clearly.
 */
export interface Thread {
  id: string;
  session_id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

/** A file uploaded within a session, optionally scoped to a thread. */
export interface FileRef {
  id: string;
  session_id: string;
  thread_id: string | null;
  uploader_did: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  storage_key: string; // local fs path in v1; R2 / S3 in v2
  created_at: string;
}

/** Renter rating for a completed session. */
export interface Rating {
  session_id: string;
  rater_did: string;
  rated_agent_id: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string;
  created_at: string;
}

/** Outcome page generated when a session ends — public via share_token. */
export interface OutcomePage {
  generated_at: string;
  summary: {
    messages: number;
    tasks_done: number;
    files: number;
    credit_used: number;
    credit_refunded: number;
    duration_seconds: number;
  };
  threads: Thread[];
  participants: Participant[];
  rating: Rating | null;
  share_token: string; // GET /o/:share_token public read (no auth)
}

// ---------------------------------------------------------------------------
// Existing types (extended with v10 optional fields for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * A single message within a session.
 *
 * v10 additions (all optional for backward compat):
 * - thread_id: groups message into a task thread (null = main conversation)
 * - is_human_intervention: marks human break-in messages (UI shows amber + left bar)
 * - sender_did + sender_role: replaces binary sender field for rental sessions
 */
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
  // v10 rental session fields (optional for backward compat)
  thread_id?: string | null;
  is_human_intervention?: boolean;
  sender_did?: string;
  sender_role?: ParticipantRole;
  attachments?: FileRef[];
}

/**
 * A full session record.
 *
 * v10 additions (all optional for backward compat):
 * - participants: replaces binary requester_id/provider_id with multi-party schema
 * - threads: task threads created within the session
 * - files: file uploads in the session
 * - current_mode: interaction mode (direct/proxy)
 * - isolated_memory: privacy invariant (always true for rental sessions, see ADR-024)
 * - outcome: outcome page populated when session ends
 *
 * Existing call sites using requester_id / provider_id continue to work.
 * Rental sessions populate both legacy and new fields during the migration.
 */
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
  // v10 rental session fields (optional for backward compat)
  participants?: Participant[];
  threads?: Thread[];
  files?: FileRef[];
  current_mode?: SessionMode;
  /**
   * Privacy invariant — when true, this session does NOT pollute the rented
   * agent's main memory (ADR-024). Schema-enforced as `true` for rental
   * sessions; legacy capability-call sessions may omit this field.
   */
  isolated_memory?: true;
  outcome?: OutcomePage | null;
  duration_min?: number;
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

// ---------------------------------------------------------------------------
// v10 — Thread / mode-change relay schemas (optional, used in v1.1+)
// ---------------------------------------------------------------------------

/** Either party → Relay: open a new task thread. */
export const SessionThreadOpenMessageSchema = z.object({
  type: z.literal('session_thread_open'),
  session_id: z.string().uuid(),
  thread_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(''),
});

/** Either party → Relay: mark a thread complete. */
export const SessionThreadCompleteMessageSchema = z.object({
  type: z.literal('session_thread_complete'),
  session_id: z.string().uuid(),
  thread_id: z.string().uuid(),
});

/** Renter → Relay: switch interaction mode. */
export const SessionModeChangeMessageSchema = z.object({
  type: z.literal('session_mode_change'),
  session_id: z.string().uuid(),
  mode: z.enum(['direct', 'proxy']),
});

// Inferred TypeScript types
export type SessionOpenMessage = z.infer<typeof SessionOpenMessageSchema>;
export type SessionAckMessage = z.infer<typeof SessionAckMessageSchema>;
export type SessionMessageMessage = z.infer<typeof SessionMessageMessageSchema>;
export type SessionEndMessage = z.infer<typeof SessionEndMessageSchema>;
export type SessionSettledMessage = z.infer<typeof SessionSettledMessageSchema>;
export type SessionErrorMessage = z.infer<typeof SessionErrorMessageSchema>;
export type SessionThreadOpenMessage = z.infer<typeof SessionThreadOpenMessageSchema>;
export type SessionThreadCompleteMessage = z.infer<typeof SessionThreadCompleteMessageSchema>;
export type SessionModeChangeMessage = z.infer<typeof SessionModeChangeMessageSchema>;

/** Union of all session-related relay messages. */
export type SessionRelayMessage =
  | SessionOpenMessage
  | SessionAckMessage
  | SessionMessageMessage
  | SessionEndMessage
  | SessionSettledMessage
  | SessionErrorMessage
  | SessionThreadOpenMessage
  | SessionThreadCompleteMessage
  | SessionModeChangeMessage;

/** Discriminating type literal values for session messages. */
export const SESSION_MESSAGE_TYPES = new Set([
  'session_open',
  'session_ack',
  'session_message',
  'session_end',
  'session_settled',
  'session_error',
  'session_thread_open',
  'session_thread_complete',
  'session_mode_change',
]);
