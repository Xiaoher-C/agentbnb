/**
 * CapabilityCard v2 — Hub v2 compact card with trust-first layout.
 *
 * Header:    [Avatar] Name                    [Tier badge]
 * Subheader:          @owner          [Authority source]
 * Chips:     [category] [category]
 * Footer:    ● success%  latency  price
 *
 * Trust signals at the TOP — tier badge and authority source are the first
 * things the eye catches, not an afterthought at the bottom.
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

const TIER_CONFIG = {
  0: { label: 'Listed',  cls: 'text-hub-text-muted border-hub-border/60 bg-white/[0.02]' },
  1: { label: 'Active',  cls: 'text-blue-400 border-blue-400/25 bg-blue-400/[0.06]' },
  2: { label: 'Trusted', cls: 'text-emerald-400 border-emerald-400/25 bg-emerald-400/[0.06]' },
} as const;

const AUTHORITY_CONFIG = {
  platform: { label: 'Platform observed', cls: 'text-blue-400/70' },
  org:      { label: 'Org-backed',        cls: 'text-violet-400/70' },
  self:     { label: 'Self-declared',     cls: 'text-hub-text-muted' },
} as const;

export default function CapabilityCard({ card, onClick }: CapabilityCardProps) {
  const { categories, overflow } = inferCategories(card.metadata);
  const online = card.availability.online;
  const successRate = card.metadata?.success_rate;
  const avgLatency = card.metadata?.avg_latency_ms;
  const isAgentTile = card.skill_count !== undefined;

  const tier = TIER_CONFIG[card.performance_tier ?? 0];
  const authority = AUTHORITY_CONFIG[card.authority_source ?? 'self'];

  return (
    <article
      role="article"
      onClick={onClick}
      className="bg-hub-surface border border-hub-border rounded-card p-5 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)] flex flex-col gap-3"
    >
      {/* Header: avatar + name + tier badge */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar size={32} name={card.id} variant="beam" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Row 1: name (left) + tier badge (right) */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-hub-text-primary truncate leading-tight">
              {card.name}
            </p>
            <span className={`flex-shrink-0 text-[10px] font-medium border rounded px-1.5 py-0.5 ${tier.cls}`}>
              {tier.label}
            </span>
          </div>
          {/* Row 2: owner (left) + [skills count badge or level badge] + authority source (right) */}
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] text-hub-text-tertiary">@{card.owner}</p>
              {isAgentTile ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-hub-border text-hub-text-muted">
                  {card.skill_count} {card.skill_count === 1 ? 'skill' : 'skills'}
                </span>
              ) : (
                <LevelBadge level={card.level} />
              )}
            </div>
            <span className={`flex-shrink-0 text-[10px] ${authority.cls}`}>
              {authority.label}
            </span>
          </div>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <CategoryChip key={cat.id} category={cat} />
          ))}
          {overflow > 0 && <CategoryChip category={categories[0]} overflowCount={overflow} />}
        </div>
      )}

      {/* Footer: status dot + metrics + price */}
      <div className="flex items-center gap-2.5 text-xs text-hub-text-secondary flex-wrap">
        {/* Online status — weak dot only, no big "Online" label */}
        <StatusDot online={online} />

        {successRate !== undefined && (
          <>
            <span className="text-hub-text-tertiary/50">·</span>
            <span className={successRate >= 0.85 ? 'text-emerald-400/80' : successRate >= 0.7 ? 'text-amber-400/80' : 'text-hub-text-secondary'}>
              {Math.round(successRate * 100)}%
            </span>
          </>
        )}

        {avgLatency !== undefined && (
          <>
            <span className="text-hub-text-tertiary/50">·</span>
            <span>{avgLatency < 1000 ? `${avgLatency}ms` : `${(avgLatency / 1000).toFixed(1)}s`}</span>
          </>
        )}

        <span className="ml-auto font-mono text-hub-accent">
          {card.display_price ?? formatCredits(card.pricing)}
        </span>
      </div>
    </article>
  );
}
