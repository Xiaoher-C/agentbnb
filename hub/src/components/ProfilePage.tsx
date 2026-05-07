/**
 * ProfilePage — v10 Agent Maturity Rental profile (ADR-022, ADR-023).
 *
 * Public agent profile at `#/agents/:owner`. Replaces the v9 skill-marketplace
 * layout that surfaced capability cards as primary content.
 *
 * v10 narrative (top → bottom):
 *   1. Hero          — boring-avatar, name, tagline, runtime badge,
 *                      rating chip, DID + member-since, RENT CTA
 *   2. Maturity      — discrete evidence rows (NEVER a single score, ADR-022)
 *      Evidence
 *   3. Past Outcomes — recent /o/:share_token links (max 5)
 *   4. Skill tags    — demoted to a chip row at the bottom
 *
 * Data sources:
 *   - useAgentProfile(owner)         → AgentProfileV2 (skills, joined_at, etc.)
 *   - useMaturityEvidence(agent_id)  → live MaturityEvidence (D1 endpoint)
 *
 * Empty state: even agents with no rentals are still rentable — hero + skill
 *              tags + Rent CTA stay; only the Maturity Evidence section shows
 *              the empty-state copy.
 *
 * Privacy: the Rent CTA opens RentSessionModal which auto-applies
 *          `session_mode: true` per ADR-024.
 */
import { useEffect, useMemo, useState } from 'react';
import Avatar from 'boring-avatars';
import {
  Link,
  useNavigate,
  useParams,
} from 'react-router';
import {
  Check,
  Copy,
  Sparkles,
  Star,
  ExternalLink,
} from 'lucide-react';
import { useAgentProfile } from '../hooks/useAgents.js';
import {
  useMaturityEvidence,
  type MaturityEvidence,
} from '../hooks/useMaturityEvidence.js';
import type { RentableAgent } from '../hooks/useRentableAgents.js';
import type { AgentProfileV2, HubCard } from '../types.js';
import RentSessionModal from './RentSessionModal.js';

const AVATAR_COLORS = ['#10B981', '#059669', '#047857', '#065F46', '#064E3B'];

const MAX_OUTCOMES = 5;
const MAX_TAG_CHIPS = 12;

/** Truncates a long DID for display while keeping prefix + suffix. */
function shortenAgentId(agentId: string): string {
  if (agentId.length <= 12) return agentId;
  return `${agentId.slice(0, 8)}…${agentId.slice(-4)}`;
}

/** Pull the first skill that exposes a cryptographic agent_id (v8+ cards). */
function findAgentId(skills: HubCard[]): string | undefined {
  return skills.find((s) => s.agent_id)?.agent_id;
}

/** Heuristic runtime classifier — honest "Hermes / OpenClaw / —" label. */
function detectRuntime(skills: HubCard[]): 'hermes' | 'openclaw' | 'unknown' {
  const apis = skills.flatMap((s) => s.metadata?.apis_used ?? []).map((s) => s.toLowerCase());
  const tags = skills.flatMap((s) => s.metadata?.tags ?? []).map((s) => s.toLowerCase());
  const haystack = [...apis, ...tags];
  if (haystack.some((v) => v.includes('hermes'))) return 'hermes';
  if (haystack.some((v) => v.includes('openclaw'))) return 'openclaw';
  return 'unknown';
}

/** Aggregate per-call price → coarse per-minute hint (the only price the modal needs). */
function derivePerMinute(skills: HubCard[]): number | undefined {
  for (const s of skills) {
    const perMin = s.pricing?.credits_per_minute;
    if (typeof perMin === 'number' && perMin > 0) return perMin;
  }
  for (const s of skills) {
    const perCall = s.pricing?.credits_per_call;
    if (typeof perCall === 'number' && perCall > 0) return perCall;
  }
  return undefined;
}

/** Aggregate skill tags from capability_types + metadata.tags, deduped. */
function collectTags(skills: HubCard[]): string[] {
  const set = new Set<string>();
  for (const s of skills) {
    for (const t of s.metadata?.tags ?? []) set.add(t);
    for (const t of s.capability_types ?? []) set.add(t);
  }
  return Array.from(set);
}

const RUNTIME_CONFIG = {
  hermes: { label: 'Hermes', cls: 'text-violet-300 border-violet-400/30 bg-violet-400/[0.08]' },
  openclaw: { label: 'OpenClaw', cls: 'text-blue-300 border-blue-400/30 bg-blue-400/[0.08]' },
  unknown: { label: '—', cls: 'text-hub-text-muted border-hub-border/60 bg-white/[0.02]' },
} as const;

interface DidChipProps {
  agentId: string;
}

/**
 * Compact DID chip with a copy affordance. Clipboard failure is silently
 * swallowed — the button stays in its resting state.
 */
