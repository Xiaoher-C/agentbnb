/**
 * ActivityEventRow — Renders a single activity event in the public feed.
 *
 * Shows:
 * - Event type badge (Exchange = emerald, Shared = purple/violet)
 * - Participants: requester → card_name (with provider if available)
 * - Credits charged in accent green monospace (only when > 0)
 * - Relative timestamp (timeAgo)
 * - Status color: success = emerald-400, failure = red-400, timeout = yellow-400
 */
import type { ActivityEvent } from '../types.js';

interface ActivityEventRowProps {
  event: ActivityEvent;
}

/** Returns a human-readable relative timestamp (e.g. "2m ago", "just now"). */
function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/** Returns Tailwind classes for the event type badge. */
function badgeClasses(type: ActivityEvent['type']): string {
  if (type === 'capability_shared') {
    return 'bg-violet-500/20 text-violet-300 border border-violet-500/30';
  }
  // exchange_completed and others → emerald
  return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
}

/** Returns a short label for the event type badge. */
function badgeLabel(type: ActivityEvent['type']): string {
  switch (type) {
    case 'capability_shared':
      return 'Shared';
    case 'agent_joined':
      return 'Joined';
    case 'milestone':
      return 'Milestone';
    default:
      return 'Exchange';
  }
}

/** Returns Tailwind color class for the status dot. */
function statusColor(status: ActivityEvent['status']): string {
  switch (status) {
    case 'success':
      return 'text-emerald-400';
    case 'failure':
      return 'text-red-400';
    case 'timeout':
      return 'text-yellow-400';
  }
}

export default function ActivityEventRow({ event }: ActivityEventRowProps): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors">
      {/* Event type badge */}
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${badgeClasses(event.type)}`}>
        {badgeLabel(event.type)}
      </span>

      {/* Participants */}
      <div className="min-w-0 flex-1">
        <span className="text-sm text-hub-text-muted truncate">
          <span className="text-hub-text font-medium">{event.requester}</span>
          <span className="mx-1 opacity-40">→</span>
          <span className="text-hub-text font-medium">{event.card_name}</span>
          {event.provider !== null && (
            <span className="text-xs opacity-50 ml-1">({event.provider})</span>
          )}
        </span>
      </div>

      {/* Credits */}
      {event.credits_charged > 0 && (
        <span className="shrink-0 font-mono text-xs text-hub-accent font-semibold">
          cr {event.credits_charged}
        </span>
      )}

      {/* Status indicator */}
      <span className={`shrink-0 text-xs font-medium ${statusColor(event.status)}`}>
        {event.status}
      </span>

      {/* Relative time */}
      <span className="shrink-0 text-xs text-hub-text-muted whitespace-nowrap">
        {timeAgo(event.created_at)}
      </span>
    </div>
  );
}
