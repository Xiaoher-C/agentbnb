/**
 * Skill Inspector API client for the Hub UI.
 *
 * Talks to the registry endpoints registered by src/registry/skill-routes.ts
 * via the vite `/api` proxy. Requests are signed with DID headers when a Hub
 * session exists (matches the other Hub API callers) but the skill endpoints
 * themselves are public read-only in v0.1, so unauthenticated dev will still
 * succeed.
 */
import { authedFetch } from './authHeaders.js';

/** Provenance state reported by the Layer 1 lookup. */
export type ProvenanceState = 'tracked' | 'untracked' | 'pinned';

/** Severity classes mapped directly from the RiskReport DSL. */
export type RiskSeverity = 'misleading' | 'complexity' | 'dead';

/** Node types emitted by the Layer 1 parser. */
export type NodeType =
  | 'trigger'
  | 'decision'
  | 'instruction'
  | 'tool-call'
  | 'example'
  | 'reference'
  | 'output-shape';

export type SkillEdgeKind =
  | 'order'
  | 'reference'
  | 'trigger-to-instruction'
  | 'example-of';

export interface SourceRange {
  startLine: number;
  endLine: number;
}

export interface SkillNode {
  id: string;
  type: NodeType;
  label: string;
  content: string;
  sourceRange: SourceRange;
  hints?: Record<string, string | number | boolean | string[]>;
}

export interface SkillEdge {
  from: string;
  to: string;
  kind: SkillEdgeKind;
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

export interface ListedSkill {
  skillId: string;
  name: string;
  description: string;
  path: string;
  source: 'skill_md';
  provenanceState: ProvenanceState;
  gitSha?: string;
  version?: string;
  installSource?: string;
  loadedBy: string[];
}

export interface RiskRuleDescriptor {
  id: string;
  severity: RiskSeverity;
  description: string;
  defaultEnabled: boolean;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await authedFetch(path);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}

export async function fetchSkills(): Promise<ListedSkill[]> {
  const data = await getJson<{ items: ListedSkill[]; total: number }>('/api/skills');
  return data.items;
}

export async function fetchRiskRules(): Promise<RiskRuleDescriptor[]> {
  const data = await getJson<{ rules: RiskRuleDescriptor[] }>('/api/skills/rules');
  return data.rules;
}

/**
 * Inspect a skill and receive its graph + risk report.
 *
 * When `enabledRules` is provided it is serialized as `?rules=a,!b` — entries
 * with value `true` enable the rule, `false` disables it. Unset rules fall
 * back to the server-side default-enabled state.
 */
export async function fetchSkillInspection(
  skillId: string,
  enabledRules?: Readonly<Record<string, boolean>>,
): Promise<{ graph: SkillGraph; risks: RiskReport }> {
  let query = '';
  if (enabledRules && Object.keys(enabledRules).length > 0) {
    const tokens = Object.entries(enabledRules).map(([id, on]) => (on ? id : `!${id}`));
    query = `?rules=${encodeURIComponent(tokens.join(','))}`;
  }
  return getJson<{ graph: SkillGraph; risks: RiskReport }>(`/api/skills/${skillId}/inspect${query}`);
}

export async function fetchSkillRaw(skillId: string): Promise<string> {
  const res = await authedFetch(`/api/skills/${skillId}/raw`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.text();
}
