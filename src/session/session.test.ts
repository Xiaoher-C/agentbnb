import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { SessionEscrow } from './session-escrow.js';
import { SessionManager } from './session-manager.js';
import type { SessionConfig, SessionOpenMessage } from './session-types.js';
import { DEFAULT_SESSION_CONFIG, SESSION_MESSAGE_TYPES } from './session-types.js';
import { attachSessionHandler } from './session-relay.js';
import { SessionExecutor } from './session-executor.js';
import { OpenClawSessionExecutor } from './openclaw-session-executor.js';
import { validateAgentName } from '../skills/openclaw-bridge.js';

// ---------------------------------------------------------------------------
// SessionEscrow tests
// ---------------------------------------------------------------------------

describe('SessionEscrow', () => {
  let db: Database.Database;
  let escrow: SessionEscrow;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    bootstrapAgent(db, 'requester-1', 100);
    bootstrapAgent(db, 'provider-1', 0);
    // Deactivate vouchers so balance is used directly
    db.prepare('UPDATE demand_vouchers SET is_active = 0').run();
    escrow = new SessionEscrow(db);
  });

  afterEach(() => {
    db.close();
  });

  it('holds budget and tracks spending', () => {
    const escrowId = escrow.holdBudget('requester-1', 20, 'card-1');
    expect(escrowId).toBeTruthy();
    expect(getBalance(db, 'requester-1')).toBe(80); // 100 - 20 held

    expect(escrow.getRemainingBudget(escrowId)).toBe(20);
    expect(escrow.getSpent(escrowId)).toBe(0);
  });

  it('deducts per-message cost', () => {
    const escrowId = escrow.holdBudget('requester-1', 20, 'card-1');

    const r1 = escrow.deductMessage(escrowId, 2);
    expect(r1.spent).toBe(2);
    expect(r1.remaining).toBe(18);

    const r2 = escrow.deductMessage(escrowId, 2);
    expect(r2.spent).toBe(4);
    expect(r2.remaining).toBe(16);

    expect(escrow.getSpent(escrowId)).toBe(4);
    expect(escrow.isBudgetExhausted(escrowId)).toBe(false);
  });

  it('detects budget exhaustion', () => {
    const escrowId = escrow.holdBudget('requester-1', 4, 'card-1');

    escrow.deductMessage(escrowId, 2);
    expect(escrow.isBudgetExhausted(escrowId)).toBe(false);

    escrow.deductMessage(escrowId, 2);
    expect(escrow.isBudgetExhausted(escrowId)).toBe(true);
    expect(escrow.getRemainingBudget(escrowId)).toBe(0);
  });

  it('settles escrow to provider', () => {
    const escrowId = escrow.holdBudget('requester-1', 20, 'card-1');
    escrow.deductMessage(escrowId, 6);
    escrow.settle(escrowId, 'provider-1');

    // Provider gets amount minus 5% network fee: 20 * 0.95 = 19
    // Plus first-provider bonus (2.0x for provider #1): 19 + 19 = 38
    expect(getBalance(db, 'provider-1')).toBe(38);
  });

  it('refunds full budget when nothing spent', () => {
    const escrowId = escrow.holdBudget('requester-1', 20, 'card-1');
    escrow.refund(escrowId);
    expect(getBalance(db, 'requester-1')).toBe(100); // Full refund
  });

  it('calculates cost for different pricing models', () => {
    expect(escrow.calculateCost('per_message', 2)).toBe(2);
    expect(escrow.calculateCost('per_minute', 1, 3.5)).toBe(4); // ceil(3.5) = 4
    expect(escrow.calculateCost('per_session', 10)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// SessionManager tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let db: Database.Database;
  let sentMessages: Array<{ agentKey: string; msg: unknown }>;
  let manager: SessionManager;
  const testConfig: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    timeouts: {
      idle_timeout_ms: 500,        // Short for testing
      max_session_duration_ms: 2000,
      message_timeout_ms: 500,
    },
  };

  function makeOpenMsg(overrides?: Partial<SessionOpenMessage>): SessionOpenMessage {
    return {
      type: 'session_open',
      session_id: crypto.randomUUID(),
      requester_id: 'requester-1',
      provider_id: 'provider-1',
      card_id: 'card-1',
      skill_id: 'skill-1',
      budget: 20,
      pricing_model: 'per_message',
      initial_message: 'Hello provider!',
      ...overrides,
    };
  }

  beforeEach(() => {
    db = openCreditDb(':memory:');
    bootstrapAgent(db, 'requester-1', 100);
    bootstrapAgent(db, 'provider-1', 0);
    db.prepare('UPDATE demand_vouchers SET is_active = 0').run();

    sentMessages = [];
    manager = new SessionManager({
      creditDb: db,
      sendToAgent: (agentKey, msg) => { sentMessages.push({ agentKey, msg }); },
      isAgentOnline: () => true,
      config: testConfig,
    });
  });

  afterEach(() => {
    manager.shutdown();
    db.close();
  });

  it('opens a session successfully', () => {
    const msg = makeOpenMsg();
    const session = manager.openSession(msg, 'requester-1');

    expect(session.id).toBe(msg.session_id);
    expect(session.status).toBe('active');
    expect(session.requester_id).toBe('requester-1');
    expect(session.provider_id).toBe('provider-1');
    expect(session.budget).toBe(20);
    expect(session.spent).toBe(0);
    expect(session.messages).toHaveLength(1); // initial message

    // Should have sent: session_ack to requester + session_message to provider
    const ackMsg = sentMessages.find(m => (m.msg as { type: string }).type === 'session_ack');
    expect(ackMsg).toBeTruthy();
    expect(ackMsg!.agentKey).toBe('requester-1');

    const fwdMsg = sentMessages.find(m =>
      (m.msg as { type: string }).type === 'session_message' &&
      m.agentKey === 'provider-1'
    );
    expect(fwdMsg).toBeTruthy();
    expect((fwdMsg!.msg as { content: string }).content).toBe('Hello provider!');
  });

  it('routes messages between requester and provider', () => {
    const msg = makeOpenMsg();
    manager.openSession(msg, 'requester-1');

    sentMessages = [];

    // Provider responds
    manager.routeMessage({
      type: 'session_message',
      session_id: msg.session_id,
      sender: 'provider',
      content: 'Hello requester!',
    }, 'provider-1');

    const fwd = sentMessages.find(m => m.agentKey === 'requester-1');
    expect(fwd).toBeTruthy();
    expect((fwd!.msg as { content: string }).content).toBe('Hello requester!');

    const session = manager.getSession(msg.session_id);
    expect(session!.messages).toHaveLength(2); // initial + provider reply
    expect(session!.spent).toBe(2); // per_message rate = 2 charged on provider reply
  });

  it('charges per-message on provider replies', () => {
    const msg = makeOpenMsg({ budget: 10 });
    manager.openSession(msg, 'requester-1');

    // 4 provider replies = 8 credits
    for (let i = 0; i < 4; i++) {
      manager.routeMessage({
        type: 'session_message',
        session_id: msg.session_id,
        sender: 'provider',
        content: `Reply ${i + 1}`,
      }, 'provider-1');
    }

    const session = manager.getSession(msg.session_id);
    expect(session!.spent).toBe(8);
  });

  it('auto-ends session on budget exhaustion', () => {
    const msg = makeOpenMsg({ budget: 4 }); // 2 credits per message, budget for 2 provider replies
    manager.openSession(msg, 'requester-1');

    sentMessages = [];

    // First provider reply: 2 credits → 2 remaining
    manager.routeMessage({
      type: 'session_message',
      session_id: msg.session_id,
      sender: 'provider',
      content: 'Reply 1',
    }, 'provider-1');

    // Second provider reply: 2 credits → 0 remaining → auto-end
    manager.routeMessage({
      type: 'session_message',
      session_id: msg.session_id,
      sender: 'provider',
      content: 'Reply 2',
    }, 'provider-1');

    // Should have session_settled messages
    const settled = sentMessages.filter(m => (m.msg as { type: string }).type === 'session_settled');
    expect(settled.length).toBeGreaterThanOrEqual(1);

    const session = manager.getSession(msg.session_id);
    expect(session!.status).toBe('closed');
    expect(session!.end_reason).toBe('budget_exhausted');
  });

  it('ends session on explicit end request', () => {
    const msg = makeOpenMsg();
    manager.openSession(msg, 'requester-1');

    sentMessages = [];
    manager.endSession({
      type: 'session_end',
      session_id: msg.session_id,
      reason: 'completed',
    }, 'requester-1');

    const session = manager.getSession(msg.session_id);
    expect(session!.status).toBe('closed');
    expect(session!.end_reason).toBe('completed');

    // Both parties should get session_settled
    const settled = sentMessages.filter(m => (m.msg as { type: string }).type === 'session_settled');
    expect(settled).toHaveLength(2);
  });

  it('handles idle timeout', async () => {
    const msg = makeOpenMsg();
    manager.openSession(msg, 'requester-1');

    // Wait for idle timeout (500ms in test config)
    await new Promise(resolve => setTimeout(resolve, 700));

    const session = manager.getSession(msg.session_id);
    expect(session!.status).toBe('closed');
    expect(session!.end_reason).toBe('timeout');
  });

  it('rejects messages on non-existent session', () => {
    sentMessages = [];
    manager.routeMessage({
      type: 'session_message',
      session_id: 'nonexistent',
      sender: 'requester',
      content: 'test',
    }, 'requester-1');

    const error = sentMessages.find(m => (m.msg as { type: string }).type === 'session_error');
    expect(error).toBeTruthy();
    expect((error!.msg as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });

  it('handles disconnect by ending active sessions', () => {
    const msg = makeOpenMsg();
    manager.openSession(msg, 'requester-1');

    sentMessages = [];
    manager.handleDisconnect('requester-1');

    const session = manager.getSession(msg.session_id);
    expect(session!.status).toBe('closed');
    expect(session!.end_reason).toBe('error');
  });

  it('lists sessions filtered by agent', () => {
    const msg1 = makeOpenMsg({ requester_id: 'requester-1', provider_id: 'provider-1' });
    const msg2 = makeOpenMsg({ requester_id: 'requester-2', provider_id: 'provider-2' });
    bootstrapAgent(db, 'requester-2', 100);
    db.prepare('UPDATE demand_vouchers SET is_active = 0 WHERE owner = ?').run('requester-2');
    bootstrapAgent(db, 'provider-2', 0);

    manager.openSession(msg1, 'requester-1');
    manager.openSession(msg2, 'requester-2');

    expect(manager.listSessions().length).toBe(2);
    expect(manager.listSessions('requester-1').length).toBe(1);
    expect(manager.listSessions('requester-2').length).toBe(1);
  });

  it('enforces max concurrent sessions', () => {
    const configWithLimit: SessionConfig = {
      ...testConfig,
      abuse: { ...testConfig.abuse, max_concurrent_sessions_per_agent: 1 },
    };
    const limitedManager = new SessionManager({
      creditDb: db,
      sendToAgent: (agentKey, msg) => { sentMessages.push({ agentKey, msg }); },
      config: configWithLimit,
    });

    const msg1 = makeOpenMsg();
    limitedManager.openSession(msg1, 'requester-1');

    const msg2 = makeOpenMsg();
    expect(() => limitedManager.openSession(msg2, 'requester-1')).toThrow('Max concurrent sessions');

    limitedManager.shutdown();
  });

  it('per_session pricing charges flat rate on open', () => {
    const msg = makeOpenMsg({ pricing_model: 'per_session', budget: 20 });
    const session = manager.openSession(msg, 'requester-1');

    expect(session.spent).toBe(testConfig.pricing.per_session_flat_rate);
  });
});

// ---------------------------------------------------------------------------
// Session relay handler tests
// ---------------------------------------------------------------------------

describe('attachSessionHandler', () => {
  let db: Database.Database;
  let sentMessages: Array<{ agentKey: string; msg: unknown }>;
  let manager: SessionManager;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    bootstrapAgent(db, 'requester-1', 100);
    bootstrapAgent(db, 'provider-1', 0);
    db.prepare('UPDATE demand_vouchers SET is_active = 0').run();

    sentMessages = [];
    manager = new SessionManager({
      creditDb: db,
      sendToAgent: (agentKey, msg) => { sentMessages.push({ agentKey, msg }); },
      config: {
        ...DEFAULT_SESSION_CONFIG,
        timeouts: { idle_timeout_ms: 5000, max_session_duration_ms: 30000, message_timeout_ms: 5000 },
      },
    });
  });

  afterEach(() => {
    manager.shutdown();
    db.close();
  });

  it('handles session_open messages', () => {
    const handler = attachSessionHandler({ sessionManager: manager });

    const handled = handler.handleSessionMessage({
      type: 'session_open',
      session_id: crypto.randomUUID(),
      requester_id: 'requester-1',
      provider_id: 'provider-1',
      card_id: 'card-1',
      skill_id: 'skill-1',
      budget: 20,
      pricing_model: 'per_message',
      initial_message: 'test',
    }, 'requester-1');

    expect(handled).toBe(true);
    expect(manager.listSessions()).toHaveLength(1);
  });

  it('returns false for non-session messages', () => {
    const handler = attachSessionHandler({ sessionManager: manager });
    const handled = handler.handleSessionMessage({ type: 'relay_request', id: '123' }, 'owner-1');
    expect(handled).toBe(false);
  });

  it('absorbs relay-to-agent message types silently', () => {
    const handler = attachSessionHandler({ sessionManager: manager });
    expect(handler.handleSessionMessage({ type: 'session_ack', session_id: 'x' }, 'o')).toBe(true);
    expect(handler.handleSessionMessage({ type: 'session_settled', session_id: 'x' }, 'o')).toBe(true);
    expect(handler.handleSessionMessage({ type: 'session_error', session_id: 'x' }, 'o')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SESSION_MESSAGE_TYPES constant
// ---------------------------------------------------------------------------

describe('SESSION_MESSAGE_TYPES', () => {
  it('contains all 6 session message types', () => {
    expect(SESSION_MESSAGE_TYPES.size).toBe(6);
    expect(SESSION_MESSAGE_TYPES.has('session_open')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('session_ack')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('session_message')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('session_end')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('session_settled')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('session_error')).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has('relay_request')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionExecutor tests
// ---------------------------------------------------------------------------

describe('SessionExecutor', () => {
  it('handles command engine', async () => {
    const executor = new SessionExecutor();
    const result = await executor.handleMessage('sess-1', 'skill-1', 'hello', 'command', []);
    expect(result).toContain('sess-1');
    expect(result).toContain('hello');
  });

  it('cleans up session context', () => {
    const executor = new SessionExecutor();
    // Should not throw
    executor.cleanup('nonexistent');
  });
});

// ---------------------------------------------------------------------------
// Session config tests
// ---------------------------------------------------------------------------

describe('loadSessionConfig', () => {
  it('returns default config when core is not available', async () => {
    const { loadSessionConfig } = await import('./session-types.js');
    const config = loadSessionConfig();
    expect(config.pricing.default_model).toBe('per_message');
    expect(config.pricing.per_message_base_rate).toBe(2);
    expect(config.timeouts.idle_timeout_ms).toBe(120_000);
    expect(config.abuse.max_concurrent_sessions_per_agent).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// OpenClawSessionExecutor tests
// ---------------------------------------------------------------------------

describe('OpenClawSessionExecutor', () => {
  it('validates agent name format via shared utility', () => {
    expect(validateAgentName('valid-agent')).toBe(true);
    expect(validateAgentName('agent_123')).toBe(true);
    expect(validateAgentName('agent.name')).toBe(true);
    expect(validateAgentName('invalid agent')).toBe(false);
    expect(validateAgentName('bad;name')).toBe(false);
    expect(validateAgentName('$(inject)')).toBe(false);
    expect(validateAgentName('')).toBe(false);
  });

  it('returns error for invalid agent name', async () => {
    const executor = new OpenClawSessionExecutor();
    const result = await executor.execute('sess-1', 'bad;agent', 'test', []);
    expect(result).toContain('[OpenClaw session error:');
    expect(result).toContain('invalid agent name');
  });

  it('cleanup does not throw on unknown session', () => {
    const executor = new OpenClawSessionExecutor();
    expect(() => executor.cleanup('nonexistent')).not.toThrow();
  });

  it('parseResponse handles JSON payloads format', () => {
    const executor = new OpenClawSessionExecutor();
    const json = JSON.stringify({
      payloads: [{ text: 'hello', mediaUrl: null }],
      meta: {},
    });
    expect(executor.parseResponse(json)).toBe('hello');
  });

  it('parseResponse handles multi-payload format', () => {
    const executor = new OpenClawSessionExecutor();
    const json = JSON.stringify({
      payloads: [
        { text: 'Part 1', mediaUrl: null },
        { text: 'Part 2', mediaUrl: null },
      ],
      meta: {},
    });
    expect(executor.parseResponse(json)).toBe('Part 1\n\nPart 2');
  });

  it('parseResponse handles plain text fallback', () => {
    const executor = new OpenClawSessionExecutor();
    expect(executor.parseResponse('just text')).toBe('just text');
  });

  it('parseResponse handles JSON with response field', () => {
    const executor = new OpenClawSessionExecutor();
    expect(executor.parseResponse(JSON.stringify({ response: 'resp' }))).toBe('resp');
  });

  it('parseResponse handles empty payloads', () => {
    const executor = new OpenClawSessionExecutor();
    const json = JSON.stringify({
      payloads: [{ text: null, mediaUrl: null }],
      meta: {},
    });
    expect(executor.parseResponse(json)).toBe('');
  });

  it('parseResponse handles JSON preceded by log lines', () => {
    const executor = new OpenClawSessionExecutor();
    const json = JSON.stringify({
      payloads: [{ text: 'response text', mediaUrl: null }],
      meta: {},
    });
    const rawWithLogs = `[INFO] Starting agent...\n[DEBUG] Loading model...\n${json}`;
    expect(executor.parseResponse(rawWithLogs)).toBe('response text');
  });
});
