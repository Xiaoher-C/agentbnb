/**
 * Regex-based capability detection from markdown documentation files.
 *
 * Scans CLAUDE.md, AGENTS.md, README.md, or any markdown content for
 * mentions of known APIs and tools. Pure function — no I/O, no LLM.
 */
import { API_PATTERNS } from './capability-templates.js';
import type { DetectedCapability } from './capability-templates.js';

/**
 * Scans markdown content for known API/tool patterns and returns detected capabilities.
 *
 * - Tests each API_PATTERNS regex against the full content
 * - Deduplicates by capability key (first match wins)
 * - Returns empty array if nothing is detected
 *
 * @param content - Markdown file content to scan
 * @returns Array of detected capabilities (may be empty)
 */
export function detectFromDocs(content: string): DetectedCapability[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const results: DetectedCapability[] = [];

  for (const entry of API_PATTERNS) {
    if (entry.pattern.test(content) && !seen.has(entry.capability.key)) {
      seen.add(entry.capability.key);
      results.push({ ...entry.capability });
    }
  }

  return results;
}
