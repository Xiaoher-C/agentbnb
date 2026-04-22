import { describe, expect, it } from 'vitest';
import {
  parseSkill,
  extractFrontmatter,
  extractNodes,
} from '../src/index.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root } from 'mdast';

const MINIMAL = `---
name: minimal
description: A minimal skill for testing.
---

# Minimal Skill

Short body paragraph.
`;

const TYPICAL = `---
name: sample
description: "A sample skill. Use when you need to test the parser."
version: "1.2.3"
---

# Sample Skill

Some intro prose that should end up in the intro section.

## Quick Start

Run a shell command:

\`\`\`bash
agentbnb status
\`\`\`

## Decision branches

If the user asks about stocks, return a price.

## Output

Returns a JSON object:

\`\`\`json
{ "ok": true }
\`\`\`

See [contributing guide](./CONTRIBUTING.md) for more.
`;

const COMPLEX = `---
name: complex
description: "Complex skill with lots of sections."
---

# Complex

## Tool call via MCP

\`\`\`bash
mcp__notion__search query="roadmap"
\`\`\`

## Ordinary text

Just a paragraph with no special markers.

## When to use

Use this skill when you need to test trigger heading detection.
`;

const NO_FRONTMATTER = `# Just a Body

Body-only document with no frontmatter.
`;

const WINDOWS_CRLF = '---\r\nname: crlf\r\ndescription: Windows line endings.\r\n---\r\n\r\n# CRLF\r\n\r\nBody line.\r\n';

describe('extractFrontmatter', () => {
  it('parses name, description, version from a well-formed block', () => {
    const { frontmatter, body } = extractFrontmatter(TYPICAL);
    expect(frontmatter.name).toBe('sample');
    expect(frontmatter.description).toBe(
      'A sample skill. Use when you need to test the parser.',
    );
    expect(frontmatter.version).toBe('1.2.3');
    expect(body.startsWith('# Sample Skill')).toBe(true);
  });

  it('returns empty frontmatter when the --- block is missing', () => {
    const { frontmatter, body } = extractFrontmatter(NO_FRONTMATTER);
    expect(frontmatter).toEqual({});
    expect(body).toBe(NO_FRONTMATTER);
  });

  it('handles CRLF line endings', () => {
    const { frontmatter, body } = extractFrontmatter(WINDOWS_CRLF);
    expect(frontmatter.name).toBe('crlf');
    expect(frontmatter.description).toBe('Windows line endings.');
    expect(body.startsWith('# CRLF')).toBe(true);
  });

  it('strips surrounding single and double quotes', () => {
    const fm = extractFrontmatter(
      '---\nname: "quoted"\ndescription: \'single\'\n---\n',
    );
    expect(fm.frontmatter.name).toBe('quoted');
    expect(fm.frontmatter.description).toBe('single');
  });
});

