/**
 * SkeletonCard — Pulsing placeholder card shown during data loading.
 */

/**
 * Renders a pulsing gray skeleton in the shape of a CapabilityCard.
 */
export default function SkeletonCard() {
  return (
    <div className="animate-pulse bg-slate-700/50 rounded-xl border border-slate-700 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-600 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-600 rounded w-3/4" />
          <div className="h-3 bg-slate-600 rounded w-1/2" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-5 bg-slate-600 rounded-full w-16" />
        <div className="h-5 bg-slate-600 rounded-full w-20" />
        <div className="h-5 bg-slate-600 rounded-full w-14" />
      </div>
      <div className="mt-3 h-3 bg-slate-600 rounded w-full" />
    </div>
  );
}
