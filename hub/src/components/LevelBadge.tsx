/**
 * LevelBadge — Visual indicator for capability card level (1=Atomic, 2=Pipeline, 3=Environment).
 */
import { getLevelBadge } from '../lib/utils.js';

interface LevelBadgeProps {
  level: 1 | 2 | 3;
}

/**
 * Renders a level badge with a distinct visual style per level.
 *
 * L1 Atomic: single indigo dot + "Atomic" text
 * L2 Pipeline: two connected dots + "Pipeline" text
 * L3 Environment: solid indigo block + "Environment" text
 *
 * @param level - The capability level (1, 2, or 3)
 */
export default function LevelBadge({ level }: LevelBadgeProps) {
  const badge = getLevelBadge(level);

  const icon =
    level === 1 ? (
      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
    ) : level === 2 ? (
      <span className="flex items-center gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
        <span className="w-3 h-0.5 bg-indigo-500/50 inline-block" />
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
      </span>
    ) : (
      <span className="w-4 h-2 rounded-sm bg-indigo-500 inline-block" />
    );

  return (
    <span className={`${badge.style} flex items-center gap-1.5`}>
      {icon}
      {badge.label}
    </span>
  );
}
