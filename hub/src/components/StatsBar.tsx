/**
 * StatsBar — Header stats bar showing registry metrics.
 * Always visible even with zeros (per design decision).
 * Premium design: 32px JetBrains Mono emerald numbers with ambient radial glow.
 */

interface StatsBarProps {
  agentsOnline: number;
  totalCapabilities: number;
  totalExchanges: number;
}

/**
 * Renders a horizontal bar of registry stats with large monospace numbers and ambient glow.
 *
 * @param agentsOnline - Count of unique agent owners currently online
 * @param totalCapabilities - Total capability cards in registry
 * @param totalExchanges - Total exchanges (currently 0, no backend endpoint yet)
 */
export default function StatsBar({ agentsOnline, totalCapabilities, totalExchanges }: StatsBarProps) {
  return (
    <div className="relative flex justify-center items-center py-8">
      {/* Ambient glow behind stats — soft emerald halo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(16, 185, 129, 0.08) 0%, transparent 70%)',
          width: '600px',
          height: '200px',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 0,
        }}
      />

      {/* Stats row */}
      <div className="relative flex items-center justify-center gap-12" style={{ zIndex: 10 }}>
        {/* Agents Online */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[32px] leading-tight font-mono font-semibold text-hub-accent">
            {agentsOnline}
          </span>
          <span className="text-sm text-hub-text-muted">Agents Online</span>
        </div>

        {/* Separator */}
        <div className="w-px h-8 bg-white/[0.06]" />

        {/* Capabilities */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[32px] leading-tight font-mono font-semibold text-hub-accent">
            {totalCapabilities}
          </span>
          <span className="text-sm text-hub-text-muted">Capabilities</span>
        </div>

        {/* Separator */}
        <div className="w-px h-8 bg-white/[0.06]" />

        {/* Exchanges */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[32px] leading-tight font-mono font-semibold text-hub-accent">
            {totalExchanges}
          </span>
          <span className="text-sm text-hub-text-muted">Exchanges</span>
        </div>
      </div>
    </div>
  );
}
