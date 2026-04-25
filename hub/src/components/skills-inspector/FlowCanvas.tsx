/**
 * FlowCanvas — React Flow surface with toggleable Risk / Provenance overlays.
 *
 * The canvas itself is read-only in v0.1: pan, zoom, select. Editing drag is
 * disabled because the node layout comes from the source order (see
 * layout.ts) and user-moved nodes would desync from SKILL.md structure.
 * Clicking a node raises onNodeSelect so the right-hand NodeDetailPanel can
 * render its detail + risks + dismiss controls.
 *
 * v0.1.3 — edges inherit the source node's type colour @ 40% opacity so the
 * flow reads continuously across the now-per-type-coloured cards. Reference
 * edges stay dashed grey (they cross the grain of flow).
 */
import { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { SkillGraph, RiskReport, NodeType } from '../../lib/skillsApi.js';
import { InspectorContext, type InspectorContextValue } from './InspectorContext.js';
import { nodeTypes } from './nodeTypes.js';
import { layoutGraph } from './layout.js';
import type { OverlayMode } from './nodes/BaseNode.js';
import { NODE_TYPE_CONFIG, configFor } from './nodeTypeConfig.js';
import ProvenanceBanner from './ProvenanceBanner.js';

interface FlowCanvasProps {
  graph: SkillGraph;
  risks: RiskReport;
  overlay: OverlayMode;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  dismissedKeys: ReadonlySet<string>;
}

export default function FlowCanvas({
  graph,
  risks,
  overlay,
  selectedNodeId,
  onNodeSelect,
  dismissedKeys,
}: FlowCanvasProps): JSX.Element {
  const { nodes, edges } = useMemo(() => layoutGraph(graph), [graph]);

  // Build a per-node risk lookup, filtering out dismissed findings.
  const risksByNode = useMemo(() => {
    const map = new Map<string, RiskIssueArray>();
    for (const issue of risks.issues) {
      const key = `${issue.ruleId}:${issue.nodeId}`;
      if (dismissedKeys.has(key)) continue;
      const current = map.get(issue.nodeId);
      if (current) current.push(issue);
      else map.set(issue.nodeId, [issue]);
    }
    return map;
  }, [risks.issues, dismissedKeys]);

  // Mark selected node for React Flow styling.
  const rfNodes: RFNode[] = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  // Edges inherit the source node's type colour (@ 40%) so flow reads as one
  // continuous path. Reference edges override to grey-dashed — they cross the
  // grain of the source order and shouldn't fight for visual attention.
  const rfEdges: RFEdge[] = useMemo(() => {
    const typeById = new Map<string, NodeType>();
    for (const node of nodes) {
      if (node.type) typeById.set(node.id, node.type as NodeType);
    }
    return edges.map((edge) => {
      const sourceType = typeById.get(edge.source);
      const color = sourceType ? configFor(sourceType).color : '#6B7280';
      const isReference = edge.data?.kind === 'reference';
      const stroke = isReference ? '#6B7280' : `${color}66`;
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke,
          strokeWidth: 1.5,
          strokeDasharray: isReference ? '5 5' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 12,
          height: 12,
        },
      };
    });
  }, [edges, nodes]);

  const contextValue: InspectorContextValue = useMemo(
    () => ({
      overlay,
      provenanceState: graph.metadata.provenanceState,
      risksByNode,
      onNodeSelect,
      selectedNodeId,
    }),
    [overlay, graph.metadata.provenanceState, risksByNode, onNodeSelect, selectedNodeId],
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onNodeSelect(node.id === selectedNodeId ? null : node.id);
  };

  const handlePaneClick = (): void => {
    onNodeSelect(null);
  };

  return (
    <div className="relative h-full w-full">
      <InspectorContext.Provider value={contextValue}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(255,255,255,0.04)" />
          <Controls position="bottom-right" showInteractive={false} className="!bg-hub-surface !border-hub-border" />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            nodeColor={(n) => nodeMiniColor(n.type)}
            maskColor="rgba(8,8,12,0.7)"
            className="!bg-hub-surface/90 !border-hub-border"
          />
        </ReactFlow>
        {overlay === 'provenance' && <ProvenanceBanner metadata={graph.metadata} />}
      </InspectorContext.Provider>
    </div>
  );
}

type RiskIssueArray = RiskReport['issues'];

/** MiniMap pulls colour from the same config — one source of truth. */
function nodeMiniColor(type: string | undefined): string {
  if (!type) return '#64748B';
  return (
    (NODE_TYPE_CONFIG as Record<string, { color: string } | undefined>)[type]
      ?.color ?? '#64748B'
  );
}
