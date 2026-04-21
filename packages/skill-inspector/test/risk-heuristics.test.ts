import { describe, expect, it } from 'vitest';
import {
  parseSkill,
  scoreRisks,
  listRules,
} from '../src/index.js';
import type { SkillGraph } from '../src/index.js';

function buildLongSectionSkill(lines: number): string {
  const bulk = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
  return `---\nname: long\ndescription: A skill with an overlong section.\n---\n\n# Long\n\n## Huge block\n\n${bulk}\n`;
}

const DEAD_MCP = `---
name: dead-mcp
description: References an MCP tool nobody talks about.
---

# Dead MCP

## Things to do

\`\`\`bash
mcp__totally_unrelated_service__do_stuff arg=1
\`\`\`
`;

const HAPPY_SMALL = `---
name: happy
description: A small clean skill.
---

# Happy

## Quick Start

Run \`agentbnb status\` to see your balance.

Use when the CLI is already installed.
`;

const MISLEADING_MODAL = `---
name: modals
description: Drowning in modal verbs.
---

# Modals

## Instructions

You might want to do X. You could also do Y. It should work either way.
`;

describe('listRules', () => {
  it('exposes a stable descriptor for every rule', () => {
    const rules = listRules();
    const ids = rules.map((r) => r.id).sort();
    expect(ids).toEqual(
      [
        'complexity.deep-nesting',
        'complexity.long-section',
        'dead.section',
        'dead.tool',
        'misleading.contradiction',
        'misleading.modal-verbs',
      ].sort(),
    );
    expect(rules.every((r) => typeof r.description === 'string' && r.description.length > 0)).toBe(true);
  });

  it('marks only the documented high-precision rules as default-enabled', () => {
    const enabled = listRules()
      .filter((r) => r.defaultEnabled)
      .map((r) => r.id)
      .sort();
    expect(enabled).toEqual(['complexity.long-section', 'dead.section', 'dead.tool'].sort());
  });
});

describe('scoreRisks — default-on rules', () => {
  it('fires complexity.long-section for a section over 500 lines', () => {
    const graph = parseSkill(buildLongSectionSkill(600));
    const report = scoreRisks(graph);
    const hit = report.issues.find((i) => i.ruleId === 'complexity.long-section');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('complexity');
    expect(hit?.evidence).toMatch(/Lines/);
  });

  it('does not fire complexity.long-section for sections under the threshold', () => {
    const graph = parseSkill(buildLongSectionSkill(100));
    const report = scoreRisks(graph);
    expect(
      report.issues.some((i) => i.ruleId === 'complexity.long-section'),
    ).toBe(false);
  });

  it('fires dead.tool when an MCP tool namespace is never mentioned in narrative', () => {
    const graph = parseSkill(DEAD_MCP);
    const report = scoreRisks(graph);
    const hit = report.issues.find((i) => i.ruleId === 'dead.tool');
    expect(hit).toBeDefined();
    expect(hit?.evidence).toContain('mcp__totally_unrelated_service');
  });

  it('stays quiet on a small clean skill (zero issues from default-on rules)', () => {
    const graph = parseSkill(HAPPY_SMALL);
    const report = scoreRisks(graph);
    expect(report.issues).toEqual([]);
  });
});

describe('scoreRisks — opt-in rules', () => {
  it('misleading.modal-verbs is silent by default', () => {
    const graph = parseSkill(MISLEADING_MODAL);
    const report = scoreRisks(graph);
    expect(
      report.issues.some((i) => i.ruleId === 'misleading.modal-verbs'),
    ).toBe(false);
  });

  it('misleading.modal-verbs fires when explicitly enabled', () => {
    const graph = parseSkill(MISLEADING_MODAL);
    const report = scoreRisks(graph, {
      enabledRules: { 'misleading.modal-verbs': true },
    });
    const hit = report.issues.find((i) => i.ruleId === 'misleading.modal-verbs');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('misleading');
    expect(['may', 'might', 'could', 'should']).toContain(
      hit?.evidence?.toLowerCase(),
    );
  });

  it('deferred rules (deep-nesting, contradiction) return zero issues even when enabled', () => {
    const graph = parseSkill(HAPPY_SMALL);
    const report = scoreRisks(graph, {
      enabledRules: {
        'complexity.deep-nesting': true,
        'misleading.contradiction': true,
      },
    });
    expect(
      report.issues.some(
        (i) =>
          i.ruleId === 'complexity.deep-nesting' ||
          i.ruleId === 'misleading.contradiction',
      ),
    ).toBe(false);
  });
});

describe('scoreRisks — overrides', () => {
  it('can disable a default-on rule via enabledRules: false', () => {
    const graph = parseSkill(buildLongSectionSkill(600));
    const report = scoreRisks(graph, {
      enabledRules: { 'complexity.long-section': false },
    });
    expect(
      report.issues.some((i) => i.ruleId === 'complexity.long-section'),
    ).toBe(false);
  });

  it('issues carry stable ruleId / nodeId / severity / message fields', () => {
    const graph = parseSkill(DEAD_MCP);
    const report = scoreRisks(graph);
    for (const issue of report.issues) {
      expect(issue.ruleId).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(typeof issue.nodeId).toBe('string');
      expect(issue.severity).toMatch(/^(misleading|complexity|dead)$/);
      expect(typeof issue.message).toBe('string');
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('scoreRisks returns the same skillId as the graph', () => {
    const graph: SkillGraph = parseSkill(HAPPY_SMALL);
    const report = scoreRisks(graph);
    expect(report.skillId).toBe(graph.skillId);
  });
});
