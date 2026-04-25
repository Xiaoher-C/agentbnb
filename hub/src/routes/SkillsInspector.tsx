/**
 * Skill Inspector v0.1 — internal dev route.
 *
 * Top-level page mounted at /#/skills-inspector. Coordinates three panels:
 *   - Left: SkillList (search + dogfood-critical SkillCards)
 *   - Center: FlowCanvas (React Flow with Risk / Provenance overlays)
 *   - Right: NodeDetailPanel (open when a node is selected)
 *
 * This page intentionally lives under hub/src/routes/ rather than
 * hub/src/pages/ — the plan's UI freeze carve-out isolates the inspector's
 * new files outside the page-level surface area that v1 froze.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSkills,
  fetchSkillInspection,
  type ListedSkill,
  type RiskReport,
  type SkillGraph,
} from '../lib/skillsApi.js';
import SkillList from '../components/skills-inspector/SkillList.js';
import FlowCanvas from '../components/skills-inspector/FlowCanvas.js';
import NodeDetailPanel from '../components/skills-inspector/NodeDetailPanel.js';
import OverlayToggle from '../components/skills-inspector/OverlayToggle.js';
import type { OverlayMode } from '../components/skills-inspector/nodes/BaseNode.js';
import { listDismissedForSkill } from '../components/skills-inspector/dismiss.js';

export default function SkillsInspectorRoute(): JSX.Element {
  const [skills, setSkills] = useState<ListedSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [risks, setRisks] = useState<RiskReport | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  const [overlay, setOverlay] = useState<OverlayMode>('risk');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Bump this to force dismissed-keys recomputation after a dismiss/undismiss.
  const [dismissEpoch, setDismissEpoch] = useState(0);
  const onDismissChange = useCallback(() => { setDismissEpoch((n) => n + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    fetchSkills()
      .then((items) => {
        if (cancelled) return;
        setSkills(items);
        setSkillsLoading(false);
        if (!selectedSkillId && items.length > 0) {
          setSelectedSkillId(items[0].skillId);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSkillsError(err instanceof Error ? err.message : 'Failed to load skills.');
        setSkillsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedSkillId]);

  useEffect(() => {
    if (!selectedSkillId) return;
    let cancelled = false;
    setInspectionLoading(true);
    setInspectionError(null);
    setSelectedNodeId(null);
    fetchSkillInspection(selectedSkillId)
      .then(({ graph: g, risks: r }) => {
        if (cancelled) return;
        setGraph(g);
        setRisks(r);
        setInspectionLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInspectionError(err instanceof Error ? err.message : 'Inspection failed.');
        setInspectionLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedSkillId]);

  const dismissedKeys = useMemo(() => {
    if (!selectedSkillId) return new Set<string>();
    // listDismissedForSkill returns full composed keys skillId:ruleId:nodeId;
    // we strip the skillId prefix so FlowCanvas can match on ruleId:nodeId.
    const prefix = `${selectedSkillId}:`;
    const raw = listDismissedForSkill(selectedSkillId);
    const set = new Set<string>();
    for (const key of raw) {
      set.add(key.startsWith(prefix) ? key.slice(prefix.length) : key);
    }
    return set;
    // dismissEpoch is a tripwire dependency to force recomputation after a toggle.
  }, [selectedSkillId, dismissEpoch]);

  const selectedNode = useMemo(() => {
    if (!graph || !selectedNodeId) return null;
    return graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [graph, selectedNodeId]);

  const risksForSelectedNode = useMemo(() => {
    if (!risks || !selectedNodeId) return [];
    return risks.issues.filter((i) => i.nodeId === selectedNodeId);
  }, [risks, selectedNodeId]);

  const selectedSkill = useMemo(
    () => skills.find((s) => s.skillId === selectedSkillId) ?? null,
    [skills, selectedSkillId],
  );

  return (
    <div className="-mx-4 flex h-[calc(100vh-12rem)] min-h-[600px] animate-hub-fade-up overflow-hidden border-y border-hub-border-hairline">
      {/* Left panel — skill list (sunken back-panel) */}
      <div className="w-[340px] shrink-0 animate-hub-slide-in-left border-r border-hub-border-hairline bg-hub-surface-sunken">
        <SkillList
          skills={skills}
          selectedSkillId={selectedSkillId}
          onSelect={(s) => { setSelectedSkillId(s.skillId); }}
          loading={skillsLoading}
          error={skillsError}
        />
      </div>

      {/* Center — canvas (base tier) */}
      <div className="relative flex min-w-0 flex-1 flex-col bg-hub-surface-0">
        <header className="flex items-center justify-between gap-4 border-b border-hub-border-default bg-hub-surface-0/95 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-hub-text-primary">
              {selectedSkill ? selectedSkill.name : 'Skill Inspector'}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-hub-text-secondary">
              {selectedSkill?.description || 'Read-only SKILL.md x-ray — select a skill to inspect.'}
            </p>
          </div>
          <OverlayToggle value={overlay} onChange={setOverlay} />
        </header>

        <div className="relative min-h-0 flex-1">
          {inspectionLoading && (
            <CanvasNotice>Parsing SKILL.md…</CanvasNotice>
          )}
          {inspectionError && (
            <CanvasNotice tone="error">{inspectionError}</CanvasNotice>
          )}
          {!inspectionLoading && !inspectionError && graph && risks && (
            <FlowCanvas
              graph={graph}
              risks={risks}
              overlay={overlay}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              dismissedKeys={dismissedKeys}
            />
          )}
          {!inspectionLoading && !graph && !inspectionError && (
            <CanvasNotice>Select a skill from the list to render its flow.</CanvasNotice>
          )}
        </div>
      </div>

      {/* Right panel — node detail (open on selection) */}
      {graph && selectedNode && (
        <NodeDetailPanel
          graph={graph}
          selectedNode={selectedNode}
          risksForNode={risksForSelectedNode}
          onDismissChange={onDismissChange}
          onClose={() => { setSelectedNodeId(null); }}
        />
      )}
    </div>
  );
}

function CanvasNotice({ children, tone }: { children: React.ReactNode; tone?: 'error' }): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div
        className={[
          'rounded-xl border px-6 py-5 text-sm',
          tone === 'error'
            ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            : 'border-hub-border bg-hub-surface text-hub-text-secondary',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
