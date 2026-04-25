/**
 * Skill Inspector node-type visual config — single source of truth.
 *
 * Every visual decision tied to a node type lives here: colour, icon,
 * border style. Variant components (nodes/*.tsx) are thin wrappers that
 * read this config so the palette stays centralised.
 *
 * Keys match the parser's NodeType enum (see lib/skillsApi.ts) — hyphenated
 * for 'tool-call' and 'output-shape'.
 */
import {
  Zap,
  GitBranch,
  FileText,
  Terminal,
  Network,
  Plug,
  Cpu,
  Code,
  Link,
  LayoutTemplate,
  type LucideIcon,
} from 'lucide-react';
import type { NodeType } from '../../lib/skillsApi.js';

export interface NodeTypeConfig {
  label: string;
  color: string;
  icon: LucideIcon;
  borderStyle: 'solid' | 'dashed' | 'dotted';
}

export const NODE_TYPE_CONFIG: Record<NodeType, NodeTypeConfig> = {
  trigger: {
    label: 'TRIGGER',
    color: '#14B8A6',
    icon: Zap,
    borderStyle: 'solid',
  },
  decision: {
    label: 'DECISION',
    color: '#F59E0B',
    icon: GitBranch,
    borderStyle: 'solid',
  },
  instruction: {
    label: 'INSTRUCTION',
    color: '#64748B',
    icon: FileText,
    borderStyle: 'solid',
  },
  'tool-call': {
    label: 'TOOL CALL',
    color: '#A855F7',
    icon: Terminal,
    borderStyle: 'solid',
  },
  example: {
    label: 'EXAMPLE',
    color: '#10B981',
    icon: Code,
    borderStyle: 'dashed',
  },
  reference: {
    label: 'REFERENCE',
    color: '#6B7280',
    icon: Link,
    borderStyle: 'dotted',
  },
  'output-shape': {
    label: 'OUTPUT',
    color: '#3B82F6',
    icon: LayoutTemplate,
    borderStyle: 'solid',
  },
};

/** Safe fallback for unknown node types emitted by the parser. */
export function configFor(type: string): NodeTypeConfig {
  return (
    (NODE_TYPE_CONFIG as Record<string, NodeTypeConfig | undefined>)[type] ??
    NODE_TYPE_CONFIG.instruction
  );
}

/**
 * Resolve a ToolCall icon from the command string. Falls back to Terminal when
 * the command is empty or matches nothing known.
 */
export function resolveToolCallIcon(command: string): LucideIcon {
  const cmd = command.toLowerCase().trim();
  if (!cmd) return Terminal;
  if (/^mcp_|@modelcontextprotocol/.test(cmd)) return Plug;
  if (/^(curl|fetch|http)|\b(post|get|put|delete)\b/i.test(cmd)) return Network;
  if (/^(node|python|ruby|go run|deno|bun)/.test(cmd)) return Cpu;
  if (/^(bash|sh|zsh|\$)/.test(cmd)) return Terminal;
  return Terminal;
}

/** Optional sub-type label shown as a chip on ToolCall nodes. */
export function resolveToolCallSubtype(command: string): string | undefined {
  const cmd = command.toLowerCase().trim();
  if (!cmd) return undefined;
  if (/^mcp_|@modelcontextprotocol/.test(cmd)) return 'MCP';
  if (/^(curl|fetch|http)|\b(post|get|put|delete)\b/i.test(cmd)) return 'API';
  if (/^(node|python|ruby|go run|deno|bun)/.test(cmd)) return 'Runtime';
  if (/^(bash|sh|zsh|\$)/.test(cmd)) return 'Shell';
  return undefined;
}
