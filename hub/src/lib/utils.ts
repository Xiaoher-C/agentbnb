/**
 * Utility functions for AgentBnB Hub UI components.
 *
 * Provides level badge metadata, status indicator colors,
 * and credit formatting for capability card display.
 */
import type { LevelBadge, StatusColor } from '../types.js';

/**
 * Get visual badge metadata for a capability card level.
 *
 * Level 1 (Atomic): single-dot style — minimal, self-contained
 * Level 2 (Pipeline): connected-dots style — chained operations
 * Level 3 (Environment): block style — full deployment
 *
 * @param level - The capability level (1, 2, or 3)
 * @returns LevelBadge with label and Tailwind style classes
 */
export function getLevelBadge(level: 1 | 2 | 3): LevelBadge {
  const badges: Record<1 | 2 | 3, LevelBadge> = {
    1: {
      level: 1,
      label: 'Atomic',
      style: 'badge-dot text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300',
    },
    2: {
      level: 2,
      label: 'Pipeline',
      style: 'badge-connected text-xs px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300',
    },
    3: {
      level: 3,
      label: 'Environment',
      style: 'badge-block text-xs px-2 py-0.5 rounded bg-violet-900 text-violet-300',
    },
  };
  return badges[level];
}

/**
 * Get the Tailwind color name for an online/offline status.
 *
 * Two-state only (online/offline). Three-state status (idle%) deferred
 * until the backend exposes idle metrics.
 *
 * @param online - Whether the agent is currently online
 * @returns 'emerald' for online, 'rose' for offline
 */
export function getStatusIndicator(online: boolean): StatusColor {
  return online ? 'emerald' : 'rose';
}

/**
 * Format a pricing object into a human-readable credit string.
 *
 * @param pricing - The card's pricing object
 * @returns e.g. "5 credits" or "5-120 credits"
 */
export function formatCredits(pricing: {
  credits_per_call: number;
  credits_per_minute?: number;
}): string {
  if (pricing.credits_per_minute !== undefined) {
    return `${pricing.credits_per_call}-${pricing.credits_per_minute} credits`;
  }
  return `${pricing.credits_per_call} credits`;
}
