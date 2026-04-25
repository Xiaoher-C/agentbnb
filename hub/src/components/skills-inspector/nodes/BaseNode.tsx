/**
 * BaseNode — the one concrete React Flow node body shared by every Skill
 * node variant.
 *
 * Visual spec v0.1.3 — Node Type Visual Differentiation:
 *   - Header band  : bg = accent @ 15%, icon + uppercase type label @ 100%
 *   - Body         : neutral dark surface, title (white) + content (light grey)
 *   - Footer       : provenance dot + line range + risk dot when applicable
 *   - State        : default → border @ 40% / hover → 70% / selected → 100% + glow
 *   - Dimmed       : any sibling node is selected → 50% opacity
 *
 * Variants pass an `accent` + `icon` + `label` + optional `subTypeChip`.
 * Risk severity breakdown still lives in NodeDetailPanel; the node surface
 * only flags "has risks" with a single amber dot.
 */
import { useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import type { SkillFlowNodeData } from '../layout.js';
import type { ProvenanceState, RiskIssue } from '../../../lib/skillsApi.js';

export type OverlayMode = 'risk' | 'provenance' | 'none';

export interface BaseNodeRenderProps extends NodeProps<SkillFlowNodeData> {
  accent: string;
  typeLabel: string;
  icon: LucideIcon;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  subTypeChip?: string;
  risks: readonly RiskIssue[];
  overlay: OverlayMode;
  provenanceState: ProvenanceState;
  isAnySelected: boolean;
}

const PROVENANCE_DOT: Record<ProvenanceState, string> = {
  tracked: '#10B981',
  pinned: '#3B82F6',
  untracked: '#F59E0B',
  registered: '#64748B',
};

export default function BaseNode({
  data,
  selected,
  accent,
  typeLabel,
  icon: Icon,
  borderStyle,
  subTypeChip,
  risks,
  overlay,
  provenanceState,
  isAnySelected,
}: BaseNodeRenderProps): JSX.Element {
  const { node } = data;
  const [hover, setHover] = useState(false);
  const hasRisk = risks.length > 0;
  const dimmed = isAnySelected && !selected;

  // Border opacity: default 40%, hover 70%, selected 100%.
  const borderOpacity = selected ? 'ff' : hover ? 'b3' : '66';
  const borderColor = `${accent}${borderOpacity}`;

  // Selected nodes get a small "punched in" scale on top of the glow so the
  // focus moment reads through the canvas's noise. Hover lifts -1px with a
  // softer shadow; both transforms are combined via a single `transform`.
  const transform = selected
    ? 'scale(1.015)'
    : hover
      ? 'translateY(-1px)'
      : 'translateY(0)';

  const cardStyle: React.CSSProperties = {
    width: 280,
    borderStyle,
    borderWidth: 2,
    borderColor,
    opacity: dimmed ? 0.5 : 1,
    cursor: 'pointer',
    transformOrigin: 'center',
    transition:
      'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 160ms, box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    transform,
    boxShadow: selected
      ? `0 0 0 2px ${accent}, 0 0 24px ${accent}55, 0 8px 32px rgba(0,0,0,0.35)`
      : hover
        ? '0 4px 16px rgba(0,0,0,0.35)'
        : undefined,
  };

  const headerBg = `${accent}26`; // ~15% opacity
  const chipBg = `${accent}1A`; // ~10% opacity

  return (
    <div
      className="animate-hub-fade-up rounded-lg bg-[#1F2937]"
      style={cardStyle}
      data-node-type={node.type}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />

      {/* Header band */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ background: headerBg, borderTopLeftRadius: 6, borderTopRightRadius: 6 }}
      >
        <Icon size={14} style={{ color: accent }} aria-hidden="true" />
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: accent }}
        >
          {typeLabel}
        </span>
        {subTypeChip && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ background: chipBg, color: accent }}
          >
            {subTypeChip}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div className="line-clamp-2 text-sm font-medium text-[#F9FAFB]">
          {node.label || '(unlabeled)'}
        </div>
        {node.content && (
          <div className="mt-1 line-clamp-3 text-[13px] leading-snug text-[#D1D5DB]">
            {node.content}
          </div>
        )}
      </div>

      {/* Footer metadata */}
      <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-1.5 text-[11px] text-[#9CA3AF]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: PROVENANCE_DOT[provenanceState] }}
          aria-hidden="true"
        />
        <span className="capitalize">{provenanceState}</span>
        <span className="font-mono text-[#6B7280]">
          L{node.sourceRange.startLine + 1}–{node.sourceRange.endLine + 1}
        </span>
        {hasRisk && (
          <span
            className="ml-auto inline-flex items-center gap-1 text-amber-400"
            title={`${risks.length} risk finding${risks.length === 1 ? '' : 's'}${overlay === 'risk' ? '' : ' — switch to Risk overlay for detail'}`}
          >
            <AlertTriangle size={12} aria-hidden="true" />
            {overlay === 'risk' && <span className="font-mono">×{risks.length}</span>}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}
