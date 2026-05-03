import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionMessage } from './session-types.js';
import {
  isOpenClawJsonResponse,
  validateAgentName,
} from '../skills/openclaw-bridge.js';

/** Default timeout for OpenClaw commands in milliseconds. */
const DEFAULT_TIMEOUT_MS = 90_000;

/** Inline conversation entry (will be refactored to use OpenClawConversationHistory later). */
interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** Cached SOUL.md content. */
interface SoulContent {
  full: string;
  summary: string;
}

/**
 * OpenClaw-based session executor.
 *
 * Manages multi-turn conversation state for OpenClaw agents, including:
 * - Conversation history accumulation and prompt construction
 * - SOUL.md layered injection (full on turn 1, summary on turn 2+)
 * - Memory recall on session start and summary write on session end (best-effort)
 * - Multi-agent routing via agent name
 *
 * @deprecated **VIOLATES ADR-024 (Privacy Boundary).**
 *
 * This executor has three known privacy violations relative to the v10 rental
 * contract「租用執行能力，不租用 agent 的腦與鑰匙」:
 * 1. `recallMemory()` reads owner's main brain at session start
 * 2. `writeSessionSummary()` writes session metadata into owner's main brain at end
 * 3. `buildPrompt()` injects full SOUL.md into the prompt (potential leak via response)
 *
 * v10 supply path is the Hermes plugin (`plugins/agentbnb/`) using a Curated
 * Rental Runner: spawn an isolated Hermes subagent loaded with owner-curated
 * RENTAL.md persona + tool whitelist + memory-write hook disabled.
 *
 * This executor is retained as backward-compat path for existing OpenClaw
 * supply only. Do NOT use for new rental session paths. ADR-K (v1.1) will
 * formalize the OpenClaw rental-mode upgrade.
 */
export class OpenClawSessionExecutor {
  private histories = new Map<string, ConversationEntry[]>();
  private soulCache = new Map<string, SoulContent>();

  /**
   * Execute a session message via OpenClaw.
   *
   * @param sessionId - The session this message belongs to.
   * @param skillId - The skill (also used as the agent name).
   * @param message - The incoming message text.
   * @param history - Full message history from SessionManager.
   * @param config - Optional config overrides.
   * @returns The response text from the OpenClaw agent.
   */
  async execute(
    sessionId: string,
    skillId: string,
    message: string,
    history: SessionMessage[],
    config?: { timeoutMs?: number },
  ): Promise<string> {
    const agentName = this.extractAgentName(skillId);

    if (!validateAgentName(agentName)) {
      return `[OpenClaw session error: invalid agent name "${agentName}"]`;
    }

    // Get or create conversation history
    let entries = this.histories.get(sessionId);
    if (!entries) {
      entries = [];
      this.histories.set(sessionId, entries);
    }

    const isFirstTurn = entries.length === 0;
    const requesterId = this.extractRequesterId(history);

    // On first turn, try memory recall (best effort)
    let memoryContext: string | null = null;
    if (isFirstTurn) {
      memoryContext = this.recallMemory(agentName, requesterId, skillId);
    }

    // Add user message to history
    entries.push({ role: 'user', content: message });

    // Build prompt
    const prompt = this.buildPrompt(
      skillId, message, isFirstTurn, agentName,
      requesterId, memoryContext, entries,
    );

    // Execute via OpenClaw
    const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const response = this.executeCommand(agentName, prompt, timeoutMs);

    // Add assistant response to history
    entries.push({ role: 'assistant', content: response });

    return response;
  }

