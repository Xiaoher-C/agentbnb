import { execFileSync } from 'node:child_process';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, OpenClawSkillConfig } from './skill-config.js';

/** Default base URL for webhook channel if OPENCLAW_BASE_URL is not set. */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Default timeout in milliseconds for all channels. */
const DEFAULT_TIMEOUT_MS = 60_000;

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
 * Executes the process channel: spawns `openclaw agent --agent <name> --message '<JSON>' --json --local`
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
    // Use execFileSync with array args — no shell, no injection
    const stdout = execFileSync('openclaw', [
      'agent', '--agent', config.agent_name, '--message', message, '--json', '--local',
    ], {
      timeout: timeoutMs,
    });
    const text = stdout.toString().trim();
    // OpenClaw agent --json outputs a JSON object; extract the reply text
    try {
      const parsed: unknown = JSON.parse(text);
      return { success: true, result: parsed };
    } catch {
      // If stdout isn't valid JSON, return as raw text
      return { success: true, result: { text } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
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
 * - `process` — spawn `openclaw run <agent_name>` subprocess
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