function DidChip({ agentId }: DidChipProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const did = `did:agentbnb:${agentId}`;
  const display = `did:agentbnb:${shortenAgentId(agentId)}`;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable.
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] border border-hub-border text-hub-text-secondary"
        title={did}
      >
        {display}
      </span>
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        className="text-hub-text-muted hover:text-hub-text-primary transition-colors"
        aria-label={copied ? 'DID copied' : 'Copy DID'}
        title={copied ? 'Copied' : 'Copy DID'}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </span>
  );
}

/**
 * Build a `RentableAgent` from an `AgentProfileV2` so we can hand it to the
 * existing `RentSessionModal` without changing its contract.
 */
function buildRentTarget(profile: AgentProfileV2): RentableAgent {
  const skills = profile.skills;
  const agentId = profile.agent_id ?? findAgentId(skills) ?? profile.owner;
  const verifiedTools = Array.from(
    new Set(skills.flatMap((s) => s.metadata?.apis_used ?? [])),
  );
  const tags = collectTags(skills).slice(0, 8);
  const minutePrice = derivePerMinute(skills);
  return {
    agent_id: agentId,
    name: profile.agent_name ?? skills[0]?.name ?? profile.owner,
    owner_did: profile.owner,
    tagline: profile.short_description ?? skills[0]?.description?.slice(0, 120) ?? '',
    rating: null,
    runtime: detectRuntime(skills),
    member_since: profile.joined_at,
    evidence: {
      platform_sessions: null,
      completed_tasks: null,
      repeat_renters: null,
      artifact_examples: [],
      verified_tools: verifiedTools,
      response_reliability: profile.trust_metrics.success_rate,
      renter_rating: null,
    },
    recent_outcomes: [],
    availability: [],
    pricing: minutePrice !== undefined ? { per_minute: minutePrice } : {},
    tags,
  };
}

interface EvidenceRowProps {
  label: string;
  value: string | null;
}

/**
 * Discrete evidence card. Returns `null` when the value would be meaningless —
 * we deliberately avoid surfacing zero rows so empty agents render the
 * empty-state copy instead of "0 past rentals".
 */
function EvidenceRow({ label, value }: EvidenceRowProps): JSX.Element | null {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between bg-white/[0.02] border border-hub-border rounded-lg px-4 py-3">
      <dt className="text-xs text-hub-text-muted">{label}</dt>
      <dd className="text-sm text-hub-text-primary font-medium">{value}</dd>
    </div>
  );
}

