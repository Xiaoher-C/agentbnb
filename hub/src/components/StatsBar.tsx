/**
 * StatsBar — Header stats bar showing registry metrics.
 * Always visible even with zeros (per design decision).
 * Premium design: 32px JetBrains Mono emerald numbers with ambient radial glow.
 * Count-up animation: numbers animate from 0 to target over 400ms with ease-out cubic.
 */
import { useState, useEffect, useRef } from 'react';

interface StatsBarProps {
  agentsOnline: number;
  totalCapabilities: number;
  totalExchanges: number;
}

/**
 * Animates a number from 0 to target over `duration` ms with ease-out cubic.
 * Re-triggers whenever `target` changes.
 */
function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(target);

  useEffect(() => {
    // Only animate when target changes and is > 0
    if (target === 0) { setValue(0); return; }
    const start = 0;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    prevTarget.current = target;
  }, [target, duration]);

  return value;
}

/**
 * Renders a horizontal bar of registry stats with large monospace numbers and ambient glow.
 * Each stat number animates from 0 to its real value on mount and on value change.
 *
 * @param agentsOnline - Count of unique agent owners currently online
 * @param totalCapabilities - Total capability cards in registry
 * @param totalExchanges - Total exchanges (currently 0, no backend endpoint yet)
 */
export default function StatsBar({ agentsOnline, totalCapabilities, totalExchanges }: StatsBarProps) {
  const animatedAgents = useCountUp(agentsOnline);
  const animatedCapabilities = useCountUp(totalCapabilities);
  const animatedExchanges = useCountUp(totalExchanges);

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
            {animatedAgents}
          </span>
          <span className="text-sm text-hub-text-muted">Agents Online</span>
        </div>

        {/* Separator */}
        <div className="w-px h-8 bg-white/[0.06]" />

        {/* Capabilities */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[32px] leading-tight font-mono font-semibold text-hub-accent">
            {animatedCapabilities}
          </span>
          <span className="text-sm text-hub-text-muted">Capabilities</span>
        </div>

        {/* Separator */}
        <div className="w-px h-8 bg-white/[0.06]" />

        {/* Exchanges */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[32px] leading-tight font-mono font-semibold text-hub-accent">
            {animatedExchanges}
          </span>
          <span className="text-sm text-hub-text-muted">Exchanges</span>
        </div>
      </div>
    </div>
  );
}
