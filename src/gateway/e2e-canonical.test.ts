/**
 * E2E Canonical Regression Tests — AgentBnB transaction flow.
 *
 * These tests lock in the M5 successful chain:
 *   requester → provider → escrow hold → execute → settle → request_log
 *
 * All tests are in-process (no real HTTP). Uses real in-memory SQLite databases
 * to catch regressions that mocks would miss.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { generateKeyPair, signEscrowReceipt } from '../credit/signing.js';
import { createSignedEscrowReceipt } from '../credit/escrow-receipt.js';
import { getRequestLog } from '../registry/request-log.js';
import { executeCapabilityRequest } from './execute.js';
import type { CapabilityCardV2, EscrowReceipt } from '../types/index.js';
import type { SkillExecutor, ExecutionResult } from '../skills/executor.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Insert a v2 card directly into the registry DB. */
function insertCardV2(db: Database.Database, card: CapabilityCardV2): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(card.id, card.owner, JSON.stringify(card), now, now);
}

/** Creates a mock SkillExecutor that returns a fixed result. */
function mockExecutor(result: ExecutionResult): SkillExecutor {
  return {
    execute: async () => result,
    listSkills: () => ['test-skill'],
    registerMode: () => {},
    loadSkillConfigs: async () => {},
  } as unknown as SkillExecutor;
}

const PROVIDER = 'agent-provider';
const REQUESTER = 'agent-requester';
const CARD_ID = '00000000-0000-4000-a000-000000000099';
const SKILL_ID = 'test-skill';

const TEST_CARD: CapabilityCardV2 = {
  spec_version: '2.0',
  id: CARD_ID,
  owner: PROVIDER,
  agent_name: 'Test Provider',
  skills: [
    {
      id: SKILL_ID,
      name: 'Test Skill',
      description: 'Does a thing',
      level: 1,
      inputs: [{ name: 'task', type: 'text', required: true }],
      outputs: [{ name: 'result', type: 'text', required: false }],
      pricing: { credits_per_call: 5 },
    },
  ],
  availability: { online: true },
};

