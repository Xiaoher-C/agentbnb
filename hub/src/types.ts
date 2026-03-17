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
  login: (key: string) => void;
  setSelectedCard: (card: HubCard | null) => void;
}

/** Agent profile as returned by GET /api/agents */
export interface AgentProfile {
  owner: string;
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
