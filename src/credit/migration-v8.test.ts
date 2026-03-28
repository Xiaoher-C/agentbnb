import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openCreditDb, bootstrapAgent } from './ledger.js';
import { holdEscrow, settleEscrow } from './escrow.js';
import { runV8CreditMigration, runV8RegistryMigration } from './migration-v8.js';
import { lookupAgent, lookupAgentByOwner, ensureAgentsTable } from '../identity/agent-identity.js';
import { deriveAgentId } from '../identity/identity.js';
import { generateKeyPair } from './signing.js';

describe('V8 migration — credit DB', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates agent records for each unique owner in credit_balances', () => {
    bootstrapAgent(db, 'alice', 100);
    bootstrapAgent(db, 'bob', 50);

    const result = runV8CreditMigration(db);

    expect(result.applied).toBe(true);
    expect(result.agentsCreated).toBe(2);
    expect(result.ownerMap.size).toBe(2);

    const alice = lookupAgentByOwner(db, 'alice');
    expect(alice).not.toBeNull();
    expect(alice!.display_name).toBe('alice');
    expect(alice!.legacy_owner).toBe('alice');

    const bob = lookupAgentByOwner(db, 'bob');
    expect(bob).not.toBeNull();
    expect(bob!.display_name).toBe('bob');
  });

  it('creates agent records for owners in escrow and transactions', () => {
    bootstrapAgent(db, 'requester', 200);
    holdEscrow(db, 'requester', 10, 'card-1');

    const result = runV8CreditMigration(db);

    expect(result.applied).toBe(true);
    // requester appears in both credit_balances and credit_escrow, but only 1 agent created
    expect(result.agentsCreated).toBe(1);
  });

  it('uses known keypairs when provided', () => {
    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    const agentId = deriveAgentId(publicKeyHex);

    bootstrapAgent(db, 'known-agent', 100);

    const knownAgents = new Map([
      ['known-agent', { agent_id: agentId, public_key: publicKeyHex }],
    ]);

    const result = runV8CreditMigration(db, knownAgents);

    expect(result.applied).toBe(true);
    expect(result.ownerMap.get('known-agent')).toBe(agentId);

    const agent = lookupAgent(db, agentId);
    expect(agent).not.toBeNull();
    expect(agent!.public_key).toBe(publicKeyHex);
  });

  it('is idempotent — second run is a no-op', () => {
    bootstrapAgent(db, 'alice', 100);

    const first = runV8CreditMigration(db);
    expect(first.applied).toBe(true);
    expect(first.agentsCreated).toBe(1);

    const second = runV8CreditMigration(db);
    expect(second.applied).toBe(false);
    expect(second.agentsCreated).toBe(0);
  });

  it('skips owners that already have agent records', () => {
    bootstrapAgent(db, 'pre-existing', 100);

    // Manually create agent record before migration
    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    const agentId = deriveAgentId(publicKeyHex);

    db.prepare(
      `INSERT INTO agents (agent_id, display_name, public_key, legacy_owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(agentId, 'pre-existing', publicKeyHex, 'pre-existing', new Date().toISOString(), new Date().toISOString());

    const result = runV8CreditMigration(db);

    expect(result.applied).toBe(true);
    expect(result.agentsCreated).toBe(0);
    expect(result.ownerMap.get('pre-existing')).toBe(agentId);
  });

  it('handles empty database gracefully', () => {
    const result = runV8CreditMigration(db);

    expect(result.applied).toBe(true);
    expect(result.agentsCreated).toBe(0);
    expect(result.ownerMap.size).toBe(0);
  });

  it('handles settlement recipients who appear only in transactions', () => {
    bootstrapAgent(db, 'requester', 200);
    const escrowId = holdEscrow(db, 'requester', 10, 'card-1');
    settleEscrow(db, escrowId, 'provider');

    const result = runV8CreditMigration(db);

    expect(result.applied).toBe(true);
    // Both requester and provider should be migrated
    expect(result.ownerMap.has('requester')).toBe(true);
    expect(result.ownerMap.has('provider')).toBe(true);
  });
});

describe('V8 migration — registry DB', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS capability_cards (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    ensureAgentsTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates agent records for each unique card owner', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('card-1', 'alice', '{}', now, now);
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('card-2', 'bob', '{}', now, now);

    const result = runV8RegistryMigration(db);

    expect(result.applied).toBe(true);
    expect(result.agentsCreated).toBe(2);

    expect(lookupAgentByOwner(db, 'alice')).not.toBeNull();
    expect(lookupAgentByOwner(db, 'bob')).not.toBeNull();
  });

  it('deduplicates owners with multiple cards', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('card-1', 'alice', '{}', now, now);
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('card-2', 'alice', '{}', now, now);

    const result = runV8RegistryMigration(db);

    expect(result.agentsCreated).toBe(1);
  });

  it('is idempotent', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('card-1', 'alice', '{}', now, now);

    const first = runV8RegistryMigration(db);
    expect(first.applied).toBe(true);

    const second = runV8RegistryMigration(db);
    expect(second.applied).toBe(false);
  });

  it('handles empty registry gracefully', () => {
    const result = runV8RegistryMigration(db);
    expect(result.applied).toBe(true);
    expect(result.agentsCreated).toBe(0);
  });
});
