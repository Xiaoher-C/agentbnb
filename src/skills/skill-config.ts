import { z } from 'zod';
import yaml from 'js-yaml';

/**
 * Pricing schema shared across all skill types.
 */
const PricingSchema = z.object({
  credits_per_call: z.number().nonnegative(),
  credits_per_minute: z.number().nonnegative().optional(),
  free_tier: z.number().nonnegative().optional(),
});

/**
 * Auth config for API skills.
 * Supports bearer token, API key header, and basic auth.
 */
const ApiAuthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bearer'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('apikey'),
    header: z.string().default('X-API-Key'),
    key: z.string(),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
  }),
]);

/**
 * Schema for API wrapper skills (Mode A).
 * Wraps a REST API call with input/output mapping.
 */
export const ApiSkillConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('api'),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  auth: ApiAuthSchema.optional(),
  input_mapping: z.record(z.string()).default({}),
  output_mapping: z.record(z.string()).default({}),
  pricing: PricingSchema,
  timeout_ms: z.number().positive().default(30000),
  retries: z.number().nonnegative().int().default(0),
  provider: z.string().optional(),
});

/**
 * A single step in a pipeline skill.
 * Can reference a skill_id (execute another skill) or a direct command.
 */
const PipelineStepSchema = z.union([
  z.object({
    skill_id: z.string().min(1),
    input_mapping: z.record(z.string()).default({}),
  }),
  z.object({
    command: z.string().min(1),
    input_mapping: z.record(z.string()).default({}),
  }),
]);

/**
 * Schema for pipeline skills (Mode B).
 * Chains multiple skills or commands sequentially.
 */
export const PipelineSkillConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pipeline'),
  name: z.string().min(1),
  steps: z.array(PipelineStepSchema).min(1),
  pricing: PricingSchema,
  timeout_ms: z.number().positive().optional(),
});

/**
 * Schema for OpenClaw bridge skills (Mode C).
 * Forwards execution to a local OpenClaw agent.
 */
export const OpenClawSkillConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('openclaw'),
  name: z.string().min(1),
  agent_name: z.string().min(1),
  channel: z.enum(['telegram', 'webhook', 'process']),
  pricing: PricingSchema,
  timeout_ms: z.number().positive().optional(),
});

/**
 * Schema for command execution skills (Mode D).
 * Runs local shell commands with parameter substitution.
 */
export const CommandSkillConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('command'),
  name: z.string().min(1),
  command: z.string().min(1),
  output_type: z.enum(['json', 'text', 'file']),
  allowed_commands: z.array(z.string()).optional(),
  working_dir: z.string().optional(),
  timeout_ms: z.number().positive().default(30000),
  pricing: PricingSchema,
});

/**
 * Discriminated union over all four skill configuration types.
 * Used by SkillExecutor to dispatch to the correct executor mode.
 */
export const SkillConfigSchema = z.discriminatedUnion('type', [
  ApiSkillConfigSchema,
  PipelineSkillConfigSchema,
  OpenClawSkillConfigSchema,
  CommandSkillConfigSchema,
]);

/**
 * Root schema for a skills.yaml file.
 * Contains a list of skill configurations.
 */
export const SkillsFileSchema = z.object({
  skills: z.array(SkillConfigSchema),
});

/** TypeScript type for any skill config entry */
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
/** TypeScript type for an API-mode skill config */
export type ApiSkillConfig = z.infer<typeof ApiSkillConfigSchema>;
/** TypeScript type for a pipeline-mode skill config */
export type PipelineSkillConfig = z.infer<typeof PipelineSkillConfigSchema>;
/** TypeScript type for an OpenClaw-mode skill config */
export type OpenClawSkillConfig = z.infer<typeof OpenClawSkillConfigSchema>;
/** TypeScript type for a command-mode skill config */
export type CommandSkillConfig = z.infer<typeof CommandSkillConfigSchema>;

/**
 * Expands `${VAR_NAME}` patterns in a string using process.env.
 *
 * @param value - The string potentially containing `${ENV_VAR}` references.
 * @returns The string with all env var references replaced.
 * @throws Error if a referenced env var is not defined.
 */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable "${varName}" is not defined`);
    }
    return envValue;
  });
}

/**
 * Recursively walks an unknown value and expands `${ENV_VAR}` in all string leaves.
 *
 * @param value - Any value (string, object, array, etc.)
 * @returns The value with all string env-var references expanded.
 */
function expandEnvVarsDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return expandEnvVars(value);
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVarsDeep);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandEnvVarsDeep(v);
    }
    return result;
  }
  return value;
}

/**
 * Parses a skills.yaml file content string into a typed SkillConfig array.
 *
 * 1. Parses YAML string into a raw object (throws on invalid YAML).
 * 2. Expands all `${ENV_VAR}` references in string values using process.env.
 * 3. Validates the result with the SkillsFileSchema Zod schema (throws ZodError on invalid shape).
 *
 * @param yamlContent - Raw YAML string (contents of skills.yaml).
 * @returns Parsed and validated array of SkillConfig objects.
 * @throws YAMLException if YAML syntax is invalid.
 * @throws ZodError if schema validation fails.
 * @throws Error if any referenced environment variable is not defined.
 */
export function parseSkillsFile(yamlContent: string): SkillConfig[] {
  // Step 1: Parse YAML
  const raw = yaml.load(yamlContent);

  // Step 2: Expand env vars across all string values
  const expanded = expandEnvVarsDeep(raw);

  // Step 3: Validate with Zod
  const result = SkillsFileSchema.parse(expanded);

  return result.skills;
}
