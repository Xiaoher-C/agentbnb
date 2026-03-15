/**
 * SkeletonCard — Pulsing placeholder card shown during data loading.
 * Matches new compact card dimensions with dark SaaS aesthetic.
 */

/**
 * Renders a pulsing skeleton in the shape of a compact CapabilityCard.
 */
export default function SkeletonCard() {
  return (
    <div className="animate-pulse bg-hub-surface border border-hub-border rounded-card p-6">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-white/[0.06] flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-white/[0.06] rounded w-3/4" />
          <div className="h-3 bg-white/[0.06] rounded w-1/2" />
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 bg-white/[0.06] rounded-full w-16" />
        <div className="h-5 bg-white/[0.06] rounded-full w-20" />
        <div className="h-5 bg-white/[0.06] rounded-full w-14" />
      </div>
      <div className="mt-3 h-3 bg-white/[0.06] rounded w-full" />
    </div>
  );
}
