import { randomUUID } from 'node:crypto';
import type { SubTask } from './types.js';

/**
 * Template step definition used internally to generate SubTask instances.
 */
interface TemplateStep {
  description: string;
  required_capability: string;
  estimated_credits: number;
  /**
   * Dependency indices — references to other steps in the same template (0-based).
   * Converted to UUIDs at decomposition time.
   */
  depends_on_indices: number[];
}

/**
 * A decomposition template: keyword triggers + ordered steps.
 */
interface Template {
  keywords: readonly string[];
  steps: readonly TemplateStep[];
}

/**
 * Hardcoded decomposition templates for MVP.
 *
 * Each template maps keywords to a DAG of steps.
 * Future versions will replace this with LLM-driven decomposition.
 */
export const TEMPLATES: Readonly<Record<string, Template>> = {
  'video-production': {
    keywords: ['video', 'demo', 'clip', 'animation'],
    steps: [
      {
        description: 'Generate script from task description',
        required_capability: 'text_gen',
        estimated_credits: 2,
        depends_on_indices: [],
      },
      {
        description: 'Generate voiceover from script',
        required_capability: 'tts',
        estimated_credits: 3,
        depends_on_indices: [0],
      },
      {
        description: 'Generate video visuals from script',
        required_capability: 'video_gen',
        estimated_credits: 5,
        depends_on_indices: [0],
      },
      {
        description: 'Composite voiceover and video into final output',
        required_capability: 'video_edit',
        estimated_credits: 3,
        depends_on_indices: [1, 2],
      },
    ],
  },
  'deep-analysis': {
    keywords: ['analyze', 'analysis', 'research', 'report', 'evaluate'],
    steps: [
      {
        description: 'Research and gather relevant data',
        required_capability: 'web_search',
        estimated_credits: 2,
        depends_on_indices: [],
      },
      {
        description: 'Analyze gathered data',
        required_capability: 'text_gen',
        estimated_credits: 3,
        depends_on_indices: [0],
      },
      {
        description: 'Summarize analysis findings',
        required_capability: 'text_gen',
        estimated_credits: 2,
        depends_on_indices: [1],
      },
      {
        description: 'Format into final report',
        required_capability: 'text_gen',
        estimated_credits: 1,
        depends_on_indices: [2],
      },
    ],
  },
  'content-generation': {
    keywords: ['write', 'blog', 'article', 'content', 'post', 'essay'],
    steps: [
      {
        description: 'Create content outline',
        required_capability: 'text_gen',
        estimated_credits: 1,
        depends_on_indices: [],
      },
      {
        description: 'Draft content from outline',
        required_capability: 'text_gen',
        estimated_credits: 3,
        depends_on_indices: [0],
      },
      {
        description: 'Review and refine draft',
        required_capability: 'text_gen',
        estimated_credits: 2,
        depends_on_indices: [1],
      },
      {
        description: 'Finalize and polish content',
        required_capability: 'text_gen',
        estimated_credits: 1,
        depends_on_indices: [2],
      },
    ],
  },
} as const;

/**
 * Decomposes a natural-language task description into an ordered array of SubTasks
 * using hardcoded keyword-matching templates.
 *
 * Returns the first matching template's steps as SubTask[], or an empty array
 * if no template matches.
 *
 * @param task - Natural language task description.
 * @param _availableCapabilities - Reserved for future filtering (unused in MVP).
 * @returns Array of SubTask objects forming a dependency DAG.
 */
export function decompose(task: string, _availableCapabilities?: string[]): SubTask[] {
  const lower = task.toLowerCase();

  for (const template of Object.values(TEMPLATES)) {
    const matched = template.keywords.some((kw) => lower.includes(kw));
    if (!matched) continue;

    // Generate UUIDs for all steps up front
    const ids = template.steps.map(() => randomUUID());

    return template.steps.map((step, i): SubTask => ({
      id: ids[i]!,
      description: step.description,
      required_capability: step.required_capability,
      params: {},
      depends_on: step.depends_on_indices.map((idx) => ids[idx]!),
      estimated_credits: step.estimated_credits,
    }));
  }

  return [];
}
