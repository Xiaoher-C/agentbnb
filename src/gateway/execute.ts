import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getCard, updateReputation } from '../registry/store.js';
import { getBalance } from '../credit/ledger.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import { insertRequestLog } from '../registry/request-log.js';
import { verifyEscrowReceipt } from '../credit/signing.js';
import { settleProviderEarning } from '../credit/settlement.js';
import { AgentBnBError } from '../types/index.js';
import type { CapabilityCardV2, EscrowReceipt } from '../types/index.js';
import type { SkillExecutor, ProgressCallback } from '../skills/executor.js';

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
  } = opts;

  // Look up card in registry
  const card = getCard(registryDb, cardId);
  if (!card) {
    return { success: false, error: { code: -32602, message: `Card not found: ${cardId}` } };
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

  if (receipt) {
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

  // Helper: log request and handle escrow on failure
  const handleFailure = (status: 'failure' | 'timeout', latencyMs: number, message: string): ExecuteResult => {
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
    const targetSkillId = resolvedSkillId ?? skillId ?? cardId;

    try {
      const execResult = await skillExecutor.execute(targetSkillId, params, onProgress);
      if (!execResult.success) {
        return handleFailure('failure', execResult.latency_ms, execResult.error ?? 'Execution failed');
      }
      return handleSuccess(execResult.result, execResult.latency_ms);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution error';
      return handleFailure('failure', Date.now() - startMs, message);
    }
  }

  // ── Legacy handlerUrl path ──────────────────────────────────────────────────
  if (!handlerUrl) {
    return handleFailure('failure', Date.now() - startMs, 'No skill executor or handler URL configured');
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
      return handleFailure('failure', Date.now() - startMs, `Handler returned ${response.status}`);
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
    );
  }
}