const SUCCESS_RESULT: ExecutionResult = {
  success: true,
  result: { output: 'done' },
  latency_ms: 10,
};

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('E2E Canonical Transaction Flow', () => {
  let providerRegistryDb: Database.Database;
  let providerCreditDb: Database.Database;
  let requesterCreditDb: Database.Database;
  let requesterKeys: ReturnType<typeof generateKeyPair>;

  beforeEach(() => {
    providerRegistryDb = openDatabase(':memory:');
    providerCreditDb = openCreditDb(':memory:');
    requesterCreditDb = openCreditDb(':memory:');

    bootstrapAgent(providerCreditDb, PROVIDER, 0);
    bootstrapAgent(requesterCreditDb, REQUESTER, 20);

    requesterKeys = generateKeyPair();

    insertCardV2(providerRegistryDb, TEST_CARD);
  });

  // ── Scenario 1: Full canonical flow ─────────────────────────────────────────

  it('scenario 1: requester → provider → escrow hold → execute → settle', async () => {
    const { receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: REQUESTER, amount: 5, cardId: CARD_ID, skillId: SKILL_ID },
    );

    expect(getBalance(requesterCreditDb, REQUESTER)).toBe(20); // voucher used for hold, balance unchanged

    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      skillId: SKILL_ID,
      params: { task: 'echo hello' },
      requester: REQUESTER,
      escrowReceipt: receipt,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.result as Record<string, unknown>).receipt_settled).toBe(true);
    }

    // Provider earned 5 credits (5% fee rounds to 0)
    expect(getBalance(providerCreditDb, PROVIDER)).toBe(5);

    // request_log has one success entry
    const logs = getRequestLog(providerRegistryDb, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('success');
    expect(logs[0]!.credits_charged).toBe(5);
    expect(logs[0]!.requester).toBe(REQUESTER);
  });

  // ── Scenario 2: No skill_id → fallback to first skill ───────────────────────

  it('scenario 2: no skill_id provided → fallback to listSkills()[0]', async () => {
    bootstrapAgent(providerCreditDb, REQUESTER, 20); // requester on provider DB for local path

    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      skillId: undefined, // omitted
      params: { task: 'fallback test' },
      requester: REQUESTER,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(true);
    const logs = getRequestLog(providerRegistryDb, 10);
    expect(logs[0]!.skill_id).toBe(SKILL_ID); // resolved to first skill
  });

  // ── Scenario 3: Self-request guard ──────────────────────────────────────────

  it('scenario 3: self-request guard blocks requester === card.owner', async () => {
    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      skillId: SKILL_ID,
      params: { task: 'self-test' },
      requester: PROVIDER, // same as card.owner!
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Self-request blocked');
      expect(result.error.message).toContain('AGENTBNB_DIR');
    }
  });

  // ── Scenario 4: Expired receipt ─────────────────────────────────────────────

  it('scenario 4: expired receipt (>5 min old) → rejected', async () => {
    // Build a receipt with a backdated timestamp and sign it correctly
    // so that signature verification passes and the expiry check is reached.
    const { randomUUID } = await import('node:crypto');
    const expiredTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const receiptData = {
      requester_owner: REQUESTER,
      requester_public_key: requesterKeys.publicKey.toString('hex'),
      amount: 5,
      card_id: CARD_ID,
      timestamp: expiredTimestamp,
      nonce: randomUUID(),
    };
    const signature = signEscrowReceipt(receiptData, requesterKeys.privateKey);
    const expiredReceipt: EscrowReceipt = { ...receiptData, signature };

    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      params: { task: 'expired test' },
      requester: REQUESTER,
      escrowReceipt: expiredReceipt,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('expired');
    }
  });

  // ── Scenario 5: Wrong signature ──────────────────────────────────────────────

  it('scenario 5: tampered receipt signature → rejected', async () => {
    const { receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: REQUESTER, amount: 5, cardId: CARD_ID },
    );

    const wrongKeys = generateKeyPair();
    const tamperedReceipt: EscrowReceipt = {
      ...receipt,
      // Valid receipt but signed with a different key → signature won't verify
      requester_public_key: wrongKeys.publicKey.toString('hex'),
    };

    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      params: { task: 'tampered test' },
      requester: REQUESTER,
      escrowReceipt: tamperedReceipt,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Invalid escrow receipt');
    }
  });

  // ── Scenario 6: Local card path — requester field must deduct correct balance ─

  it('scenario 6 (M5 regression): local card path deducts balance from requester, not provider', async () => {
    // Local path: no escrow receipt — credits are held from creditDb directly
    // The requester's credits are in providerCreditDb here (simulating shared-DB local mode)
    bootstrapAgent(providerCreditDb, REQUESTER, 20);

    const balanceBefore = getBalance(providerCreditDb, REQUESTER);
    expect(balanceBefore).toBe(20);

    const result = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      skillId: SKILL_ID,
      params: { task: 'local path test' },
      requester: REQUESTER, // must be used for escrow hold, not PROVIDER
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(result.success).toBe(true);

    // Requester's voucher used (balance unchanged), provider received 5 + 5 bonus (2x first provider)
    expect(getBalance(providerCreditDb, REQUESTER)).toBe(20);
    expect(getBalance(providerCreditDb, PROVIDER)).toBe(10);

    // request_log requester field is correct
    const logs = getRequestLog(providerRegistryDb, 10);
    expect(logs[0]!.requester).toBe(REQUESTER); // not PROVIDER
    expect(logs[0]!.credits_charged).toBe(5);
  });

  // ── Scenario 7: Local vs remote card — requester-side lifecycle parity ───────

  it('scenario 7: local path and remote-receipt path both settle and log correctly', async () => {
    // ── Local path ──────────────────────────────────────────────────────────────
    const localRegistryDb = openDatabase(':memory:');
    const localCreditDb = openCreditDb(':memory:');
    bootstrapAgent(localCreditDb, PROVIDER, 0);
    bootstrapAgent(localCreditDb, REQUESTER, 20);
    insertCardV2(localRegistryDb, TEST_CARD);

    const localResult = await executeCapabilityRequest({
      registryDb: localRegistryDb,
      creditDb: localCreditDb,
      cardId: CARD_ID,
      skillId: SKILL_ID,
      params: { task: 'local' },
      requester: REQUESTER,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(localResult.success).toBe(true);
    // Voucher used for hold, balance unchanged
    expect(getBalance(localCreditDb, REQUESTER)).toBe(20);
    // Provider gets 5 + 5 bonus (2x first provider), fee rounds to 0
    expect(getBalance(localCreditDb, PROVIDER)).toBe(10);
    const localLogs = getRequestLog(localRegistryDb, 10);
    expect(localLogs[0]!.status).toBe('success');
    expect(localLogs[0]!.credits_charged).toBe(5);

    localRegistryDb.close();
    localCreditDb.close();

    // ── Remote receipt path ─────────────────────────────────────────────────────
    const { receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: REQUESTER, amount: 5, cardId: CARD_ID, skillId: SKILL_ID },
    );

    const remoteResult = await executeCapabilityRequest({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      cardId: CARD_ID,
      skillId: SKILL_ID,
      params: { task: 'remote' },
      requester: REQUESTER,
      escrowReceipt: receipt,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    expect(remoteResult.success).toBe(true);
    if (remoteResult.success) {
      expect((remoteResult.result as Record<string, unknown>).receipt_settled).toBe(true);
    }
    const remoteLogs = getRequestLog(providerRegistryDb, 10);
    expect(remoteLogs[0]!.status).toBe('success');
    expect(remoteLogs[0]!.credits_charged).toBe(5);

    // Both paths: same observable outcome (success + log entry + credits accounted)
  });

  // ── Scenario 8: Remote discovery + provider API quota exhausted + escrow refund ─

  it('scenario 8: provider external API failure → escrow released, credits refunded, failure logged', async () => {
    // This locks in the M5 network test regression path:
    //   requester discovers card from remote registry
    //   provider skill executor fails (e.g. Alpha Vantage rate-limit)
    //   escrow is released and credits refunded to requester
    //   request_log records status=failure

    const REMOTE_PROVIDER = 'agent-genesis-bot';
    const REMOTE_REQUESTER = 'agent-requester-external';
    const REMOTE_CARD_ID = 'f8ba0aec-0000-4000-a000-000000000099';
    const REMOTE_SKILL = 'deep-stock-analyst';
    const COST = 15;

    const remoteRegistryDb = openDatabase(':memory:');
    const remoteCreditDb = openCreditDb(':memory:');

    bootstrapAgent(remoteCreditDb, REMOTE_PROVIDER, 0);
    bootstrapAgent(remoteCreditDb, REMOTE_REQUESTER, 50);

    const remoteCard: CapabilityCardV2 = {
      spec_version: '2.0',
      id: REMOTE_CARD_ID,
      owner: REMOTE_PROVIDER,
      name: 'genesis-bot',
      description: 'Deep stock analysis',
      level: 2,
      skills: [{
        id: REMOTE_SKILL,
        name: 'Deep Stock Analyst Pro',
        description: 'Quantitative stock analysis',
        level: 2,
        inputs: [{ name: 'ticker', type: 'text', required: true }],
        outputs: [{ name: 'analysis', type: 'json', required: true }],
        pricing: { credits_per_call: COST },
      }],
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: COST },
      availability: { online: true },
    };
    insertCardV2(remoteRegistryDb, remoteCard);

    // Provider skill executor fails — simulates external API quota exhausted
    const quotaExhaustedExecutor = mockExecutor({
      success: false,
      error: '[rate-limit] Alpha Vantage rate limit hit: standard API rate limit is 25 requests per day.',
      latency_ms: 50,
    });

    const result = await executeCapabilityRequest({
      registryDb: remoteRegistryDb,
      creditDb: remoteCreditDb,
      cardId: REMOTE_CARD_ID,
      skillId: REMOTE_SKILL,
      params: { ticker: 'PLTR', depth: 'deep', style: 'growth' },
      requester: REMOTE_REQUESTER,
      skillExecutor: quotaExhaustedExecutor,
    });

    // Execution fails
    expect(result.success).toBe(false);

    // Voucher was used for hold (15 <= 50), release refunds to balance: 50 + 15 = 65
    expect(getBalance(remoteCreditDb, REMOTE_REQUESTER)).toBe(65);
    expect(getBalance(remoteCreditDb, REMOTE_PROVIDER)).toBe(0);

    // request_log records failure
    const logs = getRequestLog(remoteRegistryDb, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('failure');
    expect(logs[0]!.skill_id).toBe(REMOTE_SKILL);
    expect(logs[0]!.credits_charged).toBe(0);
    expect(logs[0]!.requester).toBe(REMOTE_REQUESTER);

    remoteRegistryDb.close();
    remoteCreditDb.close();
  });
});
