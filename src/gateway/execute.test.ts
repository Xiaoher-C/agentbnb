/**
 * Tests for executeCapabilityRequest — onProgress wiring to skillExecutor.execute.
 * Verifies the relay-to-executor progress bridge is correctly threaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('better-sqlite3');

vi.mock('../registry/store.js', () => ({
  getCard: vi.fn(),
  updateReputation: vi.fn(),
}));

vi.mock('../credit/ledger.js', () => ({
  getBalance: vi.fn(),
}));

vi.mock('../credit/escrow.js', () => ({
  holdEscrow: vi.fn(),
  settleEscrow: vi.fn(),
  releaseEscrow: vi.fn(),
}));

vi.mock('../registry/request-log.js', () => ({
  insertRequestLog: vi.fn(),
}));

vi.mock('../credit/signing.js', () => ({
  verifyEscrowReceipt: vi.fn(),
}));

vi.mock('../credit/settlement.js', () => ({
  settleProviderEarning: vi.fn(),
}));

// ── Import after mocking ─────────────────────────────────────────────────────

import { executeCapabilityRequest } from './execute.js';
import { getCard, updateReputation } from '../registry/store.js';
import { getBalance } from '../credit/ledger.js';
import { holdEscrow, settleEscrow } from '../credit/escrow.js';
import { insertRequestLog } from '../registry/request-log.js';
import type { ProgressCallback } from '../skills/executor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A minimal fake CapabilityCard (v2 with skills array) */
const makeCard = () => ({
  id: 'card-1',
  owner: 'owner-alice',
  name: 'Test Card',
  description: 'Test',
  spec_version: '1.0',
  level: 1 as const,
  skills: [
    {
      id: 'skill-1',
      name: 'Test Skill',
      description: 'Does a thing',
      level: 1 as const,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
    },
  ],
  inputs: [],
  outputs: [],
  pricing: { credits_per_call: 5 },
  availability: { online: true },
});

/** Fake Database handle — no real SQLite needed */
const fakeDb = {} as Database;

/** A minimal mock SkillExecutor */
function makeMockExecutor(overrides?: { execute?: ReturnType<typeof vi.fn> }) {
  return {
    execute: overrides?.execute ?? vi.fn().mockResolvedValue({
      success: true,
      result: { answer: 42 },
      latency_ms: 10,
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('executeCapabilityRequest — onProgress wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: card exists, enough credits, escrow works
    vi.mocked(getCard).mockReturnValue(makeCard() as ReturnType<typeof getCard>);
    vi.mocked(getBalance).mockReturnValue(100);
    vi.mocked(holdEscrow).mockReturnValue('escrow-uuid');
    vi.mocked(settleEscrow).mockReturnValue(undefined);
    vi.mocked(updateReputation).mockReturnValue(undefined);
  });

  it('passes onProgress to skillExecutor.execute when provided', async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      success: true,
      result: { answer: 42 },
      latency_ms: 10,
    });
    const mockExecutor = makeMockExecutor({ execute: executeSpy });
    const onProgress: ProgressCallback = vi.fn();

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      skillId: 'skill-1',
      params: { input: 'hello' },
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
      onProgress,
    });

    expect(executeSpy).toHaveBeenCalledOnce();
    // Third argument must be the onProgress callback
    const [calledSkillId, calledParams, calledOnProgress] = executeSpy.mock.calls[0] as [string, Record<string, unknown>, ProgressCallback | undefined];
    expect(calledSkillId).toBe('skill-1');
    expect(calledParams).toEqual({ input: 'hello' });
    expect(calledOnProgress).toBe(onProgress);
  });

  it('works without onProgress — backward compatible', async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      success: true,
      result: { data: 'ok' },
      latency_ms: 5,
    });
    const mockExecutor = makeMockExecutor({ execute: executeSpy });

    const result = await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: { input: 'world' },
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
      // onProgress intentionally omitted
    });

    expect(result.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledOnce();
    // Third argument must be undefined
    const [, , calledOnProgress] = executeSpy.mock.calls[0] as [string, Record<string, unknown>, ProgressCallback | undefined];
    expect(calledOnProgress).toBeUndefined();
  });

  it('does not crash on handlerUrl path when onProgress is provided', async () => {
    // The handlerUrl path ignores onProgress — just making sure there's no explosion
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: 'done' }), { status: 200 }),
    );
    const onProgress: ProgressCallback = vi.fn();

    const result = await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: {},
      requester: 'requester-bob',
      handlerUrl: 'http://localhost:9999/handle',
      onProgress,
    });

    expect(result.success).toBe(true);
    // onProgress should NOT have been called on the handlerUrl path
    expect(onProgress).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

// ── failure_reason wiring tests (Plan 51-01) ─────────────────────────────────

