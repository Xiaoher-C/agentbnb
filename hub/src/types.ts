/**
 * Frontend-specific types for AgentBnB Hub.
 * Mirrors the subset of CapabilityCard fields needed by the hub UI.
 * Avoids importing from the parent project's src/types.
 */

export interface HubCard {
  id: string;
  owner: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;
  inputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  outputs: Array<{ name: string; type: string; description?: string; required?: boolean }>;
  pricing: { credits_per_call: number; credits_per_minute?: number };
  availability: { online: boolean; schedule?: string };
  metadata?: {
    apis_used?: string[];
    avg_latency_ms?: number;
    success_rate?: number;
    tags?: string[];
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
 * Two-state status: online (emerald) or offline (rose).
 * Three-state status deferred until backend exposes idle metrics. MVP ships with online/offline.
 */
export type StatusColor = 'emerald' | 'rose';

export interface CardsResponse {
  total: number;
  limit: number;
  offset: number;
  items: HubCard[];
}
