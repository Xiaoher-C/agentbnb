import { spawnSync } from 'node:child_process';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, OpenClawSkillConfig } from './skill-config.js';

/** Default base URL for webhook channel if OPENCLAW_BASE_URL is not set. */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Default timeout in milliseconds for all channels. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Shape of a single payload entry in the OpenClaw `--json` output.
 */
interface OpenClawPayload {
  text: string | null;
  mediaUrl: string | null;
}

/**
 * Shape of the OpenClaw `--json` agent response.
 * `openclaw agent --json` wraps the agent's reply in this envelope.
 */
interface OpenClawJsonResponse {
  payloads: OpenClawPayload[];
  meta: {
    durationMs?: number;
    agentMeta?: {
      model?: string;
      provider?: string;
      usage?: Record<string, number>;
    };
    aborted?: boolean;
  };
}

/**
 * Type guard: checks whether a parsed value matches the OpenClaw `--json` envelope format.
 */
function isOpenClawJsonResponse(value: unknown): value is OpenClawJsonResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'payloads' in value &&
    Array.isArray((value as Record<string, unknown>).payloads) &&
    'meta' in value
  );
}

/**
 * Extracts the useful result from an OpenClaw `--json` response envelope.
 *
 * Strategy:
 * 1. Collect all non-empty text payloads.
 * 2. Try to JSON.parse the *last* text payload (agent was instructed to return JSON).
 * 3. If that works → return the structured object with `_openclaw_meta` attached.
 * 4. If not → return `{ text, media_urls, _openclaw_meta }` as a fallback.
 *
 * Non-OpenClaw values pass through untouched.
 */
export function parseOpenClawResponse(raw: unknown): unknown {
  if (!isOpenClawJsonResponse(raw)) {
    return raw;
  }

  const { payloads, meta } = raw;
  const texts = payloads.map((p) => p.text).filter((t): t is string => typeof t === 'string' && t.length > 0);
  const mediaUrls = payloads.map((p) => p.mediaUrl).filter((u): u is string => typeof u === 'string' && u.length > 0);

  const openclawMeta = {
    duration_ms: meta.durationMs,
    model: meta.agentMeta?.model,
    provider: meta.agentMeta?.provider,
  };

  if (texts.length === 0) {
    return { text: '', media_urls: mediaUrls, _openclaw_meta: openclawMeta };
  }

  // Try to parse the last payload as structured JSON (SKILL.md instructs the agent to do this).
  const lastText = texts[texts.length - 1]!;
  try {
    const structured: unknown = JSON.parse(lastText);
    if (typeof structured === 'object' && structured !== null) {
      return { ...(structured as Record<string, unknown>), _openclaw_meta: openclawMeta };
    }
    return { result: structured, _openclaw_meta: openclawMeta };
  } catch {
    // Agent didn't return valid JSON — fall back to text concatenation.
    return {
      text: texts.join('\n\n'),
      media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      _openclaw_meta: openclawMeta,
    };
  }
}

/**
 * Builds the OpenClaw task payload from a skill config and params.
 *
 * @param config - The OpenClaw skill config.
 * @param params - Input parameters from the AgentBnB caller.
 * @returns The formatted OpenClaw task object.
 */
function buildPayload(
  config: OpenClawSkillConfig,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    task: config.name,
    params,
    source: 'agentbnb',
    skill_id: config.id,
  };
}

/**
 * Executes the webhook channel: POSTs task payload to the OpenClaw agent's
 * HTTP endpoint and returns the parsed JSON response.
 *
 * Base URL resolved via OPENCLAW_BASE_URL env var or defaults to
 * http://localhost:3000.
 *
 * @param config - OpenClaw skill config.
 * @param payload - Task payload to POST.
 * @returns Partial ExecutionResult (without latency_ms).
 */