describe('executeCapabilityRequest — failure_reason field', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCard).mockReturnValue(makeCard() as ReturnType<typeof getCard>);
    vi.mocked(getBalance).mockReturnValue(100);
    vi.mocked(holdEscrow).mockReturnValue('escrow-uuid');
    vi.mocked(settleEscrow).mockReturnValue(undefined);
    vi.mocked(updateReputation).mockReturnValue(undefined);
  });

  it('stores failure_reason: bad_execution when skillExecutor returns failure', async () => {
    const mockExecutor = makeMockExecutor({
      execute: vi.fn().mockResolvedValue({
        success: false,
        error: 'Something went wrong',
        latency_ms: 20,
      }),
    });

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      skillId: 'skill-1',
      params: {},
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
    });

    const calls = vi.mocked(insertRequestLog).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const logEntry = calls[calls.length - 1]![1];
    expect(logEntry.failure_reason).toBe('bad_execution');
  });

  it('stores failure_reason: timeout when handlerUrl fetch times out (AbortError)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('The operation was aborted');
      (err as Error & { name: string }).name = 'AbortError';
      return Promise.reject(err);
    });

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: {},
      requester: 'requester-bob',
      handlerUrl: 'http://localhost:9999/handle',
      timeoutMs: 1,
    });

    const calls = vi.mocked(insertRequestLog).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const logEntry = calls[calls.length - 1]![1];
    expect(logEntry.failure_reason).toBe('timeout');

    fetchSpy.mockRestore();
  });

  it('stores failure_reason: not_found when no skills are registered on the provider', async () => {
    // Card with no skills[] array (v1.0 card) so resolvedSkillId remains undefined,
    // forcing the fallback to listSkills() which returns [] — triggering 'not_found'.
    const v1Card = {
      id: 'card-1',
      owner: 'owner-alice',
      name: 'Test Card',
      description: 'Test',
      spec_version: '1.0',
      level: 1 as const,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      // no skills[] array
    };
    vi.mocked(getCard).mockReturnValue(v1Card as ReturnType<typeof getCard>);

    const mockExecutor = {
      execute: vi.fn(),
      listSkills: vi.fn().mockReturnValue([]),
    };

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      // no skillId — forces listSkills() path
      params: {},
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
    });

    const calls = vi.mocked(insertRequestLog).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const logEntry = calls[calls.length - 1]![1];
    expect(logEntry.failure_reason).toBe('not_found');
  });

  it('stores failure_reason: bad_execution when handler returns non-ok status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: {},
      requester: 'requester-bob',
      handlerUrl: 'http://localhost:9999/handle',
    });

    const calls = vi.mocked(insertRequestLog).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const logEntry = calls[calls.length - 1]![1];
    expect(logEntry.failure_reason).toBe('bad_execution');

    fetchSpy.mockRestore();
  });
});

// ── Phase 54: FailureReason reputation protection ────────────────────────────

describe('executeCapabilityRequest — reputation protection for non-quality failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCard).mockReturnValue(makeCard() as ReturnType<typeof getCard>);
    vi.mocked(getBalance).mockReturnValue(100);
    vi.mocked(holdEscrow).mockReturnValue('escrow-uuid');
    vi.mocked(settleEscrow).mockReturnValue(undefined);
    vi.mocked(updateReputation).mockReturnValue(undefined);
  });

  it('calls updateReputation on bad_execution failure', async () => {
    const mockExecutor = makeMockExecutor({
      execute: vi.fn().mockResolvedValue({
        success: false,
        error: 'Skill failed',
        latency_ms: 20,
      }),
    });

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      skillId: 'skill-1',
      params: {},
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
    });

    expect(updateReputation).toHaveBeenCalledWith(fakeDb, 'card-1', false, 20);
  });

  it('does NOT call updateReputation on timeout failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('The operation was aborted');
      (err as Error & { name: string }).name = 'AbortError';
      return Promise.reject(err);
    });

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: {},
      requester: 'requester-bob',
      handlerUrl: 'http://localhost:9999/handle',
      timeoutMs: 1,
    });

    expect(updateReputation).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('does NOT call updateReputation on not_found failure', async () => {
    const v1Card = {
      id: 'card-1',
      owner: 'owner-alice',
      name: 'Test Card',
      description: 'Test',
      spec_version: '1.0',
      level: 1 as const,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
    };
    vi.mocked(getCard).mockReturnValue(v1Card as ReturnType<typeof getCard>);

    const mockExecutor = {
      execute: vi.fn(),
      listSkills: vi.fn().mockReturnValue([]),
    };

    await executeCapabilityRequest({
      registryDb: fakeDb,
      creditDb: fakeDb,
      cardId: 'card-1',
      params: {},
      requester: 'requester-bob',
      skillExecutor: mockExecutor as unknown as import('../skills/executor.js').SkillExecutor,
    });

    expect(updateReputation).not.toHaveBeenCalled();
  });
});
