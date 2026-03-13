import { z } from 'zod';

/**
 * IO Schema for Capability Card inputs/outputs
 */
export const IOSchemaSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'json', 'file', 'audio', 'image', 'video', 'stream']),
  description: z.string().optional(),
  required: z.boolean().default(true),
  schema: z.record(z.unknown()).optional(), // JSON Schema
});

/**
 * Capability Card — the core unit of AgentBnB
 *
 * Level 1 (Atomic): Single API capability (e.g. ElevenLabs TTS)
 * Level 2 (Pipeline): Multiple Atomics chained (e.g. text → voice → video)
 * Level 3 (Environment): Full deployment with all dependencies
 */
export const CapabilityCardSchema = z.object({
  spec_version: z.literal('1.0').default('1.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  inputs: z.array(IOSchemaSchema),
  outputs: z.array(IOSchemaSchema),
  pricing: z.object({
    credits_per_call: z.number().nonnegative(),
    credits_per_minute: z.number().nonnegative().optional(),
  }),
  availability: z.object({
    online: z.boolean(),
    schedule: z.string().optional(), // cron expression
  }),
  metadata: z.object({
    apis_used: z.array(z.string()).optional(),
    avg_latency_ms: z.number().nonnegative().optional(),
    success_rate: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type CapabilityCard = z.infer<typeof CapabilityCardSchema>;
export type IOSchema = z.infer<typeof IOSchemaSchema>;

/**
 * Custom error base class
 */
export class AgentBnBError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AgentBnBError';
  }
}
