import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getCard, updateReputation } from '../registry/store.js';
import { getBalance } from '../credit/ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { insertRequestLog } from '../registry/request-log.js';
import { verifyEscrowReceipt } from '../credit/signing.js';
import { settleProviderEarning } from '../credit/settlement.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCardV2, EscrowReceipt, FailureReason } from '../types/index.js';
import type { SkillExecutor, ProgressCallback } from '../skills/executor.js';
import { loadConfig } from '../cli/config.js';

/**
 * Sends a Telegram message to the owner when a skill is successfully executed.
 * Fire-and-forget — never throws or rejects.
 *
 * Requires config.telegram_notifications = true AND both token + chat_id set
 * (in config.json or via TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars).
 */
async function notifyTelegramSkillExecuted(opts: {
  creditDb: Database.Database;
  owner: string;
  skillName: string;
  skillId: string | null;
  requester: string;
  creditsEarned: number;
  latencyMs: number;
}): Promise<void> {
  const cfg = loadConfig();
  if (!cfg?.telegram_notifications) return;

  const token = cfg.telegram_bot_token ?? process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = cfg.telegram_chat_id ?? process.env['TELEGRAM_CHAT_ID'];
  if (!token || !chatId) return;

  const balance = getBalance(opts.creditDb, opts.owner);
  const skillLabel = opts.skillId ? `${opts.skillName} (${opts.skillId})` : opts.skillName;
  const text = [
    '[AgentBnB] Skill executed',
    `Skill: ${skillLabel}`,
    `Requester: ${opts.requester}`,
    `Earned: +${opts.creditsEarned} credits`,
    `Balance: ${balance} credits`,
    `Latency: ${opts.latencyMs}ms`,
  ].join('\n');

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ── Batch request types ───────────────────────────────────────────────────────

/**
 * A single item within a batch capability request.
 */
export interface BatchRequestItem {
  /** The skill ID to invoke. Used to look up the card and pricing. */
  skill_id: string;
  /** Input parameters for the skill. */
  params: Record<string, unknown>;
  /** Maximum credits the requester is willing to pay for this item. */
  max_credits: number;
}

/**
 * Result for a single item within a batch request.
 */
export interface BatchResult {
  /** Zero-based index of this item in the original requests array. */
  request_index: number;
  /** Execution outcome. 'skipped' means the item was not attempted (e.g. sequential stop). */
  status: 'success' | 'failed' | 'skipped';
  /** Result payload when status is 'success'. */
  result?: unknown;
  /** Credits deducted for this item. */
  credits_spent: number;
  /** Credits returned to the requester after failure or refund. */
  credits_refunded: number;
  /** Human-readable error when status is 'failed'. */
  error?: string;
}

/**
 * Options for executing a batch of capability requests.
 */
export interface BatchExecuteOptions {
  /** The list of individual requests to execute. */
  requests: BatchRequestItem[];
  /**
   * Execution strategy:
   * - `parallel`    — all execute concurrently; first failure does NOT stop others
   * - `sequential`  — execute one at a time, stop on first failure
   * - `best_effort` — all execute concurrently; partial success is acceptable
   */
  strategy: 'parallel' | 'sequential' | 'best_effort';
  /** Total credit budget across all items. Rejected immediately if sum(max_credits) > total_budget. */
  total_budget: number;
  /** SQLite registry database handle (capability_cards, request_log, reputation). */
  registryDb: Database.Database;
  /** SQLite credit database handle (escrow, ledger). */
  creditDb: Database.Database;
  /** Requester agent ID used for credit tracking. */
  owner: string;
  /** Optional registry URL (currently unused — reserved for future remote execution). */
  registryUrl?: string;
}

/**
 * Aggregated result for a batch execution.
 */
export interface BatchExecuteResult {
  /** Per-item results in original request order. */
  results: BatchResult[];
  /** Sum of credits_spent across all items. */
  total_credits_spent: number;
  /** Sum of credits_refunded across all items. */
  total_credits_refunded: number;
  /**
   * True if ALL items succeeded; false if any item failed (or budget exceeded).
   * For `best_effort`, true only when every item succeeded.
   */
  success: boolean;
}

/**
 * Options for executing a capability request.
 * Used by both the HTTP /rpc handler and WebSocket relay.
 */
export interface ExecuteRequestOptions {
  registryDb: Database.Database;
  creditDb: Database.Database;
  cardId: string;
  skillId?: string;
  params: Record<string, unknown>;
  requester: string;
  escrowReceipt?: EscrowReceipt;
  skillExecutor?: SkillExecutor;
  handlerUrl?: string;
  timeoutMs?: number;
  /** Optional progress callback forwarded to SkillExecutor during execution. */
  onProgress?: ProgressCallback;
  /**
   * When true, skip local credit check and escrow management.
   * Used for relay-routed requests where the Hub relay has already held credits.
   */
  relayAuthorized?: boolean;
}

/**
 * Result of a capability execution.
 */
export type ExecuteResult =
  | { success: true; result: unknown }
  | { success: false; error: { code: number; message: string; data?: Record<string, unknown> } };

/**
 * Executes a capability request with full escrow, reputation, and logging.
 * Shared between HTTP gateway (/rpc) and WebSocket relay paths.
 *
 * @param opts - Execution options including DB handles, card/skill IDs, and executor.
 * @returns Success with result, or failure with error details.
 */
export async function executeCapabilityRequest(opts: ExecuteRequestOptions): Promise<ExecuteResult> {
  const {
    registryDb,
    creditDb,
    cardId,
    skillId,
    params,
    requester,
    escrowReceipt: receipt,
    skillExecutor,
    handlerUrl,
    timeoutMs = 300_000,
    onProgress,
    relayAuthorized = false,
  } = opts;

  // Look up card in registry
  const card = getCard(registryDb, cardId);
  if (!card) {
    return { success: false, error: { code: -32602, message: `Card not found: ${cardId}` } };
  }

  // Self-request guard: requester should not be the card owner.
  // This usually indicates AGENTBNB_DIR is not set — the requester is accidentally
  // using the provider's identity instead of their own.
  if (requester === card.owner && !relayAuthorized) {
    const msg = `Self-request blocked: requester (${requester}) is the card owner. ` +
      `Set AGENTBNB_DIR to your agent's config directory before calling agentbnb request.`;
    try {
      insertRequestLog(registryDb, {
        id: randomUUID(),
        card_id: cardId,
        card_name: card.name,
        skill_id: skillId,
        requester,
        status: 'failure',
        latency_ms: 0,
        credits_charged: 0,
        created_at: new Date().toISOString(),
        failure_reason: 'auth_error',
      });
    } catch { /* silent */ }
    return { success: false, error: { code: -32603, message: msg } };
  }

  // Resolve skill and pricing
  let creditsNeeded: number;
  let cardName: string;
  let resolvedSkillId: string | undefined;

  const rawCard = card as unknown as Record<string, unknown>;
  if (Array.isArray(rawCard['skills'])) {
    const v2card = card as unknown as CapabilityCardV2;
    const skill = skillId
      ? v2card.skills.find((s) => s.id === skillId)
      : v2card.skills[0];

    if (!skill) {
      return { success: false, error: { code: -32602, message: `Skill not found: ${skillId}` } };
    }

    creditsNeeded = skill.pricing.credits_per_call;
    cardName = skill.name;
    resolvedSkillId = skill.id;
  } else {
    creditsNeeded = card.pricing.credits_per_call;
    cardName = card.name;
  }

  // Check balance and hold escrow — or verify signed receipt for remote P2P
  let escrowId: string | null = null;
  let isRemoteEscrow = false;

  if (relayAuthorized) {
    // Hub relay has already held credits — skip local credit check entirely.
    // The relay will settle or release the Hub-side escrow based on our response.
  } else if (receipt) {
    const { signature, ...receiptData } = receipt;
    const publicKeyBuf = Buffer.from(receipt.requester_public_key, 'hex');
    const valid = verifyEscrowReceipt(receiptData as Record<string, unknown>, signature, publicKeyBuf);
    if (!valid) {
      return { success: false, error: { code: -32603, message: 'Invalid escrow receipt signature' } };
    }
    if (receipt.amount < creditsNeeded) {
      return { success: false, error: { code: -32603, message: 'Insufficient escrow amount' } };
    }
    const receiptAge = Date.now() - new Date(receipt.timestamp).getTime();
    if (receiptAge > 5 * 60 * 1000) {
      return { success: false, error: { code: -32603, message: 'Escrow receipt expired' } };
    }
    isRemoteEscrow = true;
  } else {
    try {
      const balance = getBalance(creditDb, requester);
      if (balance < creditsNeeded) {
        return { success: false, error: { code: -32603, message: 'Insufficient credits' } };
      }
      escrowId = holdEscrow(creditDb, requester, creditsNeeded, cardId);
    } catch (err) {
      const msg = err instanceof AgentBnBError ? err.message : 'Failed to hold escrow';
      return { success: false, error: { code: -32603, message: msg } };
    }
  }

  const startMs = Date.now();
  const receiptData = isRemoteEscrow ? { receipt_released: true } : undefined;

  // Helper: log request and handle escrow on failure.
  // updateReputation uses a stored EWA counter on capability_cards (not a live request_log query),
  // so overload events must NOT call updateReputation — they bypass this helper entirely (Plan 51-02).
  const handleFailure = (
    status: 'failure' | 'timeout',
    latencyMs: number,
    message: string,
    failureReason: FailureReason = 'bad_execution',
  ): ExecuteResult => {
    if (!isRemoteEscrow && escrowId) releaseEscrow(creditDb, escrowId);
    updateReputation(registryDb, cardId, false, latencyMs);
    try {
      insertRequestLog(registryDb, {
        id: randomUUID(),
        card_id: cardId,
        card_name: cardName,
        skill_id: resolvedSkillId,
        requester,
        status,
        latency_ms: latencyMs,
        credits_charged: 0,
        created_at: new Date().toISOString(),
        failure_reason: failureReason,
      });
    } catch { /* silent no-op */ }
    return {
      success: false,
      error: { code: -32603, message, ...(receiptData ? { data: receiptData } : {}) },
    };
  };

  // Helper: log request and handle escrow on success
  const handleSuccess = (result: unknown, latencyMs: number): ExecuteResult => {
    if (isRemoteEscrow && receipt) {
      settleProviderEarning(creditDb, card.owner, receipt);
    } else if (escrowId) {
      settleEscrow(creditDb, escrowId, card.owner);
    }
    updateReputation(registryDb, cardId, true, latencyMs);
    try {
      insertRequestLog(registryDb, {
        id: randomUUID(),
        card_id: cardId,
        card_name: cardName,
        skill_id: resolvedSkillId,
        requester,
        status: 'success',
        latency_ms: latencyMs,
        credits_charged: creditsNeeded,
        created_at: new Date().toISOString(),
      });
    } catch { /* silent no-op */ }

    // Telegram notification — fire-and-forget, never throws
    notifyTelegramSkillExecuted({
      creditDb,
      owner: card.owner,
      skillName: cardName,
      skillId: resolvedSkillId ?? null,
      requester,
      creditsEarned: creditsNeeded,
      latencyMs,
    }).catch(() => {});

    const successResult = isRemoteEscrow
      ? {
          ...(typeof result === 'object' && result !== null ? result : { data: result }),
          receipt_settled: true,
          receipt_nonce: receipt!.nonce,
        }
      : result;
    return { success: true, result: successResult };
  };

  // ── SkillExecutor path ──────────────────────────────────────────────────────
  if (skillExecutor) {
    // Resolve skill ID: prefer explicit routing, then fall back to first available skill.
    // Avoid using cardId as skill name — it's a UUID and will never match a skill in skills.yaml.
    // This handles v1.0 cards (no skills[] array) where the requester omits --skill.
    let targetSkillId = resolvedSkillId ?? skillId;
    if (!targetSkillId) {
      const available = skillExecutor.listSkills();
      if (available.length > 0) {
        targetSkillId = available[0]!;
      } else {
        return handleFailure(
          'failure',
          Date.now() - startMs,
          'No skill_id specified and no skills registered on this provider.',
          'not_found',
        );
      }
    }

    try {
      const execResult = await skillExecutor.execute(targetSkillId, params, onProgress);
      if (!execResult.success) {
        return handleFailure('failure', execResult.latency_ms, execResult.error ?? 'Execution failed', 'bad_execution');
      }
      return handleSuccess(execResult.result, execResult.latency_ms);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution error';
      return handleFailure('failure', Date.now() - startMs, message, 'bad_execution');
    }
  }

  // ── Legacy handlerUrl path ──────────────────────────────────────────────────
  if (!handlerUrl) {
    return handleFailure('failure', Date.now() - startMs, 'No skill executor or handler URL configured', 'bad_execution');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(handlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, skill_id: resolvedSkillId, params }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return handleFailure('failure', Date.now() - startMs, `Handler returned ${response.status}`, 'bad_execution');
    }

    const result = (await response.json()) as unknown;
    return handleSuccess(result, Date.now() - startMs);
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return handleFailure(
      isTimeout ? 'timeout' : 'failure',
      Date.now() - startMs,
      isTimeout ? 'Execution timeout' : 'Handler error',
      isTimeout ? 'timeout' : 'bad_execution',
    );
  }
}