describe('parseSkill', () => {
  it('produces a graph with a synthetic Trigger node from the description', () => {
    const graph = parseSkill(MINIMAL);
    expect(graph.skillId).toBe('minimal');
    expect(graph.metadata.name).toBe('minimal');
    const triggers = graph.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(triggers[0]!.content).toBe('A minimal skill for testing.');
  });

  it('defaults provenanceState to untracked when no override is provided', () => {
    const graph = parseSkill(MINIMAL);
    expect(graph.metadata.provenanceState).toBe('untracked');
    expect(graph.metadata.loadedBy).toEqual([]);
    expect(graph.metadata.gitSha).toBeUndefined();
  });

  it('accepts option overrides for metadata fields', () => {
    const graph = parseSkill(MINIMAL, {
      path: '/abs/path/SKILL.md',
      source: 'soul_md',
      loadedBy: ['agent-a', 'agent-b'],
      gitSha: 'abcdef1',
      installSource: 'agentbnb-skill',
      provenanceState: 'tracked',
    });
    expect(graph.metadata.path).toBe('/abs/path/SKILL.md');
    expect(graph.metadata.source).toBe('soul_md');
    expect(graph.metadata.loadedBy).toEqual(['agent-a', 'agent-b']);
    expect(graph.metadata.gitSha).toBe('abcdef1');
    expect(graph.metadata.installSource).toBe('agentbnb-skill');
    expect(graph.metadata.provenanceState).toBe('tracked');
  });

  it('falls back to skillId option when frontmatter lacks a name', () => {
    const graph = parseSkill(NO_FRONTMATTER, { skillId: 'fallback-id' });
    expect(graph.skillId).toBe('fallback-id');
    expect(graph.metadata.name).toBe('fallback-id');
  });

  it('extracts shell tool-calls, example code, decisions, references, and output nodes', () => {
    const graph = parseSkill(TYPICAL);
    const types = graph.nodes.map((n) => n.type);

    expect(types).toContain('tool-call');
    expect(types).toContain('example');
    expect(types).toContain('decision');
    expect(types).toContain('reference');
    expect(types).toContain('output-shape');

    const ref = graph.nodes.find((n) => n.type === 'reference');
    expect(ref?.content).toBe('./CONTRIBUTING.md');

    const decision = graph.nodes.find((n) => n.type === 'decision');
    expect(decision?.content.toLowerCase()).toContain('if ');
  });

  it('detects MCP tool calls in fenced blocks', () => {
    const graph = parseSkill(COMPLEX);
    const tool = graph.nodes.find((n) => n.type === 'tool-call');
    expect(tool).toBeDefined();
    const detections = tool!.hints?.['detections'];
    expect(Array.isArray(detections)).toBe(true);
    expect((detections as string[]).some((d) => d.startsWith('mcp__'))).toBe(true);
  });

  it('classifies H2 "When to use" as a trigger heading rather than an instruction', () => {
    const graph = parseSkill(COMPLEX);
    const heading = graph.nodes.find(
      (n) => n.type === 'trigger' && n.label.toLowerCase().includes('when to use'),
    );
    expect(heading).toBeDefined();
  });

  it('produces trigger-to-instruction edges from the root trigger to each section', () => {
    const graph = parseSkill(TYPICAL);
    const rootTrigger = graph.nodes.find(
      (n) => n.type === 'trigger' && n.hints?.['source'] === 'frontmatter',
    );
    expect(rootTrigger).toBeDefined();
    const t2iEdges = graph.edges.filter(
      (e) => e.from === rootTrigger!.id && e.kind === 'trigger-to-instruction',
    );
    expect(t2iEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('handles a body with no frontmatter without throwing', () => {
    const graph = parseSkill(NO_FRONTMATTER);
    expect(graph.skillId).toBe('unknown-skill');
    expect(graph.nodes.some((n) => n.type === 'trigger')).toBe(true);
  });
});

describe('extractNodes', () => {
  it('emits an Intro section when content appears before the first H2', () => {
    const body = 'Leading paragraph before any heading.\n\n## First heading\n\ntext\n';
    const tree = unified().use(remarkParse).parse(body) as Root;
    const { nodes } = extractNodes(tree, 'desc');
    const intro = nodes.find((n) => n.label === 'Intro');
    expect(intro).toBeDefined();
    expect(intro?.hints?.['synthesized']).toBe(true);
  });

  it('skips H1 headings (they are the skill title, not a section)', () => {
    const body = '# Title\n\n## Real section\n\nbody\n';
    const tree = unified().use(remarkParse).parse(body) as Root;
    const { nodes } = extractNodes(tree, 'desc');
    const sectionLabels = nodes
      .filter((n) => n.type === 'instruction')
      .map((n) => n.label);
    expect(sectionLabels).toEqual(['Real section']);
  });

  it('distinguishes example code blocks (json) from shell tool-calls (bash + CLI marker)', () => {
    const body = '## S\n\n```json\n{"k":1}\n```\n\n```bash\nagentbnb status\n```\n';
    const tree = unified().use(remarkParse).parse(body) as Root;
    const { nodes } = extractNodes(tree, 'desc');
    expect(nodes.some((n) => n.type === 'example' && n.hints?.['lang'] === 'json')).toBe(true);
    expect(nodes.some((n) => n.type === 'tool-call' && n.hints?.['isShell'] === true)).toBe(true);
  });

  it('ignores absolute URLs when collecting reference nodes', () => {
    const body = '## S\n\nVisit [external](https://example.com) or [local](./OTHER.md).\n';
    const tree = unified().use(remarkParse).parse(body) as Root;
    const { nodes } = extractNodes(tree, 'desc');
    const refs = nodes.filter((n) => n.type === 'reference');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.content).toBe('./OTHER.md');
  });
});
