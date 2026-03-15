/**
 * LevelBadge — Visual indicator for capability card level (1=Atomic, 2=Pipeline, 3=Environment).
 * Ghost style: transparent bg, subtle border, 11px text.
 */
import { getLevelBadge } from '../lib/utils.js';

interface LevelBadgeProps {
  level: 1 | 2 | 3;
}

/**
 * Renders a level badge with a distinct visual icon per level.
 *
 * L1 Atomic: single dot
 * L2 Pipeline: two connected dots
 * L3 Environment: solid block
 *
 * @param level - The capability level (1, 2, or 3)
 */
export default function LevelBadge({ level }: LevelBadgeProps) {
  const badge = getLevelBadge(level);

  const icon =
    level === 1 ? (
      <span className="w-1.5 h-1.5 rounded-full bg-hub-text-secondary inline-block" />
    ) : level === 2 ? (
      <span className="flex items-center gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-hub-text-secondary inline-block" />
        <span className="w-2.5 h-0.5 bg-hub-text-tertiary inline-block" />
        <span className="w-1.5 h-1.5 rounded-full bg-hub-text-secondary inline-block" />
      </span>
    ) : (
      <span className="w-3.5 h-1.5 rounded-sm bg-hub-text-secondary inline-block" />
    );

  return (
    <span className={`${badge.style} flex items-center gap-1`}>
      {icon}
      {badge.label}
    </span>
  );
}
