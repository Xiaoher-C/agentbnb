/**
 * NodeDetailPanel — right-drawer for the selected flow node.
 *
 * Surfaces four read-only concerns the plan requires for v0.1:
 *   1. Node content + source-range reference
 *   2. Risk findings for this node, one card per (ruleId, nodeId) pair,
 *      each with a Dismiss action that writes to localStorage and never
 *      touches SKILL.md
 *   3. Skill-level provenance fields (repeated here because the panel may
 *      be open while the Provenance overlay is off)
 *   4. A "View source" toggle that fetches /api/skills/:skillId/raw on
 *      demand and renders the markdown around the node's source range
 */
import { useCallback, useEffect, useState } from 'react';
import type { RiskIssue, SkillGraph, SkillNode } from '../../lib/skillsApi.js';
import { fetchSkillRaw } from '../../lib/skillsApi.js';
import { dismiss, isDismissed, undismiss } from './dismiss.js';

interface NodeDetailPanelProps {
  graph: SkillGraph;
  selectedNode: SkillNode | null;
  risksForNode: readonly RiskIssue[];
  onDismissChange: () => void;
  onClose: () => void;
}

export default function NodeDetailPanel({
  graph,
  selectedNode,
  risksForNode,
  onDismissChange,
  onClose,
}: NodeDetailPanelProps): JSX.Element | null {
  if (!selectedNode) return null;

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-hub-border bg-hub-bg/95">
      <header className="flex items-start justify-between gap-3 border-b border-hub-border p-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-hub-text-muted">
            {selectedNode.type.replace('-', ' ')}
          </div>
          <h2 className="mt-0.5 truncate text-base font-semibold text-hub-text-primary">
            {selectedNode.label || '(unlabeled)'}
          </h2>
          <div className="mt-1 text-[11px] text-hub-text-muted">
            Lines {selectedNode.sourceRange.startLine + 1}–{selectedNode.sourceRange.endLine + 1}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-hub-text-muted hover:bg-hub-surface hover:text-hub-text-primary"
          aria-label="Close detail panel"
        >
          ×
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {selectedNode.content && (
          <Section title="Content">
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-hub-border bg-hub-surface p-3 text-[11px] text-hub-text-secondary">
              {selectedNode.content}
            </pre>
          </Section>
        )}

        <Section title={`Risk findings (${risksForNode.length})`}>
          {risksForNode.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hub-border bg-hub-surface/50 p-3 text-xs text-hub-text-muted">
              No risk rule fires on this node with the current overlay settings.
            </div>
          ) : (
            <ul className="space-y-2">
              {risksForNode.map((issue) => (
                <RiskCard
                  key={`${issue.ruleId}:${issue.nodeId}`}
                  skillId={graph.skillId}
                  issue={issue}
                  onDismissChange={onDismissChange}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Provenance">
          <ProvenanceFields graph={graph} />
        </Section>

        <Section title="Source">
          <ViewSourceToggle graph={graph} node={selectedNode} />
        </Section>
      </div>
    </aside>
  );
}

/* --- Risk card --------------------------------------------------------- */

const SEVERITY_CLASS: Record<RiskIssue['severity'], string> = {
  misleading: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  complexity: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  dead: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
};

function RiskCard({
  skillId,
  issue,
  onDismissChange,
}: {
  skillId: string;
  issue: RiskIssue;
  onDismissChange: () => void;
}): JSX.Element {
  const [dismissed, setDismissed] = useState<boolean>(() =>
    isDismissed(skillId, issue.ruleId, issue.nodeId),
  );

  const toggle = (): void => {
    if (dismissed) {
      undismiss(skillId, issue.ruleId, issue.nodeId);
      setDismissed(false);
    } else {
      dismiss(skillId, issue.ruleId, issue.nodeId);
      setDismissed(true);
    }
    onDismissChange();
  };

  return (
    <li
      className={[
        'rounded-lg border p-3 text-xs',
        SEVERITY_CLASS[issue.severity],
        dismissed ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {issue.severity} · {issue.ruleId}
        </span>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80 hover:bg-black/40"
        >
          {dismissed ? 'Undo' : 'Dismiss'}
        </button>
      </div>
      <div className="mt-1 text-[12px] text-white/90">{issue.message}</div>
      {issue.evidence && (
        <div className="mt-1 font-mono text-[10px] text-white/60">
          {issue.evidence}
        </div>
      )}
    </li>
  );
}

/* --- Provenance repeater ---------------------------------------------- */

function ProvenanceFields({ graph }: { graph: SkillGraph }): JSX.Element {
  const { metadata } = graph;
  return (
    <dl className="space-y-1 text-[11px]">
      <FieldRow label="state" value={metadata.provenanceState} />
      <FieldRow label="path" value={metadata.path} mono />
      <FieldRow label="gitSha" value={metadata.gitSha ?? '—'} mono />
      <FieldRow label="version" value={metadata.version ?? '—'} />
      <FieldRow label="installSource" value={metadata.installSource ?? '—'} />
      <FieldRow label="loadedBy" value={metadata.loadedBy.join(', ') || 'unowned'} />
    </dl>
  );
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-hub-text-muted">{label}</dt>
      <dd className={['min-w-0 flex-1 break-words text-hub-text-secondary', mono ? 'font-mono' : ''].join(' ')}>
        {value}
      </dd>
    </div>
  );
}

/* --- View source (lazy-loaded raw markdown) --------------------------- */

function ViewSourceToggle({ graph, node }: { graph: SkillGraph; node: SkillNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const text = await fetchSkillRaw(graph.skillId);
      setRaw(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source.');
    } finally {
      setLoading(false);
    }
  }, [graph.skillId]);

  useEffect(() => {
    if (open && raw === null && !loading) {
      void load();
    }
  }, [open, raw, loading, load]);

  // Reset cached source when skill changes
  useEffect(() => {
    setRaw(null);
    setOpen(false);
  }, [graph.skillId]);

  const snippet = raw !== null ? sliceSource(raw, node.sourceRange.startLine, node.sourceRange.endLine) : '';

  return (
    <div>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); }}
        className="rounded border border-hub-border bg-hub-surface px-2 py-1 text-[11px] text-hub-text-secondary hover:text-hub-text-primary"
      >
        {open ? 'Hide source' : 'View source'}
      </button>
      {open && (
        <div className="mt-2">
          {loading && <div className="text-[11px] text-hub-text-muted">Loading…</div>}
          {error && <div className="text-[11px] text-rose-300">{error}</div>}
          {!loading && !error && raw !== null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-hub-border bg-black/40 p-3 font-mono text-[10px] text-hub-text-secondary">
              {snippet}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function sliceSource(source: string, startLine: number, endLine: number): string {
  const lines = source.split(/\r?\n/);
  const clampedStart = Math.max(0, startLine);
  const clampedEnd = Math.min(lines.length - 1, endLine);
  return lines.slice(clampedStart, clampedEnd + 1).join('\n');
}

/* --- Section wrapper -------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-hub-text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}
