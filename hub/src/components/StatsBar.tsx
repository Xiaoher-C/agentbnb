/**
 * StatsBar — Header stats bar showing registry metrics.
 * Always visible even with zeros (per design decision).
 */

interface StatsBarProps {
  agentsOnline: number;
  totalCapabilities: number;
  totalExchanges: number;
}

/**
 * Renders a horizontal bar of registry stats.
 *
 * @param agentsOnline - Count of unique agent owners currently online
 * @param totalCapabilities - Total capability cards in registry
 * @param totalExchanges - Total exchanges (currently 0, no backend endpoint yet)
 */
export default function StatsBar({ agentsOnline, totalCapabilities, totalExchanges }: StatsBarProps) {
  return (
    <div className="flex items-center gap-6 mt-4 text-sm text-slate-400">
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
        <span>
          <span className="text-slate-200 font-medium">{agentsOnline}</span> agents online
        </span>
      </span>
      <span className="text-slate-600">|</span>
      <span>
        <span className="text-slate-200 font-medium">{totalCapabilities}</span> capabilities
      </span>
      <span className="text-slate-600">|</span>
      <span>
        <span className="text-slate-200 font-medium">{totalExchanges}</span> exchanges
      </span>
    </div>
  );
}
