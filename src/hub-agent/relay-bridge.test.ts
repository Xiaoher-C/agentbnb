import { describe, it, expect, beforeEach, beforeAll, afterAll, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { initJobQueue, insertJob, getJob, updateJobStatus } from './job-queue.js';
import { initHubAgentTable, createHubAgent } from './store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { createRelayBridge, handleJobRelayResponse } from './relay-bridge.js';
import { holdEscrow } from '../credit/escrow.js';

// Set up test master key
const TEST_KEY_HEX = randomBytes(32).toString('hex');
const originalEnv = process.env.HUB_MASTER_KEY;

beforeAll(() => {
  process.env.HUB_MASTER_KEY = TEST_KEY_HEX;
});

afterAll(() => {
  if (originalEnv !== undefined) {
    process.env.HUB_MASTER_KEY = originalEnv;
  } else {
    delete process.env.HUB_MASTER_KEY;
  }
});

/** Create mock WebSocket */
function createMockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe('Relay Bridge', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;

  beforeEach(() => {
    registryDb = new Database(':memory:');
    registryDb.pragma('journal_mode = WAL');
    initHubAgentTable(registryDb);
    initJobQueue(registryDb);
    // Create capability_cards table
    registryDb.exec(`
      CREATE TABLE IF NOT EXISTS capability_cards (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    creditDb = openCreditDb(':memory:');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('createRelayBridge returns an onAgentOnline function', () => {
    const connections = new Map();
    const pendingRequests = new Map();
    const sendMessage = vi.fn();

    const bridge = createRelayBridge({
      registryDb,
      creditDb,
      sendMessage,
      pendingRequests,
      connections,
    });

    expect(bridge).toHaveProperty('onAgentOnline');
    expect(typeof bridge.onAgentOnline).toBe('function');
  });

  it('onAgentOnline with no queued jobs does nothing', () => {
    const connections = new Map();
    const pendingRequests = new Map();
    const sendMessage = vi.fn();

    const bridge = createRelayBridge({
      registryDb,
      creditDb,
      sendMessage,
      pendingRequests,
      connections,
    });

    // No jobs queued for 'some-owner'
    bridge.onAgentOnline('some-owner');

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('onAgentOnline dispatches queued jobs to reconnected agent', () => {
    vi.useFakeTimers();

    const targetWs = createMockWs();
    const connections = new Map<string, unknown>();
    connections.set('target-owner', targetWs);
    const pendingRequests = new Map();
    const sendMessage = vi.fn();

    // Create a Hub Agent with relay route
    const agent = createHubAgent(registryDb, {
      name: 'Bridge Agent',
      skill_routes: [{
        skill_id: 'relay-skill',
        mode: 'relay' as const,
        config: { relay_owner: 'target-owner' },
      }],
    }, 'hub-server');

    // Insert a card for the agent
    const cardId = agent.agent_id.padEnd(32, '0')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
    registryDb.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, agent.public_key.slice(0, 16), JSON.stringify({
        spec_version: '2.0', id: cardId, owner: agent.public_key.slice(0, 16),
        skills: [{ id: 'relay-skill', name: 'test', description: 'test', level: 1, inputs: [], outputs: [], pricing: { credits_per_call: 5 } }],
        availability: { online: true },
      }), new Date().toISOString(), new Date().toISOString());

    // Queue a job for target-owner
    const job = insertJob(registryDb, {
      hub_agent_id: agent.agent_id,
      skill_id: 'relay-skill',
      requester_owner: 'requester-1',
      params: { text: 'hello' },
      escrow_id: 'escrow-abc',
      relay_owner: 'target-owner',
    });

    const bridge = createRelayBridge({
      registryDb,
      creditDb,
      sendMessage,
      pendingRequests,
      connections,
    });

    bridge.onAgentOnline('target-owner');

    // Job should be dispatched
    const updated = getJob(registryDb, job.id);
    expect(updated!.status).toBe('dispatched');

    // sendMessage should have been called with an incoming_request
    expect(sendMessage).toHaveBeenCalledOnce();
    const [ws, msg] = sendMessage.mock.calls[0];
    expect(ws).toBe(targetWs);
    expect(msg.type).toBe('incoming_request');
    expect(msg.skill_id).toBe('relay-skill');
    expect(msg.params).toEqual({ text: 'hello' });

    // A pending request should be tracked
    expect(pendingRequests.size).toBe(1);

    vi.useRealTimers();
  });

  it('handleJobRelayResponse completes job and settles escrow on success', () => {
    bootstrapAgent(creditDb, 'requester-1', 100);

    // Hold escrow manually
    const escrowId = holdEscrow(creditDb, 'requester-1', 10, 'card-1');
    // Voucher used for hold (10 <= 50), balance unchanged
    expect(getBalance(creditDb, 'requester-1')).toBe(100);

    // Create a queued job with escrow
    const job = insertJob(registryDb, {
      hub_agent_id: 'agent-1',
      skill_id: 'skill-1',
      requester_owner: 'requester-1',
      params: {},
      escrow_id: escrowId,
      relay_owner: 'target-owner',
    });
    updateJobStatus(registryDb, job.id, 'dispatched');

    // Handle successful response
    handleJobRelayResponse({
      registryDb,
      creditDb,
      jobId: job.id,
      escrowId,
      relayOwner: 'target-owner',
      result: { answer: 42 },
    });

    const completed = getJob(registryDb, job.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.result).toBe(JSON.stringify({ answer: 42 }));

    // Escrow settled: fee=floor(10*0.05)=0, providerAmount=10, bonus 2x: 10, total=20
    const targetBalance = getBalance(creditDb, 'target-owner');
    expect(targetBalance).toBe(20);
  });

  it('handleJobRelayResponse fails job and releases escrow on error', () => {
    bootstrapAgent(creditDb, 'requester-2', 100);

    const escrowId = holdEscrow(creditDb, 'requester-2', 10, 'card-2');

    const job = insertJob(registryDb, {
      hub_agent_id: 'agent-2',
      skill_id: 'skill-2',
      requester_owner: 'requester-2',
      params: {},
      escrow_id: escrowId,
      relay_owner: 'target-owner-2',
    });
    updateJobStatus(registryDb, job.id, 'dispatched');

    // Handle error response
    handleJobRelayResponse({
      registryDb,
      creditDb,
      jobId: job.id,
      escrowId,
      relayOwner: 'target-owner-2',
      error: { code: -32603, message: 'Provider error' },
    });

    const failed = getJob(registryDb, job.id);
    expect(failed!.status).toBe('failed');

    // Voucher used for hold (10 <= 50), release refunds to balance: 100 + 10 = 110
    const balance = getBalance(creditDb, 'requester-2');
    expect(balance).toBe(110);
  });
});
