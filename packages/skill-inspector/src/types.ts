export type NodeType =
  | 'trigger'
  | 'decision'
  | 'instruction'
  | 'tool-call'
  | 'example'
  | 'reference'
  | 'output-shape';

export type ProvenanceState = 'tracked' | 'untracked' | 'pinned';

export type RiskSeverity = 'misleading' | 'complexity' | 'dead';

export interface SourceRange {
  startLine: number;
  endLine: number;
}

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  source: 'soul_md' | 'skill_md';
  provenanceState: ProvenanceState;
  gitSha?: string;
  version?: string;
  installSource?: string;
  loadedBy: string[];
}

export type HintValue = string | number | boolean | string[];

export interface SkillNode {
  id: string;
  type: NodeType;
  label: string;
  content: string;
  sourceRange: SourceRange;
  hints?: Record<string, HintValue>;
}

export type SkillEdgeKind =
  | 'order'
  | 'reference'
  | 'trigger-to-instruction'
  | 'example-of';

export interface SkillEdge {
  from: string;
  to: string;
  kind: SkillEdgeKind;
}

export interface SkillGraph {
  skillId: string;
  metadata: SkillMetadata;
  nodes: SkillNode[];
  edges: SkillEdge[];
}

export interface RiskIssue {
  ruleId: string;
  nodeId: string;
  severity: RiskSeverity;
  message: string;
  evidence?: string;
}

export interface RiskReport {
  skillId: string;
  issues: RiskIssue[];
}
