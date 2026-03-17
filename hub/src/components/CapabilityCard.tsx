/**
 * CapabilityCard — Compact card component for the Hub grid.
 * Clicking a card triggers the modal overlay (handled by parent via onClick).
 * No in-place expand behavior — modal comes in plan 02.
 */
import Avatar from 'boring-avatars';
import { inferCategories } from '../lib/categories.js';
import { formatCredits } from '../lib/utils.js';
import type { HubCard } from '../types.js';
import CategoryChip from './CategoryChip.js';
import LevelBadge from './LevelBadge.js';
import StatusDot from './StatusDot.js';

interface CapabilityCardProps {
  card: HubCard;
  onClick: () => void;
}

/**
 * Renders a compact capability card with dark SaaS aesthetic.
 * Layout: 32px identicon + title/owner/level row, ghost category chips, stats row.
 * Hover: lifts 2px, border brightens, shadow deepens.
 *
 * @param card - The HubCard data to display
 * @param onClick - Callback invoked when the card is clicked (opens modal)
 */
export default function CapabilityCard({ card, onClick }: CapabilityCardProps) {
  const { categories, overflow } = inferCategories(card.metadata);
  const online = card.availability.online;
  const successRate = card.metadata?.success_rate;

  return (
    <article
      role="article"
      onClick={onClick}
      className="bg-hub-surface border border-hub-border rounded-card p-6 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
    >
      {/* Header row: 32px identicon + name/owner/level */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar
            size={32}
            name={card.id}
            variant="beam"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-semibold text-hub-text-primary truncate leading-tight">
              {card.name}
            </p>
            <LevelBadge level={card.level} />
          </div>
          <p className="text-[13px] text-hub-text-tertiary mt-0.5">@{card.owner}</p>
        </div>
      </div>

      {/* Category chips row */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <CategoryChip key={cat.id} category={cat} />
        ))}
        {overflow > 0 && <CategoryChip category={categories[0]} overflowCount={overflow} />}
      </div>

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-3 text-xs text-hub-text-secondary flex-wrap">
        <span className="flex items-center gap-1.5">
          <StatusDot online={online} />
          {online ? 'Online' : 'Offline'}
        </span>
        {successRate !== undefined && (
          <>
            <span className="text-hub-text-tertiary">·</span>
            <span>{Math.round(successRate * 100)}% success</span>
          </>
        )}
        {card.uses_this_week !== undefined && card.uses_this_week > 0 && (
          <>
            <span className="text-hub-text-tertiary">·</span>
            <span>{card.uses_this_week} uses this week</span>
          </>
        )}
        <span className="text-hub-text-tertiary">·</span>
        <span className="font-mono text-hub-accent">{formatCredits(card.pricing)}</span>
        {card.pricing.free_tier !== undefined && card.pricing.free_tier > 0 && (
          <>
            <span className="text-hub-text-tertiary">·</span>
            <span className="font-mono text-hub-accent">{card.pricing.free_tier} free/mo</span>
          </>
        )}
      </div>
    </article>
  );
}
