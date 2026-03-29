import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createGatewayServer } from '../gateway/server.js';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent, getBalance } from './ledger.js';
import { generateKeyPair } from './signing.js';
import { createSignedEscrowReceipt } from './escrow-receipt.js';
import { releaseRequesterEscrow } from './settlement.js';
import { getEscrowStatus } from './escrow.js';
import type { CapabilityCardV2, EscrowReceipt } from '../types/index.js';
import type { SkillExecutor, ExecutionResult } from '../skills/executor.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert a v2 card directly into the registry DB (bypasses v1-only Zod validation). */
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
    registerMode: () => {},
    loadSkillConfigs: async () => {},
  } as unknown as SkillExecutor;
}

const SUCCESS_RESULT: ExecutionResult = {
  success: true,
  result: { data: 'test-output' },
  latency_ms: 10,
};

const FAILURE_RESULT: ExecutionResult = {
  success: false,
  error: 'mock failure',
  latency_ms: 5,
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('P2P Credit Integration (two separate SQLite databases)', () => {
  // Two agents with completely separate databases (simulating /tmp/agent-a/ and /tmp/agent-b/)
  let providerRegistryDb: Database.Database;
  let providerCreditDb: Database.Database;
  let requesterCreditDb: Database.Database;
  let providerKeys: ReturnType<typeof generateKeyPair>;
  let requesterKeys: ReturnType<typeof generateKeyPair>;
  let gateway: FastifyInstance;

  const providerOwner = 'agent-provider';
  const requesterOwner = 'agent-requester';
  const cardId = '00000000-0000-4000-a000-000000000001';
  const skillId = 'skill-translate';

  const testCard: CapabilityCardV2 = {
    spec_version: '2.0',
    id: cardId,
    owner: providerOwner,
    agent_name: 'Provider Agent',
    skills: [
      {
        id: skillId,
        name: 'Translate',
        description: 'Translates text between languages',
        level: 1,
        inputs: [{ name: 'text', type: 'text', required: true }],
        outputs: [{ name: 'translated', type: 'text', required: true }],
        pricing: { credits_per_call: 5 },
      },
    ],
    availability: { online: true },
  };

  beforeEach(async () => {
    // Create SEPARATE in-memory databases — no shared state
    providerRegistryDb = openDatabase(':memory:');
    providerCreditDb = openCreditDb(':memory:');
    requesterCreditDb = openCreditDb(':memory:');

    // Bootstrap agents in their OWN DBs
    bootstrapAgent(providerCreditDb, providerOwner, 50);
    bootstrapAgent(requesterCreditDb, requesterOwner, 100);

    // Generate SEPARATE keypairs
    providerKeys = generateKeyPair();
    requesterKeys = generateKeyPair();

    // Insert test card in provider's registry
    insertCardV2(providerRegistryDb, testCard);

    // Create gateway server with provider's DBs + success mock executor
    gateway = createGatewayServer({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      tokens: ['test-token'],
      handlerUrl: 'http://localhost:9999',
      silent: true,
      skillExecutor: mockExecutor(SUCCESS_RESULT),
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    providerRegistryDb.close();
    providerCreditDb.close();
    requesterCreditDb.close();
  });

  // ── Scenario 1: Direct paid remote HTTP is disabled ────────────────────────

  it('rejects paid direct HTTP receipt flow and leaves settlement on the requester side', async () => {
    // 1. Requester creates signed receipt on OWN DB
    const { escrowId, receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: requesterOwner, amount: 5, cardId },
    );

    // Voucher used for hold (5 <= 50), balance stays at 100
    expect(getBalance(requesterCreditDb, requesterOwner)).toBe(100);

    // 2. Send request to provider gateway with receipt
    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '1',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: skillId,
          requester: requesterOwner,
          escrow_receipt: receipt,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/relay/i);

    // 3. Provider balance is unchanged because direct paid remote execution never starts.
    expect(getBalance(providerCreditDb, providerOwner)).toBe(50);

    // 4. Requester must release its own local hold after the provider rejects direct HTTP.
    const escrowBeforeRelease = getEscrowStatus(requesterCreditDb, escrowId);
    expect(escrowBeforeRelease?.status).toBe('held');

    releaseRequesterEscrow(requesterCreditDb, escrowId);
    expect(getBalance(requesterCreditDb, requesterOwner)).toBe(105);
  });

  // ── Scenario 2: Rejection happens before provider execution ─────────────────

  it('rejects paid direct HTTP before provider execution runs', async () => {
    // Create gateway with failing executor
    await gateway.close();
    gateway = createGatewayServer({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      tokens: ['test-token'],
      handlerUrl: 'http://localhost:9999',
      silent: true,
      skillExecutor: mockExecutor(FAILURE_RESULT),
    });
    await gateway.ready();

    // 1. Requester creates signed receipt (voucher used for hold)
    const { escrowId, receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: requesterOwner, amount: 5, cardId },
    );

    // 2. Send request — execution will fail
    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '2',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: skillId,
          requester: requesterOwner,
          escrow_receipt: receipt,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/relay/i);

    // 3. Provider balance unchanged (no earning recorded)
    expect(getBalance(providerCreditDb, providerOwner)).toBe(50);

    // 4. Requester releases escrow (refund to balance: 100 + 5 = 105, voucher was spent)
    releaseRequesterEscrow(requesterCreditDb, escrowId);
    expect(getBalance(requesterCreditDb, requesterOwner)).toBe(105);
  });

  // ── Scenario 3: Invalid receipt is still blocked by the relay-only rule ────

  it('invalid receipt: direct paid HTTP is still rejected before settlement', async () => {
    // 1. Create a valid receipt (voucher used for hold, balance stays 100)
    const { receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: requesterOwner, amount: 5, cardId },
    );

    // Tamper with the receipt — change the amount after signing
    const tamperedReceipt: EscrowReceipt = {
      ...receipt,
      amount: 999, // tampered
    };

    // 2. Send request with tampered receipt
    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '3',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: skillId,
          requester: requesterOwner,
          escrow_receipt: tamperedReceipt,
        },
      },
    });

    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/relay/i);

    // 3. No balance changes on either side
    expect(getBalance(providerCreditDb, providerOwner)).toBe(50);
    // Requester still has 100 (voucher-funded escrow held locally, provider rejected)
    expect(getBalance(requesterCreditDb, requesterOwner)).toBe(100);
  });

  // ── Scenario 4: Backward compat (no receipt, local mode) ───────────────────

  it('backward compat: no receipt falls back to local DB credit check', async () => {
    // Bootstrap the requester in the PROVIDER's credit DB (same-machine mode)
    bootstrapAgent(providerCreditDb, requesterOwner, 100);

    // Send request WITHOUT receipt — local mode
    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '4',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: skillId,
          requester: requesterOwner,
          // No escrow_receipt — local mode
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result).toBeDefined();

    // Provider gets credits via local escrow settlement
    // fee: floor(5*0.05)=0, providerAmount=5, bonus: 2x (first provider in this DB), bonusAmount=5
    // total provider: 50 + 5 + 5 = 60
    expect(getBalance(providerCreditDb, providerOwner)).toBe(60);
    // Requester's voucher used in provider DB (balance stays 100)
    expect(getBalance(providerCreditDb, requesterOwner)).toBe(100);
  });

  // ── Scenario 5: Wrong key (signed by different agent) ──────────────────────

  it('wrong key: direct paid HTTP is still rejected before provider settlement', async () => {
    // Create receipt signed with requester's key but swap the public key to provider's
    // (voucher used for hold)
    const { receipt: validReceipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      requesterKeys.privateKey,
      requesterKeys.publicKey,
      { owner: requesterOwner, amount: 5, cardId },
    );

    // Replace public key with a different agent's key (signature won't match)
    const wrongKeyReceipt: EscrowReceipt = {
      ...validReceipt,
      requester_public_key: providerKeys.publicKey.toString('hex'),
    };

    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '5',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: skillId,
          requester: requesterOwner,
          escrow_receipt: wrongKeyReceipt,
        },
      },
    });

    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/relay/i);

    // No balance changes
    expect(getBalance(providerCreditDb, providerOwner)).toBe(50);
  });
});

