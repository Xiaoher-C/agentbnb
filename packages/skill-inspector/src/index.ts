export const SKILL_INSPECTOR_VERSION = '0.1.0-alpha';

export { parseSkill, extractFrontmatter } from './parser.js';
export type {
  ParseSkillOptions,
  Frontmatter,
  FrontmatterExtraction,
} from './parser.js';

export { extractNodes } from './nodes.js';

export { scoreRisks, listRules } from './risk-heuristics.js';
export type {
  RiskRule,
  RiskRuleDescriptor,
  ScoreRisksOptions,
} from './risk-heuristics.js';

export { lookupProvenance, applyProvenance } from './provenance.js';
export type { ProvenanceLookupResult } from './provenance.js';

export type {
  NodeType,
  ProvenanceState,
  RiskSeverity,
  SourceRange,
  SkillMetadata,
  SkillNode,
  SkillEdge,
  SkillEdgeKind,
  SkillGraph,
  RiskIssue,
  RiskReport,
  HintValue,
} from './types.js';
