/**
 * ProvenanceBanner — the Provenance overlay's canvas-level readout.
 *
 * The plan calls out provenance as "AgentBnB's moat vs any generic skill
 * viewer", so when the overlay is active we float a readable card near the
 * top-left of the canvas showing the five fields a conflict-debug workflow
 * needs: state, gitSha, version, installSource, loadedBy (with conflict
 * count). Per-node provenance is a v0.3 concern (it needs git blame), so
 * v0.1's provenance surface is the skill-level banner.
 */
import type { SkillMetadata, ProvenanceState } from '../../lib/skillsApi.js';

interface ProvenanceBannerProps {
  metadata: SkillMetadata;
}

const STATE_STYLES: Record<ProvenanceState, { label: string; className: string }> = {
  tracked: {
    label: 'Tracked',
    className: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50',
  },
  pinned: {
    label: 'Pinned',
    className: 'bg-sky-500/20 text-sky-200 border-sky-500/50',
  },
  untracked: {
    label: 'Untracked',
    className: 'bg-amber-500/20 text-amber-200 border-amber-500/50',
  },
};

function distinctAgents(loadedBy: readonly string[]): number {
  const set = new Set<string>();
  for (const entry of loadedBy) if (entry.startsWith('agent:')) set.add(entry);
  return set.size;
}

export default function ProvenanceBanner({ metadata }: ProvenanceBannerProps): JSX.Element {
  const state = STATE_STYLES[metadata.provenanceState];
  const agentCount = distinctAgents(metadata.loadedBy);

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-md rounded-xl border border-hub-border bg-hub-bg/95 p-4 text-xs shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-hub-text-muted">
            Provenance overlay
          </div>
          <div className="mt-0.5 text-sm font-semibold text-hub-text-primary">
            {metadata.name}
          </div>
        </div>
        <span
          className={[
            'shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            state.className,
          ].join(' ')}
        >
          {state.label}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5">
        <Field label="Path">
          <span className="font-mono text-[11px] text-hub-text-secondary break-all">{metadata.path}</span>
        </Field>
        <Field label="gitSha">
          {metadata.gitSha
            ? <span className="font-mono text-hub-text-primary">{metadata.gitSha}</span>
            : <span className="text-hub-text-muted">—</span>}
        </Field>
        <Field label="version">
          {metadata.version
            ? <span className="font-mono text-hub-text-primary">{metadata.version}</span>
            : <span className="text-hub-text-muted">—</span>}
        </Field>
        <Field label="installSource">
          {metadata.installSource
            ? <span className="font-mono text-hub-text-primary">{metadata.installSource}</span>
            : <span className="text-hub-text-muted">—</span>}
        </Field>
        <Field label="loadedBy">
          <span className="flex flex-wrap items-center gap-1 text-[11px]">
            {metadata.loadedBy.length === 0 && <span className="text-hub-text-muted">unowned</span>}
            {metadata.loadedBy.map((o) => (
              <span key={o} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-hub-text-secondary">
                {o}
              </span>
            ))}
            {agentCount > 1 && (
              <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-200">
                conflict ×{agentCount}
              </span>
            )}
          </span>
        </Field>
      </dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-hub-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
