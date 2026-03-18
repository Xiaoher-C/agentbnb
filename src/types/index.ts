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
  inputs: z.array(IOSchemaSchema),
  outputs: z.array(IOSchemaSchema),
  pricing: z.object({
    credits_per_call: z.number().nonnegative(),
    credits_per_minute: z.number().nonnegative().optional(),
    free_tier: z.number().nonnegative().optional(),
  }),
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
 * Capability Card v2.0 — one card per agent, multiple independently-priced skills.
 *
 * Introduced in Phase 4 (Plan 02). Existing v1.0 cards are migrated to this
 * shape by `runMigrations()` in `src/registry/store.ts`.
 */
export const CapabilityCardV2Schema = z.object({
  spec_version: z.literal('2.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  /** Agent display name — was 'name' in v1.0. */
  agent_name: z.string().min(1).max(100),
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
  /**
   * Private per-card metadata. Stripped from all API and CLI responses —
   * never transmitted beyond the local store.
   */
  _internal: z.record(z.unknown()).optional(),
  /** Public gateway URL where this agent accepts requests. Populated on remote publish. */
  gateway_url: z.string().url().optional(),
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

/**
 * Signed escrow receipt — cryptographic proof that a requester has committed credits.
 * Sent to the provider so they can verify the requester's credit commitment
 * without needing access to the requester's local database.
 */
export interface EscrowReceipt {
  /** Agent owner identifier of the requester. */
  requester_owner: string;
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
