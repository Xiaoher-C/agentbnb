/**
 * SkillCard — one row in the left-panel list.
 *
 * Dogfood acceptance (per the Plan verification gate) requires every card to
 * surface FOUR data points at a glance, no drilling into the flow required:
 *
 *   1. Absolute load path (full path, not abbreviated — required by the
 *      AGENTBNB_DIR anomaly debugging workflow).
 *   2. Owner agent identity (or "unowned" when loadedBy is empty).
 *   3. Provenance state pill (tracked / untracked / pinned) — colour-coded.
 *   4. Cross-agent conflict badge when loadedBy contains > 1 distinct agent
 *      identity (same canonical SKILL.md loaded by multiple agents).
 *
 * Keep the card dense but scannable — the AGENTBNB_DIR anomaly is supposed
 * to pop out of the list view without a click.
 */
import type { ListedSkill, ProvenanceState } from '../../lib/skillsApi.js';

interface SkillCardProps {
  skill: ListedSkill;
  selected: boolean;
  onSelect: () => void;
}

/** Visual styling per provenance state — tracked is the "healthy" steady state. */
const PROVENANCE_STYLES: Record<ProvenanceState, { label: string; className: string }> = {
  tracked: {
    label: 'tracked',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  pinned: {
    label: 'pinned',
    className: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  untracked: {
    label: 'untracked',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  registered: {
    label: 'registered',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/30 border-dashed',
  },
};

/** Count distinct *agent* identities (not source kinds) for the conflict badge. */
function distinctAgentCount(loadedBy: readonly string[]): number {
  const set = new Set<string>();
  for (const entry of loadedBy) {
    if (entry.startsWith('agent:')) set.add(entry);
  }
  return set.size;
}

export default function SkillCard({ skill, selected, onSelect }: SkillCardProps): JSX.Element {
  const prov = PROVENANCE_STYLES[skill.provenanceState];
  const agentCount = distinctAgentCount(skill.loadedBy);
  const hasConflict = agentCount > 1;

  const ownerLabel = skill.loadedBy.length === 0
    ? 'unowned'
    : skill.loadedBy.join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left rounded-lg border px-4 py-3 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-hub-accent/50',
        selected
          ? 'border-hub-accent/50 bg-hub-surface-hover'
          : 'border-hub-border bg-hub-surface hover:bg-hub-surface-hover hover:border-hub-border-hover',
      ].join(' ')}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-hub-text-primary">
            {skill.name}
          </div>
          {skill.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-hub-text-secondary">
              {skill.description}
            </div>
          )}
        </div>
        <span
          className={[
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            prov.className,
          ].join(' ')}
          title={`Provenance: ${prov.label}`}
        >
          {prov.label}
        </span>
      </div>

      <div className="mt-2 space-y-1 text-[11px] text-hub-text-tertiary">
        {/* (1) Absolute load path — full, unabbreviated. This is the dogfood-critical signal. */}
        <div className="font-mono text-[10px] break-all text-hub-text-muted">
          {skill.path}
        </div>

        {/* (2) Owner agent identity */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-hub-text-muted">owner:</span>
          <span className="font-mono text-hub-text-secondary">{ownerLabel}</span>

          {/* (4) Cross-agent conflict badge */}
          {hasConflict && (
            <span
              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-200"
              title={`Loaded by ${agentCount} distinct agents — potential drift risk`}
            >
              conflict ×{agentCount}
            </span>
          )}

          {/* Secondary signal: gitSha / installSource when present */}
          {skill.gitSha && (
            <span
              className="font-mono text-hub-text-muted"
              title={`gitSha: ${skill.gitSha}`}
            >
              @{skill.gitSha.slice(0, 7)}
            </span>
          )}
          {skill.installSource && (
            <span className="rounded-md bg-white/5 px-1 py-0.5 text-[9px] text-hub-text-secondary">
              {skill.installSource}
            </span>
          )}
          {skill.version && (
            <span className="text-hub-text-muted">v{skill.version}</span>
          )}
        </div>
        {skill.provenanceState === 'registered' && (
          <div className="text-[10px] italic text-hub-text-muted">
            Command skill — no SKILL.md to inspect
          </div>
        )}
      </div>
    </button>
  );
}
