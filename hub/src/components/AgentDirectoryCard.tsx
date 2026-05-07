/**
 * AgentDirectoryCard — Tile representation of a registered agent for the /agents directory.
 *
 * Surfaces: avatar, agent name (owner), member-since date, optional performance-tier badge,
 * top capability-category chips (max 3), success rate, skill count, total earned.
 *
 * Clicks navigate to `/agents/:owner`. Chips and the tier badge are optional — the tile
 * degrades gracefully when the cross-referenced /cards data is missing.
 */
import Avatar from './Avatar.js';
import CategoryChip from './CategoryChip.js';
import type { AgentProfile, Category } from '../types.js';

interface AgentDirectoryCardProps {
  agent: AgentProfile;
  /** Top capability categories for this agent (max 3). Optional — omitted when /cards fetch failed. */
  categories?: Category[];
  /** Performance tier derived from this agent's cards (0/1/2). Optional. */
  performanceTier?: 0 | 1 | 2;
  onClick: () => void;
}

const TIER_CONFIG = {
  0: { label: 'Listed', cls: 'text-hub-text-muted border-hub-border/60 bg-white/[0.02]' },
  1: { label: 'Active', cls: 'text-blue-400 border-blue-400/25 bg-blue-400/[0.06]' },
  2: { label: 'Trusted', cls: 'text-emerald-400 border-emerald-400/25 bg-emerald-400/[0.06]' },
} as const;

/**
 * Renders a single agent tile. Keep the visual language aligned with CapabilityCard
 * so the /agents directory reads as a sibling surface to /discover.
 */
export default function AgentDirectoryCard({
  agent,
  categories,
  performanceTier,
  onClick,
}: AgentDirectoryCardProps): JSX.Element {
  const successPct =
    agent.success_rate != null ? Math.round(agent.success_rate * 100) : null;
  const memberSince = new Date(agent.member_since).toLocaleDateString();
  const tier = performanceTier !== undefined ? TIER_CONFIG[performanceTier] : null;

  return (
    <article
      role="article"
      onClick={onClick}
      className="bg-hub-surface border border-hub-border rounded-card p-5 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)] flex flex-col gap-3"
    >
      {/* Header: avatar + name + optional tier badge */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar agentId={agent.owner} size={32} name={agent.owner} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-hub-text-primary truncate leading-tight">
              {agent.owner}
            </p>
            {tier && (
              <span
                className={`flex-shrink-0 text-[10px] font-medium border rounded px-1.5 py-0.5 ${tier.cls}`}
              >
                {tier.label}
              </span>
            )}
          </div>
          <p className="text-[12px] text-hub-text-tertiary mt-0.5">
            Member since {memberSince}
          </p>
        </div>
      </div>

      {/* Capability chips (top 3, if available) */}
      {categories && categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <CategoryChip key={cat.id} category={cat} />
          ))}
        </div>
      )}

      {/* Footer: success rate · skill count · total earned */}
      <div className="flex items-center gap-2.5 text-xs text-hub-text-secondary flex-wrap">
        {successPct !== null ? (
          <span
            className={
              successPct >= 85
                ? 'text-emerald-400/80'
                : successPct >= 70
                  ? 'text-amber-400/80'
                  : 'text-hub-text-secondary'
            }
          >
            {successPct}% success
          </span>
        ) : (
          <span className="text-hub-text-tertiary">no runs yet</span>
        )}
        <span className="text-hub-text-tertiary/50">·</span>
        <span>
          {agent.skill_count} {agent.skill_count === 1 ? 'skill' : 'skills'}
        </span>
        <span className="ml-auto font-mono text-hub-accent">
          cr {agent.total_earned}
        </span>
      </div>
    </article>
  );
}
