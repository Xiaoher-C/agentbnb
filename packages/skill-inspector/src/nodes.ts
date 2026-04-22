import type {
  Root,
  RootContent,
  Heading,
  Code,
  Paragraph,
  List,
  Link,
} from 'mdast';

/**
 * Minimal structural Position shape. mdast nodes carry an optional
 * `position?: Position` from unist; we redeclare the subset we read
 * here to keep the package free of a direct @types/unist dependency.
 */
interface Position {
  start: { line: number; column?: number };
  end: { line: number; column?: number };
}
import { toString as mdastToString } from 'mdast-util-to-string';
import type {
  SkillNode,
  SkillEdge,
  NodeType,
  SourceRange,
  HintValue,
} from './types.js';

const DECISION_MARKERS = /\b(if|when|unless|whenever)\b/i;
const TOOL_CALL_MARKERS: RegExp[] = [
  /\b(Bash|Read|Write|Edit|Grep|Glob|WebFetch|WebSearch)\b/,
  /\bmcp__[a-z0-9_]+/i,
];
const SHELL_CLI_MARKER =
  /\b(agentbnb|curl|npm|pnpm|yarn|git|gh|claude|openclaw)\s/;
const OUTPUT_HEADING_PATTERN =
  /\b(output|outputs|return|returns|response\s+format)\b/i;
const TRIGGER_HEADING_PATTERN =
  /\b(use\s+when|use\s+this\s+skill\s+when|when\s+to\s+use|trigger|triggers)\b/i;

function rangeFromPosition(position?: Position | undefined): SourceRange {
  const start = position?.start.line ?? 1;
  const end = position?.end.line ?? start;
  return { startLine: start - 1, endLine: end - 1 };
}

