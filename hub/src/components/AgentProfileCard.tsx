/**
 * AgentProfileCard — v10 Agent Maturity Rental tile.
 *
 * Premium dark-SaaS card showing one rentable agent. Per ADR-022, maturity
 * shows up as evidence categories — we never collapse it into a single score.
 *
 * Layout:
 *   Header     [Avatar] Name · runtime badge        ★ rating
 *              tagline · @owner
 *   Evidence   - platform sessions / completed tasks / repeat renters
 *              - response reliability / renter rating
 *              - verified tools (chips, max 5)
 *   Outcomes   3 most-recent /o/:share_token links
 *   Tags       skills demoted to chips
 *   Footer     pricing summary       [租用]
 */
import Avatar from 'boring-avatars';
import { Star, ExternalLink, Sparkles, Calendar } from 'lucide-react';
import type { RentableAgent } from '../hooks/useRentableAgents.js';

interface AgentProfileCardProps {
  agent: RentableAgent;
  /** Triggers when the user clicks the rent CTA — caller opens RentSessionModal. */
  onRent: (agent: RentableAgent) => void;
  /** Optional click on the card body — caller may navigate to /agents/:owner. */
  onView?: (agent: RentableAgent) => void;
}

const RUNTIME_CONFIG = {
  hermes: { label: 'Hermes', cls: 'text-violet-300 border-violet-400/30 bg-violet-400/[0.08]' },
  openclaw: { label: 'OpenClaw', cls: 'text-blue-300 border-blue-400/30 bg-blue-400/[0.08]' },
  unknown: { label: '—', cls: 'text-hub-text-muted border-hub-border/60 bg-white/[0.02]' },
} as const;

const AVATAR_COLORS = ['#10B981', '#059669', '#047857', '#065F46', '#064E3B'];

const MAX_OUTCOMES = 3;
const MAX_TOOL_CHIPS = 5;
const MAX_TAG_CHIPS = 4;

/** Render a single evidence row when the value is meaningful. */
function EvidenceRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}): JSX.Element | null {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between text-[12px]">
      <dt className="text-hub-text-muted">{label}</dt>
      <dd className="text-hub-text-primary font-medium">{value}</dd>
    </div>
  );
}

/** Format pricing as "cr 3 / min · cr 5 / msg · cr 100 / session". */
function formatPricing(pricing: RentableAgent['pricing']): string {
  const parts: string[] = [];
  if (pricing.per_minute !== undefined) parts.push(`cr ${pricing.per_minute} / min`);
  if (pricing.per_message !== undefined) parts.push(`cr ${pricing.per_message} / msg`);
  if (pricing.per_session !== undefined) parts.push(`cr ${pricing.per_session} / session`);
  return parts.length > 0 ? parts.join(' · ') : 'pricing on request';
}