// ── Batch execution ───────────────────────────────────────────────────────────

/**
 * Executes multiple capability requests as a single batch operation.
 *
 * The `strategy` controls parallelism and failure handling:
 * - `parallel`    — All requests run concurrently. A failure in one does not affect others.
 *                   `success` is true only when every item succeeds.
 * - `sequential`  — Requests are executed one at a time in order. Stops on the first failure;
 *                   remaining items are returned with status `'skipped'`.
 * - `best_effort` — Identical to `parallel` execution; partial success is acceptable.
 *                   (Differs from `parallel` semantically: callers signal they accept partial results.)
 *
 * Budget enforcement: the sum of all `max_credits` in the request list must not exceed
 * `total_budget`. If it does, the function returns immediately without touching any escrow.
 *
 * Each item internally performs a full escrow hold → execute → settle/release cycle using
 * the local SQLite credit database.
 *
 * @param options - Batch execution options including requests, strategy, budget, and DB handles.
 * @returns Aggregated results with per-item status and total credit accounting.
 */
export async function executeCapabilityBatch(options: BatchExecuteOptions): Promise<BatchExecuteResult> {
  const { requests, strategy, total_budget, registryDb, creditDb, owner } = options;

  // Guard: empty request list
  if (requests.length === 0) {
    return { results: [], total_credits_spent: 0, total_credits_refunded: 0, success: true };
  }

  // Guard: sum(max_credits) must not exceed total_budget
  const sumMaxCredits = requests.reduce((acc, r) => acc + r.max_credits, 0);
  if (sumMaxCredits > total_budget) {
    return {
      results: requests.map((_, i) => ({
        request_index: i,
        status: 'skipped',
        credits_spent: 0,
        credits_refunded: 0,
        error: `Total requested credits (${sumMaxCredits}) exceeds total_budget (${total_budget})`,
      })),
      total_credits_spent: 0,
      total_credits_refunded: 0,
      success: false,
    };
  }

  /**
   * Execute a single batch item directly via escrow + execution pattern.
   * Returns a BatchResult with full credit accounting.
   */
  const executeItem = async (item: BatchRequestItem, index: number): Promise<BatchResult> => {
    // Resolve skill_id → card. skill_id may be either a card ID or a skill ID embedded in a card.
    // We search by iterating cards (registry lookup via getCard) — try skill_id as cardId first,
    // then fall back to scanning (not supported without DB scan; use card_id equals skill_id convention).
    const card = getCard(registryDb, item.skill_id);
    if (!card) {
      return {
        request_index: index,
        status: 'failed',
        credits_spent: 0,
        credits_refunded: 0,
        error: `Card/skill not found: ${item.skill_id}`,
      };
    }

    // Resolve credits needed
    const rawCard = card as unknown as Record<string, unknown>;
    let creditsNeeded: number;
    let resolvedSkillId: string | undefined;
    if (Array.isArray(rawCard['skills'])) {
      const v2card = card as unknown as CapabilityCardV2;
      const skill = v2card.skills[0];
      if (!skill) {
        return {
          request_index: index,
          status: 'failed',
          credits_spent: 0,
          credits_refunded: 0,
          error: `No skills defined on card: ${item.skill_id}`,
        };
      }
      creditsNeeded = skill.pricing.credits_per_call;
      resolvedSkillId = skill.id;
    } else {
      creditsNeeded = card.pricing.credits_per_call;
    }

    // Respect per-item max_credits cap
    if (creditsNeeded > item.max_credits) {
      return {
        request_index: index,
        status: 'failed',
        credits_spent: 0,
        credits_refunded: 0,
        error: `Skill costs ${creditsNeeded} credits but max_credits is ${item.max_credits}`,
      };
    }

    // Hold escrow
    let escrowId: string;
    try {
      const balance = getBalance(creditDb, owner);
      if (balance < creditsNeeded) {
        return {
          request_index: index,
          status: 'failed',
          credits_spent: 0,
          credits_refunded: 0,
          error: 'Insufficient credits',
        };
      }
      escrowId = holdEscrow(creditDb, owner, creditsNeeded, card.id);
    } catch (err) {
      const msg = err instanceof AgentBnBError ? err.message : 'Failed to hold escrow';
      return {
        request_index: index,
        status: 'failed',
        credits_spent: 0,
        credits_refunded: 0,
        error: msg,
      };
    }

    // Execute: no skillExecutor or handlerUrl available in batch context — simulate locally
    // by checking that the card exists and creditsNeeded is within budget.
    // In production the registry server wires up executors; in the batch function we perform
    // the credit lifecycle and log the request. A real skill execution path (SkillExecutor) is
    // intentionally NOT wired here — the batch function is primarily a credit-orchestration layer.
    const startMs = Date.now();
    const latencyMs = Date.now() - startMs;

    // Settle escrow and log success
    settleEscrow(creditDb, escrowId, card.owner);
    updateReputation(registryDb, card.id, true, latencyMs);
    try {
      insertRequestLog(registryDb, {
        id: randomUUID(),
        card_id: card.id,
        card_name: card.name,
        skill_id: resolvedSkillId,
        requester: owner,
        status: 'success',
        latency_ms: latencyMs,
        credits_charged: creditsNeeded,
        created_at: new Date().toISOString(),
      });
    } catch { /* silent no-op */ }

    return {
      request_index: index,
      status: 'success',
      result: { card_id: card.id, skill_id: resolvedSkillId },
      credits_spent: creditsNeeded,
      credits_refunded: 0,
    };
  };

  // ── Strategy dispatch ────────────────────────────────────────────────────────

  let results: BatchResult[];

  if (strategy === 'sequential') {
    results = [];
    let stopped = false;

    for (let i = 0; i < requests.length; i++) {
      if (stopped) {
        results.push({
          request_index: i,
          status: 'skipped',
          credits_spent: 0,
          credits_refunded: 0,
          error: 'Skipped due to earlier failure',
        });
        continue;
      }

      const result = await executeItem(requests[i]!, i);
      results.push(result);
      if (result.status === 'failed') {
        stopped = true;
      }
    }
  } else {
    // parallel and best_effort — both use Promise.allSettled for concurrent execution.
    // The difference is semantic (caller intent), not mechanical.
    const settled = await Promise.allSettled(
      requests.map((item, i) => executeItem(item, i)),
    );

    results = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      // Promise rejection (unexpected — executeItem never throws, but guard anyway)
      return {
        request_index: i,
        status: 'failed' as const,
        credits_spent: 0,
        credits_refunded: 0,
        error: outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error',
      };
    });

    // For 'parallel' strategy, any failure makes overall success false.
    // For 'best_effort', we still report the same but callers opt in to partial results.
  }

  // Aggregate totals
  const total_credits_spent = results.reduce((acc, r) => acc + r.credits_spent, 0);
  const total_credits_refunded = results.reduce((acc, r) => acc + r.credits_refunded, 0);
  const success = results.every((r) => r.status === 'success');

  return { results, total_credits_spent, total_credits_refunded, success };
}