function containsToolCallMarker(code: string): string[] {
  const hits: string[] = [];
  for (const re of TOOL_CALL_MARKERS) {
    const m = re.exec(code);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

interface LinkLike {
  url: string;
  text: string;
  position: Position | undefined;
}

function collectLinks(node: RootContent | Paragraph | List): LinkLike[] {
  const out: LinkLike[] = [];
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    const candidate = current as {
      type?: string;
      url?: string;
      children?: unknown[];
      position?: Position;
    };
    if (candidate.type === 'link' && typeof candidate.url === 'string') {
      const text = mdastToString(current as Link).trim();
      out.push({ url: candidate.url, text, position: candidate.position });
    }
    if (Array.isArray(candidate.children)) {
      for (const c of candidate.children) stack.push(c);
    }
  }
  return out;
}

interface IdMinter {
  next(prefix: string): string;
}

function makeIdMinter(): IdMinter {
  let counter = 0;
  return {
    next(prefix: string): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}

/**
 * Walk the mdast tree and extract Skill nodes + edges.
 *
 * Emission strategy:
 * 1. A synthetic Trigger node is pre-emitted from the frontmatter description
 *    so every graph has a root even when the body lacks a "Use when" heading.
 * 2. H2 / H3 open new sections (typed as instruction / trigger / output-shape
 *    depending on heading text). H1 is skipped — it's the skill title.
 * 3. Content before the first heading, or between H1 and the first H2, lands
 *    in a synthesized "Intro" instruction section so nothing is orphaned.
 * 4. Code fences become tool-call nodes when they reference known tool names
 *    or shell CLIs; otherwise they're example nodes.
 * 5. Paragraphs / lists containing decision markers (if/when/unless/whenever)
 *    emit a dedicated decision node inside the enclosing section.
 * 6. Links with relative URLs emit reference nodes.
 */
export function extractNodes(
  tree: Root,
  description: string,
): { nodes: SkillNode[]; edges: SkillEdge[] } {
  const mint = makeIdMinter();
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];

  const triggerHints: Record<string, HintValue> = { source: 'frontmatter' };
  const triggerId = mint.next('trigger');
  nodes.push({
    id: triggerId,
    type: 'trigger',
    label: 'Trigger (from description)',
    content: description.trim(),
    sourceRange: { startLine: 0, endLine: 0 },
    hints: triggerHints,
  });

  let currentSectionId: string | null = null;
  let lastNodeInSectionId: string | null = null;

  const openIntroSectionIfNeeded = (rangeSource: Position | undefined): void => {
    if (currentSectionId) return;
    const introId = mint.next('instr');
    nodes.push({
      id: introId,
      type: 'instruction',
      label: 'Intro',
      content: '',
      sourceRange: rangeFromPosition(rangeSource),
      hints: { synthesized: true },
    });
    currentSectionId = introId;
    lastNodeInSectionId = introId;
    edges.push({ from: triggerId, to: introId, kind: 'trigger-to-instruction' });
  };

  const attachToSection = (childId: string): void => {
    if (!currentSectionId) return;
    if (!lastNodeInSectionId || lastNodeInSectionId === childId) return;
    edges.push({ from: lastNodeInSectionId, to: childId, kind: 'order' });
  };

  const appendInstructionText = (text: string): void => {
    if (!currentSectionId) return;
    const section = nodes.find((n) => n.id === currentSectionId);
    if (!section) return;
    section.content = section.content ? `${section.content}\n\n${text}` : text;
  };

  const extendCurrentSectionRange = (endLine: number): void => {
    if (!currentSectionId) return;
    const section = nodes.find((n) => n.id === currentSectionId);
    if (!section) return;
    if (endLine > section.sourceRange.endLine) {
      section.sourceRange.endLine = endLine;
    }
  };

  for (const child of tree.children) {
    if (child.type === 'heading') {
      const heading = child as Heading;
      if (heading.depth === 1) {
        continue;
      }
      if (heading.depth >= 2 && heading.depth <= 3) {
        const title = mdastToString(heading).trim();
        const range = rangeFromPosition(heading.position);

        let nodeType: NodeType = 'instruction';
        let prefix = 'instr';
        if (TRIGGER_HEADING_PATTERN.test(title)) {
          nodeType = 'trigger';
          prefix = 'trig-h';
        } else if (OUTPUT_HEADING_PATTERN.test(title)) {
          nodeType = 'output-shape';
          prefix = 'out';
        }

        const id = mint.next(prefix);
        nodes.push({
          id,
          type: nodeType,
          label: title,
          content: '',
          sourceRange: range,
          hints: { headingDepth: heading.depth },
        });
        edges.push({
          from: triggerId,
          to: id,
          kind: 'trigger-to-instruction',
        });

        currentSectionId = id;
        lastNodeInSectionId = id;
      }
      continue;
    }

    const range = rangeFromPosition(child.position);
    openIntroSectionIfNeeded(child.position);
    extendCurrentSectionRange(range.endLine);

    if (child.type === 'code') {
      const code = child as Code;
      const content = code.value;
      const toolHits = containsToolCallMarker(content);
      const lang = code.lang ?? '';
      const isShell = ['bash', 'sh', 'shell', 'zsh'].includes(lang.toLowerCase());
      const mentionsCli = SHELL_CLI_MARKER.test(content);

      if (toolHits.length > 0 || (isShell && mentionsCli)) {
        const firstHit = toolHits[0];
        const id = mint.next('tool');
        nodes.push({
          id,
          type: 'tool-call',
          label: firstHit ? `Tool call (${firstHit})` : 'Shell invocation',
          content,
          sourceRange: range,
          hints: {
            lang,
            detections: toolHits,
            isShell,
          },
        });
        attachToSection(id);
        lastNodeInSectionId = id;
        continue;
      }

      const id = mint.next('ex');
      nodes.push({
        id,
        type: 'example',
        label: lang ? `Example (${lang})` : 'Example',
        content,
        sourceRange: range,
        hints: { lang },
      });
      attachToSection(id);
      if (currentSectionId) {
        edges.push({ from: currentSectionId, to: id, kind: 'example-of' });
      }
      lastNodeInSectionId = id;
      continue;
    }

    if (child.type === 'paragraph' || child.type === 'list') {
      const blockText = mdastToString(child).trim();
      if (!blockText) continue;

      const links = collectLinks(child);
      for (const link of links) {
        if (!link.url) continue;
        const isRelative = !/^([a-z]+:\/\/|mailto:|#)/i.test(link.url);
        if (!isRelative) continue;
        const refId = mint.next('ref');
        nodes.push({
          id: refId,
          type: 'reference',
          label: link.text || link.url,
          content: link.url,
          sourceRange: rangeFromPosition(link.position),
          hints: { url: link.url },
        });
        attachToSection(refId);
        if (currentSectionId) {
          edges.push({ from: currentSectionId, to: refId, kind: 'reference' });
        }
        lastNodeInSectionId = refId;
      }

      if (DECISION_MARKERS.test(blockText)) {
        const id = mint.next('dec');
        nodes.push({
          id,
          type: 'decision',
          label: truncate(blockText, 80),
          content: blockText,
          sourceRange: range,
        });
        attachToSection(id);
        lastNodeInSectionId = id;
        continue;
      }

      appendInstructionText(blockText);
    }
  }

  return { nodes, edges };
}
