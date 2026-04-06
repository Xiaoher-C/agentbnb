/**
 * Frontend-specific types for AgentBnB Hub.
 * Mirrors the subset of CapabilityCard fields needed by the hub UI.
 * Avoids importing from the parent project's src/types.
 */

export interface PoweredByEntry {
  provider: string;
  model?: string;
  tier?: string;
}

export interface HubCard {
  id: string;
  owner: string;
  /** V8: Cryptographic agent identity (Ed25519 public key hash). */
  agent_id?: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;
  inputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  outputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  pricing: { credits_per_call: number; credits_per_minute?: number; free_tier?: number };
  availability: { online: boolean; schedule?: string };
  powered_by?: PoweredByEntry[];
  metadata?: {
    apis_used?: string[];
    avg_latency_ms?: number;
    success_rate?: number;
    tags?: string[];
    idle_rate?: number;
  };
  /** Number of successful uses in the last 7 days (enriched by API) */
  uses_this_week?: number;
  /** Owner-level performance tier (0=Listed, 1=Active, 2=Trusted) — injected by /cards API */
  performance_tier?: 0 | 1 | 2;
  /** Owner-level authority source — injected by /cards API */
  authority_source?: 'self' | 'platform' | 'org';
  /** Capability types this skill provides (e.g. "analysis", "generation") */
  capability_types?: string[];
  /** Capability types this skill depends on from other agents */
  requires_capabilities?: string[];
  // Agent-level tile fields (populated by normalizeCardAsAgent, Agents tab only)
  /** Number of skills this agent exposes (agents tab tile) */
  skill_count?: number;
  /** Full skill data for agent modal rendering */
  skills?: RawSkill[];
  /** Union of all skills' capability_types, deduplicated (for filter + display) */
  all_capability_types?: string[];
  /** Formatted price: "from cr 3" (multi-skill) or "cr 15" (single/v1.0) */
  display_price?: string;
}

/** Raw skill object as returned inside v2.0 cards from the API */
export interface RawSkill {
  id: string;
  name: string;
  description: string;
  level?: 1 | 2 | 3;
  inputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  outputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  pricing: { credits_per_call: number; credits_per_minute?: number; free_tier?: number };
  availability?: { online: boolean };
  capability_types?: string[];
  requires_capabilities?: string[];
  metadata?: {
    apis_used?: string[];
    avg_latency_ms?: number;
    success_rate?: number;
    tags?: string[];
    idle_rate?: number;
  };
}

export interface Category {
  id: string;        // e.g. "tts", "image_gen"
  label: string;     // e.g. "TTS", "Image Gen"
  iconName: string;  // lucide-react icon name e.g. "Volume2"
}

export interface LevelBadge {
  level: 1 | 2 | 3;
  label: string;     // "Atomic" | "Pipeline" | "Environment"
  style: string;     // Tailwind classes for the badge
}

/**
 * Two-state status: online (accent green) or offline (dim).
 * Three-state status deferred until backend exposes idle metrics. MVP ships with online/offline.
 */
export type StatusColor = 'accent' | 'dim';

export interface CardsResponse {
  total: number;
  limit: number;
  offset: number;
  items: HubCard[];
  uses_this_week?: Record<string, number>;
}

/** Sort options for the Discover page */
export type SortOption = 'popular' | 'rated' | 'cheapest' | 'newest';

/** Shared context passed from App layout to route pages via Outlet context */
export interface AppOutletContext {
  apiKey: string | null;
  login: (key: string | null) => void;
  setSelectedCard: (card: HubCard | null) => void;
}

/** Agent profile as returned by GET /api/agents */
export interface AgentProfile {
  owner: string;
  agent_id?: string;
  skill_count: number;
  success_rate: number | null;
  total_earned: number;
  member_since: string;
}

/** Activity entry as returned by GET /api/agents/:owner recent_activity */
export interface ActivityEntry {
  id: string;
  card_name: string;
  requester: string;
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  created_at: string;
}

/** Full agent profile response from GET /api/agents/:owner */
export interface AgentProfileResponse {
  profile: AgentProfile;
  skills: HubCard[];
  recent_activity: ActivityEntry[];
}

/** Suitability metadata from AgentProfileV2 */
export interface AgentSuitability {
  ideal_for?: string[];
  not_suitable_for?: string[];
  excluded_domains?: string[];
  risk_conditions?: string[];
  fallback_recommendation?: string;
}

