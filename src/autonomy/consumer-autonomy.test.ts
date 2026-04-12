/**
 * Tests for consumer-side autonomy guard.
 * Verifies budget caps, multi-skill policy, and session spend tracking.
 */

import { describe, it, expect } from 'vitest';
import {
  checkConsumerBudget,
  recordConsumerSpend,
  createSessionState,
  DEFAULT_CONSUMER_AUTONOMY,
} from './consumer-autonomy.js';
import type { ConsumerAutonomyConfig, ConsumerSessionState } from './consumer-autonomy.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ConsumerAutonomyConfig> = {}): ConsumerAutonomyConfig {
  return { ...DEFAULT_CONSUMER_AUTONOMY, ...overrides };
}

function makeSession(overrides: Partial<ConsumerSessionState> = {}): ConsumerSessionState {
  return { ...createSessionState(), ...overrides };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('checkConsumerBudget', () => {
  describe('free requests', () => {
    it('always allows free requests (cost = 0)', () => {
      const result = checkConsumerBudget(makeConfig(), makeSession({ totalSpent: 999 }), 0);
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('allows negative cost (treated as free)', () => {
      const result = checkConsumerBudget(makeConfig(), makeSession(), -5);
      expect(result.allowed).toBe(true);
    });
  });

  describe('single_request_max', () => {
    it('allows request within single_request_max', () => {
      const result = checkConsumerBudget(makeConfig({ single_request_max: 20 }), makeSession(), 15);
      expect(result.allowed).toBe(true);
    });

    it('allows request exactly at single_request_max', () => {
      const result = checkConsumerBudget(makeConfig({ single_request_max: 20 }), makeSession(), 20);
      expect(result.allowed).toBe(true);
    });

    it('blocks request exceeding single_request_max', () => {
      const result = checkConsumerBudget(makeConfig({ single_request_max: 10 }), makeSession(), 15);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('single_request_max');
      expect(result.error).toContain('15');
      expect(result.error).toContain('10');
    });
  });

  describe('session_budget', () => {
    it('allows first request within session budget', () => {
      const result = checkConsumerBudget(makeConfig({ session_budget: 50 }), makeSession(), 15);
      expect(result.allowed).toBe(true);
    });

    it('allows request when cumulative spend stays within budget', () => {
      const result = checkConsumerBudget(
        makeConfig({ session_budget: 50 }),
        makeSession({ totalSpent: 30, paidCallCount: 1 }),
        15,
      );
      expect(result.allowed).toBe(true);
    });

    it('blocks request when cumulative spend would exceed budget', () => {
      const result = checkConsumerBudget(
        makeConfig({ session_budget: 50 }),
        makeSession({ totalSpent: 40, paidCallCount: 2 }),
        15,
      );
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Session budget exceeded');
      expect(result.error).toContain('55'); // 40 + 15
      expect(result.error).toContain('50'); // budget
    });

    it('blocks request exactly at budget boundary', () => {
      const result = checkConsumerBudget(
        makeConfig({ session_budget: 50 }),
        makeSession({ totalSpent: 40 }),
        11, // 40 + 11 = 51 > 50
      );
      expect(result.allowed).toBe(false);
    });

    it('allows request exactly filling budget', () => {
      const result = checkConsumerBudget(
        makeConfig({ session_budget: 50 }),
        makeSession({ totalSpent: 40 }),
        10, // 40 + 10 = 50 = budget
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('multi_skill_policy', () => {
    it('auto: allows second paid call silently', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'auto' }),
        makeSession({ totalSpent: 15, paidCallCount: 1 }),
        10,
      );
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('notify: allows second paid call with warning', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'notify' }),
        makeSession({ totalSpent: 15, paidCallCount: 1 }),
        10,
      );
      expect(result.allowed).toBe(true);
      expect(result.warning).toContain('#2');
      expect(result.warning).toContain('25'); // 15 + 10
    });

    it('notify: no warning on first paid call', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'notify' }),
        makeSession({ totalSpent: 0, paidCallCount: 0 }),
        10,
      );
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('block: rejects second paid call', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'block' }),
        makeSession({ totalSpent: 15, paidCallCount: 1 }),
        10,
      );
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Multi-skill block');
      expect(result.error).toContain('#2');
    });

    it('block: allows first paid call', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'block' }),
        makeSession({ totalSpent: 0, paidCallCount: 0 }),
        10,
      );
      expect(result.allowed).toBe(true);
    });

    it('block: rejects third paid call', () => {
      const result = checkConsumerBudget(
        makeConfig({ multi_skill_policy: 'block' }),
        makeSession({ totalSpent: 30, paidCallCount: 2 }),
        10,
      );
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('#3');
    });
  });

  describe('priority: single_request_max checked before session_budget', () => {
    it('single_request_max error takes precedence', () => {
      const result = checkConsumerBudget(
        makeConfig({ single_request_max: 5, session_budget: 100 }),
        makeSession(),
        10,
      );
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('single_request_max');
    });
  });
});

describe('recordConsumerSpend', () => {
  it('increments totalSpent and paidCallCount', () => {
    const session = createSessionState();
    recordConsumerSpend(session, 15);
    expect(session.totalSpent).toBe(15);
    expect(session.paidCallCount).toBe(1);
  });

  it('accumulates across multiple calls', () => {
    const session = createSessionState();
    recordConsumerSpend(session, 15);
    recordConsumerSpend(session, 3);
    recordConsumerSpend(session, 10);
    expect(session.totalSpent).toBe(28);
    expect(session.paidCallCount).toBe(3);
  });

  it('ignores zero-cost calls', () => {
    const session = createSessionState();
    recordConsumerSpend(session, 0);
    expect(session.totalSpent).toBe(0);
    expect(session.paidCallCount).toBe(0);
  });

  it('ignores negative-cost calls', () => {
    const session = createSessionState();
    recordConsumerSpend(session, -5);
    expect(session.totalSpent).toBe(0);
    expect(session.paidCallCount).toBe(0);
  });
});

describe('createSessionState', () => {
  it('starts fresh with zero spend', () => {
    const session = createSessionState();
    expect(session.totalSpent).toBe(0);
    expect(session.paidCallCount).toBe(0);
  });
});

describe('DEFAULT_CONSUMER_AUTONOMY', () => {
  it('has safe defaults', () => {
    expect(DEFAULT_CONSUMER_AUTONOMY.session_budget).toBe(50);
    expect(DEFAULT_CONSUMER_AUTONOMY.single_request_max).toBe(20);
    expect(DEFAULT_CONSUMER_AUTONOMY.multi_skill_policy).toBe('notify');
  });
});