/** "1 past rental" / "12 past rentals" with null guard. */
function pluralCount(value: number | null | undefined, singular: string, plural: string): string | null {
  if (value === null || value === undefined || value === 0) return null;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Compose "4.8★ (32 ratings)" / "4.8★" / null per ADR-022 narrative. */
function formatRating(avg: number | null | undefined, count: number | null | undefined): string | null {
  if (avg === null || avg === undefined) return null;
  const display = avg.toFixed(1);
  if (!count || count === 0) return `${display}★`;
  return `${display}★ (${count} rating${count === 1 ? '' : 's'})`;
}

interface MaturityEvidenceSectionProps {
  evidence: MaturityEvidence | null;
  loading: boolean;
  error: string | null;
}

/**
 * Section 2 — Maturity Evidence.
 *
 * Shows discrete signals; never collapses them into a single score (ADR-022).
 * When the agent has no agent_id (v1 cards) or the live endpoint 404s, falls
 * through to the empty-state copy. Errors are surfaced quietly.
 */
function MaturityEvidenceSection({
  evidence,
  loading,
  error,
}: MaturityEvidenceSectionProps): JSX.Element {
  const sessionsLabel = pluralCount(evidence?.platform_observed_sessions, 'past rental', 'past rentals');
  const tasksLabel = pluralCount(evidence?.completed_tasks, 'task done', 'tasks done');
  const renterLabel = pluralCount(evidence?.repeat_renters, 'repeat renter', 'repeat renters');

  const reliabilityPct =
    evidence && evidence.response_reliability > 0
      ? `${Math.round(evidence.response_reliability * 100)}%`
      : 'N/A';

  const ratingLabel = formatRating(
    evidence?.renter_rating_avg ?? null,
    evidence?.renter_rating_count ?? 0,
  );

  const tools = evidence?.verified_tools ?? [];

  const hasAnySignal = Boolean(
    sessionsLabel ||
      tasksLabel ||
      renterLabel ||
      (evidence && evidence.response_reliability > 0) ||
      ratingLabel ||
      tools.length > 0,
  );

  return (
    <section
      aria-labelledby="maturity-heading"
      className="bg-hub-surface border border-hub-border rounded-xl p-6"
    >
      <h2
        id="maturity-heading"
        className="text-[13px] font-semibold text-hub-text-muted uppercase tracking-wider mb-4"
      >
        Maturity evidence
      </h2>

      {loading ? (
        <div className="space-y-2" aria-label="Loading maturity evidence">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-lg bg-white/[0.04] animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : !hasAnySignal ? (
        <p className="text-sm text-hub-text-muted italic">
          New to AgentBnB — no rentals yet.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <EvidenceRow label="Past rentals" value={sessionsLabel} />
            <EvidenceRow label="Tasks done" value={tasksLabel} />
            <EvidenceRow label="Repeat renters" value={renterLabel} />
            <EvidenceRow label="Response reliability" value={reliabilityPct} />
            <EvidenceRow label="Renter rating" value={ratingLabel} />
          </dl>

          {tools.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wider text-hub-text-muted mb-2">
                Verified tools
              </p>
              <div className="flex flex-wrap gap-1.5" aria-label="Verified tools">
                {tools.map((tool) => (
                  <span
                    key={tool}
                    className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300/90"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && !loading && (
        <p className="mt-3 text-[11px] text-amber-400/70" role="status">
          Evidence preview is stale.
        </p>
      )}
    </section>
  );
}

interface PastOutcomesSectionProps {
  evidence: MaturityEvidence | null;
  loading: boolean;
}

/**
 * Section 3 — Past Outcomes.
 *
 * Lists up to 5 recent outcome share artefacts (links resolve to the public
 * `/o/:share_token` view). The list is omitted entirely when there are none.
 */
function PastOutcomesSection({ evidence, loading }: PastOutcomesSectionProps): JSX.Element | null {
  const items = evidence?.artifact_examples ?? [];

  if (loading) {
    return (
      <section
        aria-label="Past outcomes (loading)"
        className="bg-hub-surface border border-hub-border rounded-xl p-6"
      >
        <h2 className="text-[13px] font-semibold text-hub-text-muted uppercase tracking-wider mb-4">
          Past outcomes
        </h2>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded-lg bg-white/[0.04] animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  const visible = items.slice(0, MAX_OUTCOMES);
  const overflow = items.length - visible.length;

  return (
    <section
      aria-labelledby="outcomes-heading"
      className="bg-hub-surface border border-hub-border rounded-xl p-6"
    >
      <h2
        id="outcomes-heading"
        className="text-[13px] font-semibold text-hub-text-muted uppercase tracking-wider mb-4"
      >
        Past outcomes
      </h2>
      <ul className="space-y-2">
        {visible.map((artifact) => (
          <li key={artifact.share_token}>
            <a
              href={`#/o/${encodeURIComponent(artifact.share_token)}`}
              className="group flex items-center gap-2 text-sm text-hub-text-secondary hover:text-emerald-300 transition-colors"
            >
              <ExternalLink size={13} className="flex-shrink-0 text-hub-text-muted group-hover:text-emerald-300" />
              <span className="truncate">{artifact.summary || `Outcome ${artifact.share_token.slice(0, 8)}…`}</span>
            </a>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <p className="mt-3 text-xs text-hub-text-muted">
          + {overflow} more outcome{overflow === 1 ? '' : 's'}
        </p>
      )}
    </section>
  );
}

interface SkillTagsSectionProps {
  skills: HubCard[];
}

/** Section 4 — Skill tags. Demoted from primary content per the v10 reframe. */
function SkillTagsSection({ skills }: SkillTagsSectionProps): JSX.Element | null {
  const tags = useMemo(() => collectTags(skills).slice(0, MAX_TAG_CHIPS), [skills]);
  if (tags.length === 0) return null;
  return (
    <section
      aria-labelledby="skills-heading"
      className="bg-hub-surface border border-hub-border rounded-xl p-6"
    >
      <h2
        id="skills-heading"
        className="text-[13px] font-semibold text-hub-text-muted uppercase tracking-wider mb-3"
      >
        Skills
      </h2>
      <div className="flex flex-wrap gap-1.5" aria-label="Skill tags">
        {tags.map((tag) => (
          <span
            key={tag}
            className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-hub-border text-hub-text-secondary"
          >
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}

interface HeroProps {
  profile: AgentProfileV2;
  agentId: string | undefined;
  rentTarget: RentableAgent;
  evidence: MaturityEvidence | null;
  onRent: () => void;
}

/**
 * Section 1 — Hero.
 *
 * boring-avatar (NOT icon-based per v10 reframe), name + tagline, runtime
 * badge, rating chip (when available), DID + member-since, primary RENT CTA.
 */
function Hero({ profile, agentId, rentTarget, evidence, onRent }: HeroProps): JSX.Element {
  const runtime = RUNTIME_CONFIG[rentTarget.runtime];
  const ratingLabel = formatRating(
    evidence?.renter_rating_avg ?? null,
    evidence?.renter_rating_count ?? 0,
  );
  const displayName = rentTarget.name;
  const perMinute = rentTarget.pricing.per_minute;
  const ctaLabel = perMinute !== undefined
    ? `Rent for cr ${perMinute}/min`
    : 'Rent this agent';

  return (
    <section
      aria-labelledby="hero-heading"
      className="bg-hub-surface border border-hub-border rounded-xl p-6 md:p-8"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <div className="flex-shrink-0">
          <Avatar
            size={72}
            name={agentId ?? profile.owner}
            variant="marble"
            colors={AVATAR_COLORS}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              id="hero-heading"
              className="text-2xl font-bold text-hub-text-primary leading-tight"
            >
              {displayName}
            </h1>
            <span
              className={`text-[11px] font-medium border rounded px-1.5 py-0.5 ${runtime.cls}`}
              aria-label={`Runtime ${runtime.label}`}
            >
              {runtime.label}
            </span>
            {ratingLabel !== null && (
              <span
                className="inline-flex items-center gap-1 text-xs text-amber-300"
                aria-label={`Rating ${ratingLabel}`}
              >
                <Star size={12} fill="currentColor" />
                {ratingLabel}
              </span>
            )}
          </div>

          {rentTarget.tagline && (
            <p className="mt-2 text-sm text-hub-text-secondary leading-relaxed max-w-2xl">
              {rentTarget.tagline}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-hub-text-tertiary">
            {agentId ? (
              <DidChip agentId={agentId} />
            ) : (
              <span className="font-mono text-hub-text-muted">@{profile.owner}</span>
            )}
            <span>Joined {new Date(profile.joined_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex-shrink-0 md:self-center">
          <button
            type="button"
            onClick={onRent}
            data-testid="rent-cta"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-hub-accent text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors shadow-[0_0_0_1px_rgba(16,185,129,0.2)]"
          >
            <Sparkles size={14} />
            {ctaLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Loading skeleton for the entire page. Matches the published layout so the
 * shell does not jump as the data fetches resolve.
 */
function ProfileSkeleton(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Link
        to="/agents"
        className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block"
      >
        ← Back to Agents
      </Link>
      <div
        className="bg-white/[0.06] animate-pulse rounded-xl h-32"
        aria-label="Loading agent profile"
      />
      <div className="bg-white/[0.06] animate-pulse rounded-xl h-48" aria-hidden="true" />
      <div className="bg-white/[0.06] animate-pulse rounded-xl h-32" aria-hidden="true" />
    </div>
  );
}

export default function ProfilePage(): JSX.Element {
  const { owner } = useParams<{ owner: string }>();
  const navigate = useNavigate();
  const { profileV2, loading, error } = useAgentProfile(owner ?? '');
  const [rentOpen, setRentOpen] = useState(false);

  // Build the RentableAgent shape from AgentProfileV2 — memoised so that
  // re-renders of the modal don't re-trigger evidence refetches.
  const rentTarget = useMemo(
    () => (profileV2 ? buildRentTarget(profileV2) : null),
    [profileV2],
  );
  const agentId = rentTarget?.agent_id;

  // Single source of truth for evidence — fetched once and passed down so we
  // don't issue three identical requests from Hero / Maturity / Outcomes.
  const {
    evidence,
    loading: evidenceLoading,
    error: evidenceError,
  } = useMaturityEvidence(agentId ?? null);

  // Side effects in render are illegal — push the redirect into an effect.
  useEffect(() => {
    if (!owner) void navigate('/agents');
  }, [owner, navigate]);

  if (loading && !profileV2) {
    return <ProfileSkeleton />;
  }

  if (error || !profileV2 || !rentTarget) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <Link
          to="/agents"
          className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block mb-4"
        >
          ← Back to Agents
        </Link>
        <p className="text-red-400 mt-4">{error ?? 'Agent not found'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-4">
        <Link
          to="/agents"
          className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block"
        >
          ← Back to Agents
        </Link>

        <Hero
          profile={profileV2}
          agentId={agentId}
          rentTarget={rentTarget}
          evidence={evidence}
          onRent={() => setRentOpen(true)}
        />

        <MaturityEvidenceSection
          evidence={evidence}
          loading={evidenceLoading}
          error={evidenceError}
        />

        <PastOutcomesSection evidence={evidence} loading={evidenceLoading} />

        <SkillTagsSection skills={profileV2.skills} />
      </div>

      <RentSessionModal
        agent={rentOpen ? rentTarget : null}
        onClose={() => setRentOpen(false)}
      />
    </>
  );
}
