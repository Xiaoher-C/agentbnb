import { z } from 'zod';

/**
 * IO Schema for Capability Card inputs/outputs
 */
export const IOSchemaSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'json', 'file', 'audio', 'image', 'video', 'stream']),
  description: z.string().optional(),
  required: z.boolean().default(true),
  schema: z.record(z.unknown()).optional(), // JSON Schema
});

/**
 * Describes a tool or model powering a capability.
 * Public-facing — shown on Hub cards as the tool chain.
 */
export const PoweredBySchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  tier: z.string().optional(),
});

/**
 * Capability Card — the core unit of AgentBnB
 *
 * Level 1 (Atomic): Single API capability (e.g. ElevenLabs TTS)
 * Level 2 (Pipeline): Multiple Atomics chained (e.g. text → voice → video)
 * Level 3 (Environment): Full deployment with all dependencies
 */
export const CapabilityCardSchema = z.object({
  spec_version: z.literal('1.0').default('1.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  /** V8: Cryptographic agent identity (Ed25519 public key hash). */
  agent_id: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  inputs: z.array(IOSchemaSchema),
  outputs: z.array(IOSchemaSchema),
  pricing: z.object({
    credits_per_call: z.number().nonnegative(),
    credits_per_minute: z.number().nonnegative().optional(),
    /** Number of free monthly calls. Shown as a "N free/mo" badge in the Hub. */
    free_tier: z.number().nonnegative().optional(),
  }),
  availability: z.object({
    online: z.boolean(),
    schedule: z.string().optional(), // cron expression
  }),
  /**
   * Provider-estimated typical execution duration in milliseconds.
   * Used by requesters to derive default client-side timeouts.
   */
  expected_duration_ms: z.number().positive().optional(),
  /**
   * Provider hard timeout in milliseconds.
   * Used as a fallback timeout hint when expected_duration_ms is unavailable.
   */
  hard_timeout_ms: z.number().positive().optional(),
  powered_by: z.array(PoweredBySchema).optional(),
  /**
   * Private per-card metadata. Stripped from all API and CLI responses —
   * never transmitted beyond the local store.
   */
  _internal: z.record(z.unknown()).optional(),
  /** Public gateway URL where this agent accepts requests. Populated on remote publish. */
  gateway_url: z.string().url().optional(),
  metadata: z.object({
    apis_used: z.array(z.string()).optional(),
    avg_latency_ms: z.number().nonnegative().optional(),
    success_rate: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  /** Exact-match capability type key for network routing (e.g. 'task_decomposition'). Optional — backward-compatible. */
  capability_type: z.string().optional(),
});

export type CapabilityCard = z.infer<typeof CapabilityCardSchema>;
export type IOSchema = z.infer<typeof IOSchemaSchema>;
export type PoweredBy = z.infer<typeof PoweredBySchema>;

/**
 * Skill — the per-skill unit in a v2.0 CapabilityCard.
 *
 * A single agent card may expose multiple independently-priced skills.
 * Each skill carries its own inputs, outputs, pricing, and availability.
 */
export const SkillSchema = z.object({
  /** Stable skill identifier, e.g. 'tts-elevenlabs'. Used for gateway routing and idle tracking. */
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Optional grouping category, e.g. 'tts' | 'video_gen' | 'code_review'. */
  category: z.string().optional(),
  /** Exact-match capability type key for network routing (e.g. 'task_decomposition'). Optional — per-skill routing hint. */
  capability_type: z.string().optional(),
  /**
   * Multi-value capability routing tags — what this skill IS / offers to the outside.
   * Used by Conductor for precise skill-level matching.
   * Example: ["audio_generation", "audio_editing", "content_production"]
   */
  capability_types: z.array(z.string()).optional(),
  /**
   * Capabilities this skill internally depends on when executing.
   * Used by Conductor for decomposition planning and cost estimation.
   * Example: ["tts", "sound_effects", "audio_mixing"]
   */
  requires_capabilities: z.array(z.string()).optional(),
  /**
   * Publishing visibility. 'private' skills are excluded from published CapabilityCards.
   * Defaults to 'public' when omitted.
   */
  visibility: z.enum(['public', 'private']).optional(),
  inputs: z.array(IOSchemaSchema),
  outputs: z.array(IOSchemaSchema),
  pricing: z.object({
    credits_per_call: z.number().nonnegative(),
    credits_per_minute: z.number().nonnegative().optional(),
    free_tier: z.number().nonnegative().optional(),
  }),
  /**
   * Provider-estimated typical execution duration in milliseconds.
   * Used by requesters to derive default client-side timeouts.
   */
  expected_duration_ms: z.number().positive().optional(),
  /**
   * Provider hard timeout in milliseconds.
   * Used as a fallback timeout hint when expected_duration_ms is unavailable.
   */
  hard_timeout_ms: z.number().positive().optional(),
  /** Per-skill online flag — overrides card-level availability for this skill. */
  availability: z.object({ online: z.boolean() }).optional(),
  powered_by: z.array(PoweredBySchema).optional(),
  metadata: z.object({
    apis_used: z.array(z.string()).optional(),
    avg_latency_ms: z.number().nonnegative().optional(),
    success_rate: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
    capacity: z.object({
      calls_per_hour: z.number().positive().default(60),
    }).optional(),
  }).optional(),
  /**
   * Private per-skill metadata. Stripped from all API and CLI responses —
   * never transmitted beyond the local store.
   */
  _internal: z.record(z.unknown()).optional(),
});

/**
 * Suitability metadata — describes when an agent/skill is or is not appropriate.
 * Used in Hub v2 Agent Profile and (in later phases) for routing warnings
 * and automated matching exclusions.
 */
export const SuitabilitySchema = z.object({
  /** Use cases this agent/skill is optimised for. */
  ideal_for: z.array(z.string()).optional(),
  /** Scenarios this agent/skill cannot reliably handle. */
  not_suitable_for: z.array(z.string()).optional(),
  /** Domains explicitly excluded (used for routing exclusions in later phases). */
  excluded_domains: z.array(z.string()).optional(),
  /** Conditions that increase failure risk, shown as warnings in the Hub. */
  risk_conditions: z.array(z.string()).optional(),
  /** Recommended alternative when this agent is unsuitable. */
  fallback_recommendation: z.string().optional(),
});

/**
 * Learning metadata — self-declared evolution signals for Hub v2.
 * In phase 1 this is entirely self-reported by the provider.
 * In later phases, `critiques` can be populated by external critique mechanisms.
 */
export const LearningSchema = z.object({
  /** Known limitations that may affect reliability (self-declared). */
  known_limitations: z.array(z.string()).optional(),
  /** Common failure patterns observed by the provider. */
  common_failure_patterns: z.array(z.string()).optional(),
  /** Version-tagged improvements the provider has shipped. */
  recent_improvements: z.array(z.object({
    version: z.string(),
    summary: z.string(),
    timestamp: z.string(),
  })).optional(),
  /** Structured critiques from external sources (phase 2+). */
  critiques: z.array(z.object({
    type: z.literal('structured'),
    summary: z.string(),
    source_tier: z.string(),
    timestamp: z.string(),
  })).optional(),
});

/**
 * Capability Card v2.0 — one card per agent, multiple independently-priced skills.
 *
 * Introduced in Phase 4 (Plan 02). Existing v1.0 cards are migrated to this
 * shape by `runMigrations()` in `src/registry/store.ts`.
 */
export const CapabilityCardV2Schema = z.object({
  spec_version: z.literal('2.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  /** V8: Cryptographic agent identity (Ed25519 public key hash). */
  agent_id: z.string().optional(),
  /** Agent display name — was 'name' in v1.0. */
  agent_name: z.string().min(1).max(100),
  /** Short one-liner shown in Hub v2 Identity Header. */
  short_description: z.string().max(200).optional(),
  /** At least one skill is required. */
  skills: z.array(SkillSchema).min(1),
  availability: z.object({
    online: z.boolean(),
    schedule: z.string().optional(),
  }),
  /** Optional deployment environment metadata. */
  environment: z.object({
    runtime: z.string(),
    region: z.string().optional(),
  }).optional(),
  /** Suitability metadata for Hub v2 profile and future routing warnings. */
  suitability: SuitabilitySchema.optional(),
  /** Learning signals — self-declared limitations, improvements, critiques. */
  learning: LearningSchema.optional(),
  /**
   * Private per-card metadata. Stripped from all API and CLI responses —
   * never transmitted beyond the local store.
   */
  _internal: z.record(z.unknown()).optional(),
  /** Public gateway URL where this agent accepts requests. Populated on remote publish. */
  gateway_url: z.string().url().optional(),
  /** Exact-match capability type key for network routing (e.g. 'task_decomposition'). Optional — backward-compatible. */
  capability_type: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

/**
 * Discriminated union accepting both v1.0 and v2.0 capability cards.
 * Use this schema when parsing cards from external sources or SQLite.
 */
export const AnyCardSchema = z.discriminatedUnion('spec_version', [
  CapabilityCardSchema,
  CapabilityCardV2Schema,
]);

export type Skill = z.infer<typeof SkillSchema>;
export type CapabilityCardV2 = z.infer<typeof CapabilityCardV2Schema>;
export type AnyCard = z.infer<typeof AnyCardSchema>;
export type Suitability = z.infer<typeof SuitabilitySchema>;
export type Learning = z.infer<typeof LearningSchema>;

/**
 * Hub v2 Agent Profile — returned by GET /api/agents/:owner.
 *
 * Extends the v1 profile shape with trust metrics, execution proofs,
 * performance tier, verification badges, and authority metadata.
 * All computation is done at query time (no stored snapshots in phase 1).
 */
export interface AgentProfileV2 {
  owner: string;
  /** V8: Cryptographic agent identity. */
  agent_id?: string;
  agent_name?: string;
  short_description?: string;
  joined_at: string;
  last_active: string;

  /**
   * Performance tier — derived exclusively from execution metrics.
   * 0 = Listed, 1 = Active (>10 executions), 2 = Trusted (>85% success + >50 executions).
   * Does NOT imply identity verification; use `verification_badges` for that.
   */
  performance_tier: 0 | 1 | 2;

  /**
   * Verification badges — can only be granted by external actions or platform review,
   * never inferred from metrics alone.
   */
  verification_badges: ('platform_verified' | 'org_authorized' | 'real_world_authorized')[];

  /** Authority metadata — source and verification status of this agent's authority claims. */
  authority: {
    authority_source: 'self' | 'platform' | 'org';
    verification_status: 'none' | 'observed' | 'verified' | 'revoked';
    scope?: string[];
    constraints?: Record<string, unknown>;
    expires_at?: string;
    status_ref?: string;
  };

  /** Self-declared suitability metadata from the agent's capability card. */
  suitability?: Suitability;

  /**
   * Trust metrics — computed from request_log at query time.
   * `snapshot_at: null` means live computation; a timestamp means a cached snapshot.
   */
  trust_metrics: {
    total_executions: number;
    successful_executions: number;
    success_rate: number;
    avg_latency_ms: number;
    refund_rate: number;
    repeat_use_rate: number;
    trend_7d: { date: string; count: number; success: number }[];
    snapshot_at: string | null;
    aggregation_window: '7d' | '30d' | 'all';
  };

  /**
   * Recent execution proofs — up to 10 most recent request_log entries.
   * `proof_source` is always 'request_log' in phase 1.
   * When Ed25519 signed receipts are introduced, this upgrades to 'signed_receipt'.
   */
  execution_proofs: {
    action: string;
    status: 'success' | 'failure' | 'timeout' | 'refunded';
    outcome_class: 'completed' | 'partial' | 'failed' | 'cancelled';
    latency_ms?: number;
    receipt_id?: string;
    proof_source: 'request_log' | 'signed_receipt' | 'settlement_record';
    timestamp: string;
  }[];

  /** Learning signals — self-declared in phase 1. */
  learning: {
    known_limitations: string[];
    common_failure_patterns: string[];
    recent_improvements: { version: string; summary: string; timestamp: string }[];
    critiques: { type: 'structured'; summary: string; source_tier: string; timestamp: string }[];
  };

  /** All capability cards owned by this agent. */
  skills: AnyCard[];

  /** Kept for backwards compatibility with Hub v1 consumers. */
  recent_activity: {
    id: string;
    card_name: string;
    requester: string;
    status: string;
    credits_charged: number;
    created_at: string;
  }[];
}

/**
 * Signed escrow receipt — cryptographic proof that a requester has committed credits.
 * Sent to the provider so they can verify the requester's credit commitment
 * without needing access to the requester's local database.
 */
export interface EscrowReceipt {
  /** Agent owner identifier of the requester. */
  requester_owner: string;
  /** V8: Cryptographic agent identity of the requester. */
  requester_agent_id?: string;
  /** Hex-encoded Ed25519 public key of the requester. */
  requester_public_key: string;
  /** Number of credits committed. */
  amount: number;
  /** Capability Card ID being requested. */
  card_id: string;
  /** Optional skill ID within the card. */
  skill_id?: string;
  /** ISO 8601 timestamp of receipt creation. */
  timestamp: string;
  /** UUID nonce — prevents replay attacks. */
  nonce: string;
  /** Base64url Ed25519 signature over all other fields. */
  signature: string;
}

/**
 * Custom error base class
 */
export class AgentBnBError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AgentBnBError';
  }
}

/**
 * Categorizes the cause of a terminal execution failure.
 * Used in request_log.failure_reason to distinguish infrastructure noise
 * (overload) from provider-quality signals (bad_execution, auth_error, etc.).
 *
 * bad_execution — skill ran but returned an error result
 * overload      — rejected before execution; provider at capacity
 * timeout       — execution exceeded the allowed time window
 * auth_error    — request rejected due to invalid credentials or escrow
 * not_found     — card or skill ID not found in registry
 */
export type FailureReason = 'bad_execution' | 'overload' | 'timeout' | 'auth_error' | 'not_found';
