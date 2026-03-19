import { z } from 'zod';
import { ApiSkillConfigSchema } from '../skills/skill-config.js';

// ---------------------------------------------------------------------------
// Skill Route — maps a skill to an execution path
// ---------------------------------------------------------------------------

/**
 * SkillRoute defines how a Hub Agent executes a particular skill.
 * Three modes:
 *   - direct_api: Agent calls an external REST API directly (uses ApiSkillConfig)
 *   - relay: Agent delegates execution to another agent via relay
 *   - queue: Request is queued for later dispatch
 */
export const SkillRouteSchema = z.discriminatedUnion('mode', [
  z.object({
    skill_id: z.string().min(1),
    mode: z.literal('direct_api'),
    config: ApiSkillConfigSchema,
  }),
  z.object({
    skill_id: z.string().min(1),
    mode: z.literal('relay'),
    config: z.object({ relay_owner: z.string().min(1) }),
  }),
  z.object({
    skill_id: z.string().min(1),
    mode: z.literal('queue'),
    config: z.object({ relay_owner: z.string().min(1) }).passthrough(),
  }),
]);

export type SkillRoute = z.infer<typeof SkillRouteSchema>;

// ---------------------------------------------------------------------------
// Hub Agent — persistent agent hosted on the Registry server
// ---------------------------------------------------------------------------

/**
 * HubAgent represents a persistent agent hosted on the Registry server.
 * Each Hub Agent has its own Ed25519 identity, credit balance, and skill routing table.
 */
export const HubAgentSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1),
  owner_public_key: z.string().min(1),
  public_key: z.string().min(1),
  skill_routes: z.array(SkillRouteSchema),
  status: z.enum(['active', 'paused']),
  created_at: z.string(),
  updated_at: z.string(),
});

export type HubAgent = z.infer<typeof HubAgentSchema>;

// ---------------------------------------------------------------------------
// Create Agent Request
// ---------------------------------------------------------------------------

/**
 * Request body for POST /api/agents.
 * Secrets are optional key-value pairs (e.g., API keys) encrypted at rest.
 */
export const CreateAgentRequestSchema = z.object({
  name: z.string().min(1),
  skill_routes: z.array(SkillRouteSchema),
  secrets: z.record(z.string()).optional(),
});

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