// ─── File-based DB test ───────────────────────────────────────────────────────

describe('P2P Credit Integration (file-based DBs at /tmp paths)', () => {
  const agentADir = '/tmp/agent-a-test';
  const agentBDir = '/tmp/agent-b-test';

  let providerRegistryDb: Database.Database;
  let providerCreditDb: Database.Database;
  let requesterCreditDb: Database.Database;
  let gateway: FastifyInstance;

  const providerOwner = 'agent-provider';
  const requesterOwner = 'agent-requester';
  const cardId = '00000000-0000-4000-a000-000000000002';

  beforeEach(async () => {
    // Clean up and create directories
    for (const dir of [agentADir, agentBDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });
    }

    // Create SEPARATE file-based databases at different /tmp paths
    providerRegistryDb = openDatabase(join(agentADir, 'registry.db'));
    providerCreditDb = openCreditDb(join(agentADir, 'credits.db'));
    requesterCreditDb = openCreditDb(join(agentBDir, 'credits.db'));

    bootstrapAgent(providerCreditDb, providerOwner, 50);
    bootstrapAgent(requesterCreditDb, requesterOwner, 100);

    // Insert test card
    const now = new Date().toISOString();
    const card: CapabilityCardV2 = {
      spec_version: '2.0',
      id: cardId,
      owner: providerOwner,
      agent_name: 'File-Based Provider',
      skills: [
        {
          id: 'skill-file-test',
          name: 'File Test',
          description: 'Tests file-based DB separation',
          level: 1,
          inputs: [{ name: 'input', type: 'text', required: true }],
          outputs: [{ name: 'output', type: 'text', required: true }],
          pricing: { credits_per_call: 10 },
        },
      ],
      availability: { online: true },
    };
    providerRegistryDb.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(card.id, card.owner, JSON.stringify(card), now, now);

    gateway = createGatewayServer({
      registryDb: providerRegistryDb,
      creditDb: providerCreditDb,
      tokens: ['test-token'],
      handlerUrl: 'http://localhost:9999',
      silent: true,
      skillExecutor: {
        execute: async () => ({ success: true, result: { data: 'file-test' }, latency_ms: 5 }),
        registerMode: () => {},
        loadSkillConfigs: async () => {},
      } as unknown as SkillExecutor,
    });

    await gateway.ready();
  });

  afterEach(async () => {
    await gateway.close();
    providerRegistryDb.close();
    providerCreditDb.close();
    requesterCreditDb.close();

    // Clean up temp directories
    for (const dir of [agentADir, agentBDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });

  it('file-based DBs: paid direct HTTP receipt flow is rejected across disk-separated databases', async () => {
    const keys = generateKeyPair();

    // Create signed receipt from requester's file-based DB (voucher used, balance stays 100)
    const { escrowId, receipt } = createSignedEscrowReceipt(
      requesterCreditDb,
      keys.privateKey,
      keys.publicKey,
      { owner: requesterOwner, amount: 10, cardId },
    );

    // Send to provider's gateway
    const response = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: '1',
        method: 'capability.execute',
        params: {
          card_id: cardId,
          skill_id: 'skill-file-test',
          requester: requesterOwner,
          escrow_receipt: receipt,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.error.message).toMatch(/disabled/i);
    expect(body.error.message).toMatch(/relay/i);

    // Provider never settles direct paid remote execution.
    expect(getBalance(providerCreditDb, providerOwner)).toBe(50);

    // Requester releases its own local hold after the rejection.
    releaseRequesterEscrow(requesterCreditDb, escrowId);
    expect(getBalance(requesterCreditDb, requesterOwner)).toBe(110);

    // Verify the DB files actually exist on disk
    expect(existsSync(join(agentADir, 'registry.db'))).toBe(true);
    expect(existsSync(join(agentADir, 'credits.db'))).toBe(true);
    expect(existsSync(join(agentBDir, 'credits.db'))).toBe(true);
  });
});
