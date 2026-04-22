/**
 * Deterministic vertical layout for Skill Inspector nodes.
 *
 * React Flow does not auto-layout by default. Pulling in a full graph-layout
 * dep (dagre, elk) is overkill for v0.1 — the SKILL.md structure is already a
 * linear document, so we lay nodes out in source-line order on a vertical
 * axis with type-driven horizontal offsets. This keeps the canvas reading
 * top-to-bottom the way the source file does, which matches how the author
 * wrote it. v0.3 can swap in a real graph layout when flow becomes source.
 */
import type { Node as RFNode, Edge as RFEdge } from 'reactflow';
import type { SkillGraph, SkillNode, NodeType } from '../../lib/skillsApi.js';

export interface LayoutConfig {
  columnX: Readonly<Record<NodeType, number>>;
  rowHeight: number;
  nodeWidth: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
  columnX: {
    trigger: 0,
    decision: 120,
    instruction: 320,
    'output-shape': 320,
    'tool-call': 620,
    example: 880,
    reference: 880,
  },
  rowHeight: 140,
  nodeWidth: 260,
};

export function layoutGraph(graph: SkillGraph, config: LayoutConfig = DEFAULT_CONFIG): {
  nodes: RFNode[];
  edges: RFEdge[];
} {
  const sorted = [...graph.nodes].sort((a, b) => {
    if (a.sourceRange.startLine !== b.sourceRange.startLine) {
      return a.sourceRange.startLine - b.sourceRange.startLine;
    }
    return a.id.localeCompare(b.id);
  });

  const nodes: RFNode[] = sorted.map((node, index) => ({
    id: node.id,
    type: node.type,
    position: { x: config.columnX[node.type], y: index * config.rowHeight },
    data: { node } satisfies SkillFlowNodeData,
    style: { width: config.nodeWidth },
  }));

  const edges: RFEdge[] = graph.edges.map((edge, i) => ({
    id: `${edge.from}-${edge.to}-${i}`,
    source: edge.from,
    target: edge.to,
    type: 'default',
    data: { kind: edge.kind },
    animated: edge.kind === 'trigger-to-instruction',
  }));

  return { nodes, edges };
}

/** Payload attached to every React Flow node — the parser's SkillNode. */
export interface SkillFlowNodeData {
  node: SkillNode;
}
