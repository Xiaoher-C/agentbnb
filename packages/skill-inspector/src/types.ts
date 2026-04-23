export type NodeType =
  | 'trigger'
  | 'decision'
  | 'instruction'
  | 'tool-call'
  | 'example'
  | 'reference'
  | 'output-shape';

export type ProvenanceState = 'tracked' | 'untracked' | 'pinned' | 'registered';

export type RiskSeverity = 'misleading' | 'complexity' | 'dead';

export interface SourceRange {
  startLine: number;
  endLine: number;
}

export type SkillSource = 'skill_md' | 'soul_md' | 'skills_yaml';

export type InstallSource =
  | 'pnpm-workspace'
  | 'manual-copy'
  | 'openclaw-import'
  | 'agentbnb-skill'
  | 'node_modules'
  | 'agentbnb-data-dir'
  | 'openclaw-agent-dir';

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  provenanceState: ProvenanceState;
  gitSha?: string;
  version?: string;
  installSource?: InstallSource;
  loadedBy: string[];
}

/** Parsed entry from a skills.yaml registry file. */
export interface SkillsYamlEntry {
  id: string;
  name: string;
  type: 'command' | 'api' | 'conductor' | 'skill-md';
  command?: string;
  endpoint?: string;
  description?: string;
  version?: string;
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