export default function AgentProfileCard({
  agent,
  onRent,
  onView,
}: AgentProfileCardProps): JSX.Element {
  const runtime = RUNTIME_CONFIG[agent.runtime];
  const reliabilityPct =
    agent.evidence.response_reliability != null
      ? `${Math.round(agent.evidence.response_reliability * 100)}%`
      : null;
  const ratingDisplay =
    agent.evidence.renter_rating != null ? agent.evidence.renter_rating.toFixed(1) : null;

  const tools = agent.evidence.verified_tools.slice(0, MAX_TOOL_CHIPS);
  const toolsOverflow = agent.evidence.verified_tools.length - tools.length;

  const hasAnyEvidence =
    agent.evidence.platform_sessions !== null ||
    agent.evidence.completed_tasks !== null ||
    agent.evidence.repeat_renters !== null ||
    reliabilityPct !== null ||
    ratingDisplay !== null ||
    tools.length > 0;

  const outcomes = agent.recent_outcomes.slice(0, MAX_OUTCOMES);
  const tags = agent.tags.slice(0, MAX_TAG_CHIPS);
  const tagsOverflow = agent.tags.length - tags.length;

  // Determine whether to render the outer click handler — disabled if onView is absent
  const cardInteractive = typeof onView === 'function';

  return (
    <article
      role="article"
      onClick={cardInteractive ? () => onView?.(agent) : undefined}
      className={`bg-hub-surface border border-hub-border rounded-card p-5 flex flex-col gap-4 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${
        cardInteractive ? 'cursor-pointer hover:-translate-y-0.5' : ''
      }`}
    >
      {/* Header: avatar + name + runtime + rating */}
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar size={36} name={agent.agent_id} variant="marble" colors={AVATAR_COLORS} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-hub-text-primary truncate leading-tight">
              {agent.name}
            </p>
            {ratingDisplay !== null && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-0.5 text-[11px] text-amber-300"
                aria-label={`Rating ${ratingDisplay} stars`}
              >
                <Star size={11} fill="currentColor" />
                {ratingDisplay}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${runtime.cls}`}
            >
              {runtime.label}
            </span>
            <p className="text-[11px] text-hub-text-tertiary truncate">@{agent.owner_did}</p>
          </div>
          {agent.tagline && (
            <p className="text-[12px] text-hub-text-secondary mt-1.5 line-clamp-2 leading-relaxed">
              {agent.tagline}
            </p>
          )}
        </div>
      </header>

      {/* Maturity Evidence — categories, never collapsed into a single score (ADR-022) */}
      <section aria-label="Maturity evidence" className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-hub-text-muted">
          Maturity evidence
        </p>
        <dl className="space-y-1">
          <EvidenceRow label="Platform sessions" value={agent.evidence.platform_sessions} />
          <EvidenceRow label="Completed tasks" value={agent.evidence.completed_tasks} />
          <EvidenceRow label="Repeat renters" value={agent.evidence.repeat_renters} />
          <EvidenceRow label="Response reliability" value={reliabilityPct} />
          <EvidenceRow label="Renter rating" value={ratingDisplay} />
        </dl>

        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {tools.map((tool) => (
              <span
                key={tool}
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300/80"
              >
                {tool}
              </span>
            ))}
            {toolsOverflow > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-hub-border text-hub-text-muted">
                +{toolsOverflow}
              </span>
            )}
          </div>
        )}

        {!hasAnyEvidence && (
          <p className="text-[11px] text-hub-text-muted italic">
            No execution history yet — be the first renter.
          </p>
        )}
      </section>

      {/* Recent outcomes */}
      {outcomes.length > 0 && (
        <section aria-label="Recent outcomes" className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-hub-text-muted">
            Recent outcomes
          </p>
          <ul className="space-y-1">
            {outcomes.map((token) => (
              <li key={token}>
                <a
                  href={`#/o/${token}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[12px] text-hub-text-secondary hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink size={11} />
                  Outcome {token.slice(0, 8)}…
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Availability — free-form labels; backend may not surface this yet */}
      {agent.availability.length > 0 && (
        <section aria-label="Availability" className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-hub-text-muted">
            Available slots
          </p>
          <ul className="space-y-0.5">
            {agent.availability.map((slot) => (
              <li
                key={slot.starts_at ?? slot.label}
                className="flex items-center gap-1.5 text-[12px] text-hub-text-secondary"
              >
                <Calendar size={11} className="text-hub-text-muted" />
                <span>{slot.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Skills demoted — shown as chips, not the headline */}
      {tags.length > 0 && (
        <section aria-label="Skills" className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-hub-border text-hub-text-secondary"
            >
              {tag}
            </span>
          ))}
          {tagsOverflow > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-hub-border text-hub-text-muted">
              +{tagsOverflow}
            </span>
          )}
        </section>
      )}

      {/* Footer — pricing + Rent CTA */}
      <footer className="flex items-center justify-between gap-3 mt-auto pt-1">
        <span className="text-[12px] font-mono text-hub-accent truncate">
          {formatPricing(agent.pricing)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRent(agent);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-hub-accent text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors"
        >
          <Sparkles size={13} />
          租用
        </button>
      </footer>
    </article>
  );
}
