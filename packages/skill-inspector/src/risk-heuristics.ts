import type {
  SkillGraph,
  RiskIssue,
  RiskReport,
  RiskSeverity,
} from './types.js';

export interface RiskRule {
  id: string;
  severity: RiskSeverity;
  description: string;
  defaultEnabled: boolean;
  apply(graph: SkillGraph): RiskIssue[];
}

export interface RiskRuleDescriptor {
  id: string;
  severity: RiskSeverity;
  description: string;
  defaultEnabled: boolean;
}

const COMPLEXITY_LONG_SECTION_THRESHOLD = 500;

const complexityLongSection: RiskRule = {
  id: 'complexity.long-section',
  severity: 'complexity',
  description: `Section spans more than ${COMPLEXITY_LONG_SECTION_THRESHOLD} lines — consider splitting.`,
  defaultEnabled: true,
  apply(graph) {
    const issues: RiskIssue[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'instruction' && node.type !== 'output-shape') continue;
      const lines = node.sourceRange.endLine - node.sourceRange.startLine + 1;
      if (lines > COMPLEXITY_LONG_SECTION_THRESHOLD) {
        issues.push({
          ruleId: complexityLongSection.id,
          nodeId: node.id,
          severity: 'complexity',
          message: `Section "${node.label}" is ${lines} lines long — consider splitting.`,
          evidence: `Lines ${node.sourceRange.startLine}-${node.sourceRange.endLine}`,
        });
      }
    }
    return issues;
  },
};

const complexityDeepNesting: RiskRule = {
  id: 'complexity.deep-nesting',
  severity: 'complexity',
  description:
    'List nesting depth greater than 5 — requires deeper AST inspection, deferred until v0.2.',
  defaultEnabled: false,
  apply() {
    return [];
  },
};

const deadTool: RiskRule = {
  id: 'dead.tool',
  severity: 'dead',
  description:
    'Tool-call references an MCP tool whose underlying service is never mentioned in any Instruction / OutputShape section.',
  defaultEnabled: true,
  apply(graph) {
    const issues: RiskIssue[] = [];
    const narrative = collectNarrativeText(graph).toLowerCase();
    for (const node of graph.nodes) {
      if (node.type !== 'tool-call') continue;
      const detections = node.hints?.['detections'];
      if (!Array.isArray(detections)) continue;
      const unexplained = detections.filter((raw): raw is string => {
        if (typeof raw !== 'string') return false;
        if (!raw.toLowerCase().startsWith('mcp__')) return false;
        const parts = raw.replace(/^mcp__/i, '').split('__');
        const namespace = (parts[0] ?? '').toLowerCase();
        if (!namespace) return false;
        return !narrative.includes(namespace);
      });
      if (unexplained.length > 0) {
        issues.push({
          ruleId: deadTool.id,
          nodeId: node.id,
          severity: 'dead',
          message: `Tool call references ${unexplained.join(
            ', ',
          )} but the skill body never mentions the underlying service.`,
          evidence: unexplained.join(', '),
        });
      }
    }
    return issues;
  },
};

const deadSection: RiskRule = {
  id: 'dead.section',
  severity: 'dead',
  description:
    'Section has zero non-trigger incoming edges and zero outgoing edges — may be dead weight. Opt-in only: most SKILL.md files use implicit top-to-bottom flow rather than explicit cross-section references, so this fires on ~20% of nodes in real Anthropic-format skills. Re-evaluate once a v0.2 edge-inference pass can model implicit document flow.',
  defaultEnabled: false,
  apply(graph) {
    const issues: RiskIssue[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'instruction' && node.type !== 'output-shape') continue;
      const hasIncoming = graph.edges.some(
        (e) => e.to === node.id && e.kind !== 'trigger-to-instruction',
      );
      const hasOutgoing = graph.edges.some((e) => e.from === node.id);
      if (!hasIncoming && !hasOutgoing) {
        issues.push({
          ruleId: deadSection.id,
          nodeId: node.id,
          severity: 'dead',
          message: `Section "${node.label}" has no references in or out — may be dead weight.`,
        });
      }
    }
    return issues;
  },
};

const MODAL_VERB_PATTERN = /\b(may|might|could|should)\b/i;

const misleadingModalVerbs: RiskRule = {
  id: 'misleading.modal-verbs',
  severity: 'misleading',
  description:
    'Ambiguous modal verbs (may/might/could/should). Known noisy against real Anthropic-format skills; opt-in only until v0.2 LLM passes can classify intent.',
  defaultEnabled: false,
  apply(graph) {
    const issues: RiskIssue[] = [];
    for (const node of graph.nodes) {
      if (node.type === 'reference' || node.type === 'example') continue;
      if (!node.content) continue;
      const match = MODAL_VERB_PATTERN.exec(node.content);
      if (match) {
        issues.push({
          ruleId: misleadingModalVerbs.id,
          nodeId: node.id,
          severity: 'misleading',
          message: `Found ambiguous modal verb "${match[0]}" — consider replacing with an imperative directive.`,
          evidence: match[0],
        });
      }
    }
    return issues;
  },
};

const misleadingContradiction: RiskRule = {
  id: 'misleading.contradiction',
  severity: 'misleading',
  description:
    'Imperative pairs that disagree across sections. Requires structural NLP; deferred until v0.2 LLM passes.',
  defaultEnabled: false,
  apply() {
    return [];
  },
};

const ALL_RULES: readonly RiskRule[] = Object.freeze([
  complexityLongSection,
  complexityDeepNesting,
  deadTool,
  deadSection,
  misleadingModalVerbs,
  misleadingContradiction,
]);

export interface ScoreRisksOptions {
  /** Override rule-enabled state; keys are rule ids. Unset keys fall back to each rule's defaultEnabled. */
  enabledRules?: Readonly<Record<string, boolean>>;
}

export function scoreRisks(
  graph: SkillGraph,
  options: ScoreRisksOptions = {},
): RiskReport {
  const issues: RiskIssue[] = [];
  for (const rule of ALL_RULES) {
    const override = options.enabledRules?.[rule.id];
    const enabled = override ?? rule.defaultEnabled;
    if (!enabled) continue;
    issues.push(...rule.apply(graph));
  }
  return { skillId: graph.skillId, issues };
}

export function listRules(): RiskRuleDescriptor[] {
  return ALL_RULES.map((r) => ({
    id: r.id,
    severity: r.severity,
    description: r.description,
    defaultEnabled: r.defaultEnabled,
  }));
}

function collectNarrativeText(graph: SkillGraph): string {
  const parts: string[] = [graph.metadata.description];
  for (const node of graph.nodes) {
    if (node.type === 'instruction' || node.type === 'output-shape' || node.type === 'trigger') {
      parts.push(node.label);
      parts.push(node.content);
    }
  }
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

// Exported for tests — not part of the stable public surface.
export const __internals = {
  COMPLEXITY_LONG_SECTION_THRESHOLD,
  MODAL_VERB_PATTERN,
  rules: {
    complexityLongSection,
    complexityDeepNesting,
    deadTool,
    deadSection,
    misleadingModalVerbs,
    misleadingContradiction,
  } as Record<string, RiskRule>,
};