async function executeWebhook(
  config: OpenClawSkillConfig,
  payload: Record<string, unknown>,
): Promise<Omit<ExecutionResult, 'latency_ms'>> {
  const baseUrl = process.env['OPENCLAW_BASE_URL'] ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/openclaw/${config.agent_name}/task`;
  const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Webhook returned HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const result: unknown = await response.json();
    return { success: true, result };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: `OpenClaw webhook timed out after ${timeoutMs}ms`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates an agent name to prevent command injection.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function validateAgentName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/**
 * Executes the process channel: spawns
 * `openclaw agent --agent <name> --message '<prompt>' --json --local`
 * via child_process.execFileSync (no shell interpolation) and parses stdout as JSON.
 *
 * @param config - OpenClaw skill config.
 * @param payload - Task payload to pass via --message flag.
 * @returns Partial ExecutionResult (without latency_ms).
 */
function executeProcess(
  config: OpenClawSkillConfig,
  payload: Record<string, unknown>,
): Omit<ExecutionResult, 'latency_ms'> {
  const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  // Validate agent_name to prevent injection
  if (!validateAgentName(config.agent_name)) {
    return {
      success: false,
      error: `Invalid agent name: "${config.agent_name}" (only alphanumeric, hyphens, underscores, dots allowed)`,
    };
  }

  // Build a contextual prompt so the LLM understands this is an AgentBnB rental,
  // not a generic chat message. Raw JSON leaves the LLM without any instruction.
  const skillId = config.id;
  const message =
    `[AgentBnB Rental Request]\n` +
    `You are executing the "${skillId}" skill for an AgentBnB network rental.\n` +
    `Read your skills/${skillId}/SKILL.md for detailed instructions.\n` +
    `\n` +
    `Input parameters:\n` +
    `${JSON.stringify(payload.params ?? {}, null, 2)}\n` +
    `\n` +
    `IMPORTANT: Return ONLY a JSON object as your response.\n` +
    `Do NOT include explanations, markdown formatting, or code blocks.\n` +
    `The JSON should contain the output fields specified in your SKILL.md.\n` +
    `If you cannot complete the task, return: {"error": "reason"}`;

  try {
    // Use spawnSync with array args — no shell, no injection.
    // OpenClaw writes its --json output to stderr (not stdout), so we must capture both.
    const proc = spawnSync('openclaw', [
      'agent', '--agent', config.agent_name, '--message', message, '--json', '--local',
    ], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    if (proc.error) {
      return { success: false, error: proc.error.message };
    }

    // OpenClaw writes --json envelope to stderr; stdout is typically empty.
    const stderrText = proc.stderr?.toString() ?? '';
    const stdoutText = proc.stdout?.toString() ?? '';

    // Try stderr first (where OpenClaw --json output lives), then stdout as fallback.
    const text = (stderrText || stdoutText).trim();

    if (!text) {
      return {
        success: false,
        error: `OpenClaw process channel returned empty output (exit code ${proc.status})`,
      };
    }

    // The --json output may be preceded by log lines. Find the last top-level JSON object.
    const jsonStart = text.lastIndexOf('\n{');
    const jsonText = jsonStart >= 0 ? text.slice(jsonStart + 1) : text;

    try {
      const parsed: unknown = JSON.parse(jsonText);
      // Extract useful content from the OpenClaw { payloads, meta } envelope.
      const result = parseOpenClawResponse(parsed);
      return { success: true, result };
    } catch {
      return {
        success: false,
        error: `OpenClaw process channel returned invalid JSON: ${jsonText.slice(0, 500)}`,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errMsg };
  }
}

/**
 * Executes the telegram channel (fire-and-forget MVP): POSTs a formatted
 * message to the Telegram Bot API sendMessage endpoint.
 *
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.
 *
 * @param config - OpenClaw skill config.
 * @param payload - Task payload for message formatting.
 * @returns Partial ExecutionResult (without latency_ms).
 */
async function executeTelegram(
  config: OpenClawSkillConfig,
  payload: Record<string, unknown>,
): Promise<Omit<ExecutionResult, 'latency_ms'>> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    return {
      success: false,
      error: 'TELEGRAM_BOT_TOKEN environment variable is not set',
    };
  }

  const chatId = process.env['TELEGRAM_CHAT_ID'];
  if (!chatId) {
    return {
      success: false,
      error: 'TELEGRAM_CHAT_ID environment variable is not set',
    };
  }

  const text =
    `[AgentBnB] Skill: ${config.name} (${config.id})\n` +
    `Agent: ${config.agent_name}\n` +
    `Params: ${JSON.stringify(payload.params ?? {})}`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    return {
      success: true,
      result: { sent: true, channel: 'telegram' },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * OpenClaw Bridge — ExecutorMode C.
 *
 * Forwards AgentBnB skill execution requests to an OpenClaw agent via one of
 * three configurable channels:
 * - `webhook` — HTTP POST to OpenClaw agent's local webhook endpoint
 * - `process` — spawn `openclaw agent --agent <name> --message <JSON> --json --local`
 * - `telegram` — fire-and-forget POST to Telegram Bot API
 *
 * Implements the {@link ExecutorMode} interface so it can be registered into
 * a {@link SkillExecutor} mode map under the key `'openclaw'`.
 *
 * @example
 * ```ts
 * const modes = new Map([['openclaw', new OpenClawBridge()]]);
 * const executor = createSkillExecutor(configs, modes);
 * ```
 */
export class OpenClawBridge implements ExecutorMode {
  /**
   * Execute a skill with the given config and input parameters.
   *
   * @param config - The SkillConfig for this skill (must be type 'openclaw').
   * @param params - Input parameters passed by the caller.
   * @returns Partial ExecutionResult without latency_ms.
   */
  async execute(
    config: SkillConfig,
    params: Record<string, unknown>,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>> {
    // Cast to OpenClawSkillConfig — dispatcher guarantees config.type === 'openclaw'
    const ocConfig = config as OpenClawSkillConfig;
    const payload = buildPayload(ocConfig, params);

    switch (ocConfig.channel) {
      case 'webhook':
        return executeWebhook(ocConfig, payload);

      case 'process':
        return executeProcess(ocConfig, payload);

      case 'telegram':
        return executeTelegram(ocConfig, payload);

      default: {
        // Exhaustive guard — channel is typed but callers may pass unknown values
        const unknownChannel: unknown = ocConfig.channel;
        return {
          success: false,
          error: `Unknown OpenClaw channel: "${String(unknownChannel)}"`,
        };
      }
    }
  }
}
