/**
 * BaseNode — the one concrete React Flow node body shared by all seven
 * Skill node specializations.
 *
 * Each of the 7 per-type components in this directory is a thin wrapper that
 * fixes the colour accent and type label before delegating here. The shared
 * body handles Handle placement, overlay decoration, and selected-state
 * styling so individual type files stay under 20 lines.
 */
import { Handle, Position, type NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import type { RiskIssue } from '../../../lib/skillsApi.js';

export type OverlayMode = 'risk' | 'provenance' | 'none';

export interface BaseNodeRenderProps extends NodeProps<SkillFlowNodeData> {
  accent: string;
  typeLabel: string;
  icon: string;
  risks: readonly RiskIssue[];
  overlay: OverlayMode;
  provenanceState: 'tracked' | 'untracked' | 'pinned';
}

const SEVERITY_STYLES: Record<RiskIssue['severity'], string> = {
  misleading: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  complexity: 'bg-violet-500/20 text-violet-200 border-violet-500/40',
  dead: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
};

const PROVENANCE_BORDER: Record<'tracked' | 'untracked' | 'pinned', string> = {
  tracked: 'border-emerald-500/60',
  untracked: 'border-amber-500/50',
  pinned: 'border-sky-500/60',
};

export default function BaseNode({
  data,
  selected,
  accent,
  typeLabel,
  icon,
  risks,
  overlay,
  provenanceState,
}: BaseNodeRenderProps): JSX.Element {
  const { node } = data;

  // Summarise risks for the badge cluster — one count per severity.
  const severityCounts = risks.reduce<Record<RiskIssue['severity'], number>>(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1;
      return acc;
    },
    { misleading: 0, complexity: 0, dead: 0 },
  );

  const borderClass = overlay === 'provenance'
    ? PROVENANCE_BORDER[provenanceState]
    : selected
      ? 'border-hub-accent/70'
      : 'border-hub-border';

  return (
    <div
      className={[
        'rounded-xl border-2 bg-hub-surface/90 px-3 py-2 shadow-sm transition-colors',
        borderClass,
      ].join(' ')}
      style={{ borderLeftColor: accent, borderLeftWidth: '4px' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-hub-border" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>
          <span aria-hidden>{icon}</span>
          <span>{typeLabel}</span>
        </span>
        <span className="text-[9px] text-hub-text-muted">
          L{node.sourceRange.startLine + 1}–{node.sourceRange.endLine + 1}
        </span>
      </div>

      <div className="mt-1 line-clamp-2 text-sm font-medium text-hub-text-primary">
        {node.label || '(unlabeled)'}
      </div>

      {node.content && (
        <div className="mt-1 line-clamp-3 text-[11px] text-hub-text-secondary">
          {node.content}
        </div>
      )}

      {overlay === 'risk' && risks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label={`${risks.length} risk finding${risks.length === 1 ? '' : 's'}`}>
          {(Object.entries(severityCounts) as Array<[RiskIssue['severity'], number]>)
            .filter(([, n]) => n > 0)
            .map(([sev, n]) => (
              <span
                key={sev}
                className={[
                  'rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                  SEVERITY_STYLES[sev],
                ].join(' ')}
              >
                {sev} ×{n}
              </span>
            ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-hub-border" />
    </div>
  );
}
