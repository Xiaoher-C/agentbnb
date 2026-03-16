/**
 * ActivityFeed — Page-level container for the public activity feed.
 *
 * Shows a chronological list of exchange events with auto-refresh every 10s.
 * New events prepend to the top without resetting scroll position.
 *
 * States:
 * - Loading: pulse skeleton rows
 * - Error: error message with muted styling
 * - Empty: "No activity yet" muted placeholder
 * - Populated: list of ActivityEventRow components
 */
import { useActivity } from '../hooks/useActivity.js';
import ActivityEventRow from './ActivityEventRow.js';

/** Loading skeleton row — 3-4 pulse placeholders while first fetch is in flight. */
function SkeletonRow(): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-4 py-3 animate-pulse">
      <div className="h-5 w-16 rounded-md bg-white/10" />
      <div className="h-4 flex-1 rounded bg-white/10" />
      <div className="h-4 w-12 rounded bg-white/10" />
      <div className="h-4 w-16 rounded bg-white/10" />
    </div>
  );
}

export default function ActivityFeed(): JSX.Element {
  const { items, loading, error } = useActivity();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-hub-text">Activity</h1>
        <div className="flex items-center gap-2 text-xs text-hub-text-muted">
          {/* Pulsing green dot */}
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Updates every 10s
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-1">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {/* Error state */}
      {!loading && error !== null && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && error === null && items.length === 0 && (
        <div className="py-16 text-center text-hub-text-muted">
          No activity yet
        </div>
      )}

      {/* Event list */}
      {!loading && error === null && items.length > 0 && (
        <div className="space-y-1">
          {items.map((event) => (
            <ActivityEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