  /**
   * Clean up session context when a session ends.
   *
   * Attempts to write a session summary to memory (best effort),
   * then deletes conversation history.
   *
   * @param sessionId - The session to clean up.
   * @param skillId - The skill (agent name) for memory write.
   * @param requesterId - The requester for memory context.
   */
  cleanup(sessionId: string, skillId?: string, requesterId?: string): void {
    const entries = this.histories.get(sessionId);

    if (entries && entries.length > 0 && skillId) {
      const agentName = this.extractAgentName(skillId);
      if (validateAgentName(agentName)) {
        this.writeSessionSummary(
          agentName, sessionId, requesterId ?? 'unknown', skillId, entries.length,
        );
      }
    }

    this.histories.delete(sessionId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract agent name from a skill ID.
   * Skill IDs may be in format "agent-name/skill" or just "agent-name".
   */
  private extractAgentName(skillId: string): string {
    const slashIndex = skillId.indexOf('/');
    return slashIndex >= 0 ? skillId.slice(0, slashIndex) : skillId;
  }

  /**
   * Extract requester ID from session history.
   * SessionMessage does not carry requester_id directly, so we return
   * 'requester' when any requester message exists, 'unknown' otherwise.
   */
  private extractRequesterId(history: SessionMessage[]): string {
    return history.some(m => m.sender === 'requester') ? 'requester' : 'unknown';
  }

  /**
   * Read SOUL.md for an agent and cache the result.
   * Returns full content and a summary (first 10 lines + Rules section).
   */
  private readSoulMd(agentName: string): SoulContent | null {
    const cached = this.soulCache.get(agentName);
    if (cached) return cached;

    const soulPath = join(homedir(), '.openclaw', 'brains', agentName, 'SOUL.md');
    try {
      const full = readFileSync(soulPath, 'utf-8');
      const lines = full.split('\n');

      // Summary: first 10 lines + any ## Rules section
      const first10 = lines.slice(0, 10).join('\n');
      let rulesSection = '';
      const rulesIdx = lines.findIndex(l => /^##\s+Rules/i.test(l));
      if (rulesIdx >= 0) {
        const rulesEnd = lines.findIndex(
          (l, i) => i > rulesIdx && /^##\s/.test(l),
        );
        rulesSection = '\n\n' + lines.slice(
          rulesIdx, rulesEnd >= 0 ? rulesEnd : undefined,
        ).join('\n');
      }

      const result: SoulContent = { full, summary: first10 + rulesSection };
      this.soulCache.set(agentName, result);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Attempt to recall relevant memory for this session (best effort).
   * Returns null on any failure.
   *
   * @deprecated **VIOLATES ADR-024 Layer 1 (architectural privacy)** —
   * reads owner agent's main brain context at session start. Rental sessions
   * MUST NOT touch owner's main memory. New Hermes plugin path replaces this
   * with isolated subagent spawning.
   */
  private recallMemory(
    agentName: string,
    requesterId: string,
    skillId: string,
  ): string | null {
    try {
      const proc = spawnSync('openclaw', [
        'agent', '--local', '--agent', agentName,
        '--message', `Recall any relevant context about requester "${requesterId}" and skill "${skillId}". Be brief.`,
        '--json',
      ], {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      });

      if (proc.error || proc.status !== 0) return null;

      const text = this.parseRawOutput(proc);
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Write a session summary to agent memory (best effort, catch all errors).
   *
   * @deprecated **VIOLATES ADR-024 Layer 1 (architectural privacy)** —
   * writes session metadata into owner agent's main brain at session end.
   * Rental sessions MUST NOT pollute owner's main memory. New Hermes plugin
   * path uses isolated subagent which terminates without writing back.
   */
  private writeSessionSummary(
    agentName: string,
    sessionId: string,
    requesterId: string,
    skillId: string,
    messageCount: number,
  ): void {
    try {
      spawnSync('openclaw', [
        'agent', '--local', '--agent', agentName,
        '--message', `Remember: Session ${sessionId} with requester "${requesterId}" for skill "${skillId}" had ${messageCount} messages. Session ended.`,
        '--json',
      ], {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      // Best effort — silently ignore errors
    }
  }

  /**
   * Core spawnSync wrapper for OpenClaw execution.
   */
  private executeCommand(agentName: string, prompt: string, timeoutMs: number): string {
    try {
      const proc = spawnSync('openclaw', [
        'agent', '--agent', agentName, '--message', prompt, '--json', '--local',
      ], {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (proc.error) {
        // Check for timeout (SIGTERM)
        if ('signal' in proc && proc.signal === 'SIGTERM') {
          return `[OpenClaw session error: timeout after ${timeoutMs}ms]`;
        }
        return `[OpenClaw session error: ${proc.error.message}]`;
      }

      if (proc.status !== 0 && proc.status !== null) {
        const stderr = proc.stderr?.toString().trim() ?? '';
        return `[OpenClaw session error: exit code ${proc.status}${stderr ? ` — ${stderr.slice(0, 200)}` : ''}]`;
      }

      const text = this.parseRawOutput(proc);
      if (!text) {
        return '[OpenClaw session error: empty response]';
      }

      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[OpenClaw session error: ${msg}]`;
    }
  }

  /**
   * Parse raw spawnSync output from OpenClaw.
   *
   * OpenClaw writes `--json` envelope to stderr (not stdout).
   * Falls back to stdout if stderr has no JSON.
   */
  private parseRawOutput(proc: ReturnType<typeof spawnSync>): string {
    const stderrText = proc.stderr?.toString() ?? '';
    const stdoutText = proc.stdout?.toString() ?? '';

    // Try stderr first (where OpenClaw --json output lives), then stdout
    const raw = (stderrText || stdoutText).trim();
    if (!raw) return '';

    return this.parseResponse(raw);
  }

  /**
   * Parse OpenClaw response text.
   *
   * Handles two formats:
   * 1. JSON envelope: `{ payloads: [{ text, mediaUrl }], meta: {} }`
   * 2. Plain text fallback
   */
  parseResponse(raw: string): string {
    // The --json output may be preceded by log lines. Find the last top-level JSON object.
    const jsonStart = raw.lastIndexOf('\n{');
    const jsonText = jsonStart >= 0 ? raw.slice(jsonStart + 1) : raw;

    try {
      const parsed: unknown = JSON.parse(jsonText);

      if (isOpenClawJsonResponse(parsed)) {
        const texts = parsed.payloads
          .map(p => p.text)
          .filter((t): t is string => typeof t === 'string' && t.length > 0);
        return texts.join('\n\n') || '';
      }

      // Other JSON shape — extract known text fields
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        if (typeof record['response'] === 'string') return record['response'];
        if (typeof record['result'] === 'string') return record['result'];
        if (typeof record['message'] === 'string') return record['message'];
        if (typeof record['text'] === 'string') return record['text'];
      }

      return jsonText.trim();
    } catch {
      // Not JSON — return as plain text
      return raw.trim();
    }
  }

  /**
   * Build the prompt for an OpenClaw session turn.
   */
  private buildPrompt(
    skillId: string,
    message: string,
    isFirstTurn: boolean,
    agentName: string,
    requesterId: string,
    memoryContext: string | null,
    entries: ConversationEntry[],
  ): string {
    const soul = this.readSoulMd(agentName);
    const parts: string[] = [];

    if (isFirstTurn) {
      // Full SOUL.md on first turn
      if (soul) {
        parts.push(soul.full);
        parts.push('');
      }

      parts.push(`You are handling an interactive session for skill: ${skillId}`);
      parts.push(`Requester: ${requesterId}`);
      parts.push('');

      if (memoryContext) {
        parts.push(`[Recalled context]\n${memoryContext}`);
        parts.push('');
      }

      parts.push(`The user says: ${message}`);
      parts.push('');
      parts.push('Respond helpfully. Ask clarifying questions when needed.');
    } else {
      // Summary on subsequent turns
      if (soul) {
        parts.push(soul.summary);
        parts.push('');
      }

      parts.push(`Continuing session for skill: ${skillId}`);
      parts.push('');
      parts.push('Conversation so far:');

      // All entries except the last one (which is the current user message)
      for (const entry of entries.slice(0, -1)) {
        const label = entry.role === 'user' ? 'User' : 'Assistant';
        parts.push(`${label}: ${entry.content}`);
      }

      parts.push('');
      parts.push(`User: ${message}`);
      parts.push('');
      parts.push('Respond to the latest message.');
    }

    return parts.join('\n');
  }
}