/** Single execution proof entry from AgentProfileV2 */
export interface ExecutionProof {
  action: string;
  status: 'success' | 'failure' | 'timeout' | 'refunded';
  outcome_class: 'completed' | 'partial' | 'failed' | 'cancelled';
  latency_ms?: number;
  receipt_id?: string;
  proof_source: 'request_log' | 'signed_receipt' | 'settlement_record';
  timestamp: string;
}

/** 7-day trend data point from AgentProfileV2 trust_metrics */
export interface TrendDay {
  date: string;
  count: number;
  success: number;
}

/** Learning signals from AgentProfileV2 */
export interface AgentLearning {
  known_limitations: string[];
  common_failure_patterns: string[];
  recent_improvements: { version: string; summary: string; timestamp: string }[];
  critiques: { type: 'structured'; summary: string; source_tier: string; timestamp: string }[];
}

/**
 * Hub v2 Agent Profile — returned by GET /api/agents/:owner.
 * Extends AgentProfileResponse with trust, authority, and learning signals.
 */
export interface AgentProfileV2 {
  owner: string;
  agent_id?: string;
  agent_name?: string;
  short_description?: string;
  joined_at: string;
  last_active: string;

  /** Performance tier based on execution metrics only (0=Listed, 1=Active, 2=Trusted). */
  performance_tier: 0 | 1 | 2;

  /** Verification badges granted by external actions, not metrics. */
  verification_badges: ('platform_verified' | 'org_authorized' | 'real_world_authorized')[];

  /** Authority metadata — source and current status. */
  authority: {
    authority_source: 'self' | 'platform' | 'org';
    verification_status: 'none' | 'observed' | 'verified' | 'revoked';
    scope?: string[];
    constraints?: Record<string, unknown>;
    expires_at?: string;
    status_ref?: string;
  };

  suitability?: AgentSuitability;

  trust_metrics: {
    total_executions: number;
    successful_executions: number;
    success_rate: number;
    avg_latency_ms: number;
    refund_rate: number;
    repeat_use_rate: number;
    trend_7d: TrendDay[];
    snapshot_at: string | null;
    aggregation_window: '7d' | '30d' | 'all';
  };

  execution_proofs: ExecutionProof[];
  learning: AgentLearning;

  /** All capability cards (backwards compat: was `skills`) */
  skills: HubCard[];
  recent_activity: ActivityEntry[];

  /** Backwards-compat aggregate profile shape */
  profile: AgentProfile;
}

/**
 * A single credit transaction record, as returned by GET /me/transactions.
 * Mirrors the CreditTransaction type from src/credit/ledger.ts.
 */
export interface CreditTransaction {
  id: string;
  owner: string;
  /** Positive = credit, negative = debit */
  amount: number;
  reason: 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund';
  reference_id: string | null;
  created_at: string;
}

/** Agent identity display info for verified badges and profile sections */
export interface AgentIdentityDisplay {
  agent_id: string;
  verified: boolean;
  guarantor?: string;
}

/** Activity event for the public feed (GET /api/activity) */
export interface ActivityEvent {
  id: string;
  type: 'exchange_completed' | 'capability_shared' | 'agent_joined' | 'milestone';
  card_name: string;
  requester: string;
  provider: string | null;
  status: 'success' | 'failure' | 'timeout';
  credits_charged: number;
  latency_ms: number;
  created_at: string;
}

/** Hub Agent as returned by GET /api/hub-agents */
export interface HubAgentSummary {
  agent_id: string;
  name: string;
  public_key: string;
  skill_routes: HubAgentSkillRoute[];
  status: 'active' | 'paused';
  secret_keys?: string[];
  created_at: string;
  updated_at: string;
}

/** Skill routing config for a Hub Agent */
export type HubAgentSkillRoute =
  | { skill_id: string; mode: 'direct_api'; config: { id: string; type: 'api'; name: string; endpoint: string; method: string; pricing: { credits_per_call: number }; [key: string]: unknown } }
  | { skill_id: string; mode: 'relay'; config: { relay_owner: string } }
  | { skill_id: string; mode: 'queue'; config: { relay_owner: string } };

/** Job record from GET /api/hub-agents/:id/jobs */
export interface HubAgentJob {
  id: string;
  hub_agent_id: string;
  skill_id: string;
  requester_owner: string;
  params: string;
  status: 'queued' | 'dispatched' | 'completed' | 'failed';
  result: string | null;
  escrow_id: string | null;
  relay_owner: string | null;
  created_at: string;
  updated_at: string;
}
