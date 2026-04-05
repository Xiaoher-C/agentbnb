import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionMessage } from './session-types.js';

const SESSIONS_DIR = join(homedir(), '.agentbnb', 'sessions');

/**
 * Provider-side session executor.
 *
 * Receives incoming session messages and executes them using the configured
 * engine (claude-code or openclaw), maintaining conversation context across
 * turns within the same session.
 */
export class SessionExecutor {
  /** sessionId → accumulated message history */
  private histories = new Map<string, SessionMessage[]>();

  /**
   * Handle an incoming session message and produce a response.
   *
   * @param sessionId - The session this message belongs to.
   * @param skillId - The skill being invoked.
   * @param message - The incoming message text.
   * @param engine - Execution engine: 'claude-code' or 'openclaw'.
   * @param history - Full message history (from SessionManager).
   * @returns The response text from the engine.
   */
  async handleMessage(
    sessionId: string,
    skillId: string,
    message: string,
    engine: 'claude-code' | 'openclaw' | 'command' = 'claude-code',
    history: SessionMessage[] = [],
  ): Promise<string> {
    // Merge with any locally-tracked history
    this.histories.set(sessionId, history);

    switch (engine) {
      case 'claude-code':
        return this.executeClaudeCode(sessionId, skillId, message, history);
      case 'openclaw':
        return this.executeOpenClaw(sessionId, skillId, message, history);
      case 'command':
        return this.executeCommand(sessionId, message);
      default:
        throw new Error(`Unknown session engine: ${engine}`);
    }
  }

  /**
   * Clean up session context when a session ends.
   */
  cleanup(sessionId: string): void {
    this.histories.delete(sessionId);
  }

  // -------------------------------------------------------------------------
  // Engine implementations
  // -------------------------------------------------------------------------

  /**
   * Claude Code engine — uses `claude -p` with session context.
   */
  private async executeClaudeCode(
    sessionId: string,
    skillId: string,
    message: string,
    history: SessionMessage[],
  ): Promise<string> {
    const sessionDir = join(SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // Write context file for claude
    const contextFile = join(sessionDir, 'context.md');
    writeFileSync(contextFile, buildContextFromHistory(skillId, history));

    const escaped = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    try {
      const result = execSync(
        `claude -p "${escaped}" --cwd "${sessionDir}"`,
        { encoding: 'utf-8', timeout: 90_000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      return result.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Session executor error: ${msg}]`;
    }
  }

  /**
   * OpenClaw engine — delegates to openclaw agent.
   */
  private async executeOpenClaw(
    sessionId: string,
    skillId: string,
    message: string,
    history: SessionMessage[],
  ): Promise<string> {
    const prompt = buildOpenClawPrompt(skillId, message, history);
    const escaped = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

    try {
      const result = execSync(
        `openclaw agent --agent "${skillId}" --message "${escaped}" --json --local`,
        { encoding: 'utf-8', timeout: 90_000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      return parseOpenClawResponse(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[OpenClaw executor error: ${msg}]`;
    }
  }

  /**
   * Command engine — simple echo/pipe execution.
   */
  private async executeCommand(sessionId: string, message: string): Promise<string> {
    // Minimal command engine: echo back the message for testing
    return `[command:${sessionId}] Received: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a context markdown document from session history.
 */
function buildContextFromHistory(skillId: string, history: SessionMessage[]): string {
  let context = `# Session Context\n\nSkill: ${skillId}\n\n## Conversation History\n\n`;
  for (const msg of history) {
    const role = msg.sender === 'requester' ? 'User' : 'Assistant';
    context += `**${role}**: ${msg.content}\n\n`;
  }
  return context;
}

/**
 * Build an OpenClaw prompt with session context.
 */
function buildOpenClawPrompt(
  skillId: string,
  message: string,
  history: SessionMessage[],
): string {
  if (history.length <= 1) return message;

  let prompt = `[Session context for ${skillId}]\n`;
  for (const msg of history.slice(0, -1)) {
    const role = msg.sender === 'requester' ? 'User' : 'Agent';
    prompt += `${role}: ${msg.content}\n`;
  }
  prompt += `\nUser: ${message}`;
  return prompt;
}

/**
 * Parse OpenClaw JSON response to extract content.
 */
function parseOpenClawResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw.trim());
    return parsed.response ?? parsed.result ?? parsed.message ?? raw.trim();
  } catch {
    return raw.trim();
  }
}
