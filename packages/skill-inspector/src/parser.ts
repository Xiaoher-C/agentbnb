import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root } from 'mdast';
import { extractNodes } from './nodes.js';
import type { SkillGraph, SkillMetadata, InstallSource, SkillSource } from './types.js';

export interface ParseSkillOptions {
  path?: string;
  loadedBy?: string[];
  source?: SkillSource;
  skillId?: string;
  gitSha?: string;
  installSource?: InstallSource;
  provenanceState?: SkillMetadata['provenanceState'];
}

export interface Frontmatter {
  name?: string;
  description?: string;
  version?: string;
}

export interface FrontmatterExtraction {
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Minimal YAML frontmatter extractor for the fields parser.ts needs.
 *
 * Reuses the frontmatter regex pattern from
 * src/workspace/scanner.ts:359 and :419 rather than adding a gray-matter
 * dependency. The rest of the frontmatter (metadata.*, tags, etc.) is not
 * consumed here — Layer 2 surfaces those separately from the discovered
 * skill entry.
 */
export function extractFrontmatter(markdown: string): FrontmatterExtraction {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const raw = match[1] ?? '';
  const frontmatter: Frontmatter = {};

  const nameMatch = /^name:\s*(.+)$/m.exec(raw);
  if (nameMatch && nameMatch[1]) {
    frontmatter.name = stripSurroundingQuotes(nameMatch[1]);
  }

  const descMatch = /^description:\s*(.+)$/m.exec(raw);
  if (descMatch && descMatch[1]) {
    frontmatter.description = stripSurroundingQuotes(descMatch[1]);
  }

  const versionMatch = /^\s*version:\s*(.+)$/m.exec(raw);
  if (versionMatch && versionMatch[1]) {
    frontmatter.version = stripSurroundingQuotes(versionMatch[1]);
  }

  const body = markdown.slice(match[0].length).replace(/^(\r?\n)+/, '');
  return { frontmatter, body };
}

export function parseSkill(
  markdown: string,
  options: ParseSkillOptions = {},
): SkillGraph {
  const { frontmatter, body } = extractFrontmatter(markdown);

  const name = frontmatter.name ?? options.skillId ?? 'unknown-skill';
  const description = frontmatter.description ?? '';

  const tree = unified().use(remarkParse).parse(body) as Root;
  const { nodes, edges } = extractNodes(tree, description);

  const metadata: SkillMetadata = {
    name,
    description,
    path: options.path ?? '',
    source: options.source ?? 'skill_md',
    provenanceState: options.provenanceState ?? 'untracked',
    loadedBy: options.loadedBy ?? [],
  };
  if (frontmatter.version) metadata.version = frontmatter.version;
  if (options.gitSha) metadata.gitSha = options.gitSha;
  if (options.installSource) metadata.installSource = options.installSource;

  return {
    skillId: options.skillId ?? name,
    metadata,
    nodes,
    edges,
  };
}
