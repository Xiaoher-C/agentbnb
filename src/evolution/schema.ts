import { z } from 'zod';

/**
 * Schema for a single core memory entry captured in a template evolution snapshot.
 */
export const CoreMemoryEntrySchema = z.object({
  category: z.string(),
  importance: z.number().min(0).max(1),
  content: z.string(),
  scope: z.string().optional(),
});

/**
 * Schema for a template evolution record published by a genesis-evolution skill.
 *
 * Represents one version advancement of a genesis template, including a snapshot
 * of the agent's core memory at the time of evolution and a fitness delta.
 */
export const TemplateEvolutionSchema = z.object({
  /** e.g. "genesis-template" */
  template_name: z.string().min(1),
  /** Semantic version string, e.g. "1.2.3" */
  template_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be a valid semver string (e.g. 1.2.3)'),
  /** Identifier of the agent publishing this evolution */
  publisher_agent: z.string().min(1),
  /** Human-readable description of what changed in this evolution */
  changelog: z.string().max(1000),
  /** Snapshot of the agent's core memory at the time of evolution (max 50 entries) */
  core_memory_snapshot: z.array(CoreMemoryEntrySchema).max(50),
  /** Delta in fitness score from before evolution (range -1 to 1) */
  fitness_improvement: z.number().min(-1).max(1),
  /** ISO 8601 datetime string */
  timestamp: z.string().datetime(),
});

export type CoreMemoryEntry = z.infer<typeof CoreMemoryEntrySchema>;
export type TemplateEvolution = z.infer<typeof TemplateEvolutionSchema>;
