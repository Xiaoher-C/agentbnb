import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureAgentsTable,
  createAgentRecord,
  lookupAgent,
  lookupAgentByOwner,
  listAgentsByOperator,
  updateAgentRecord,
  resolveIdentifier,
  resolveCanonicalIdentity,
  sameAgentIdentity,
} from './agent-identity.js';
import { deriveAgentId } from './identity.js';
import { generateKeyPair } from '../credit/signing.js';

describe('agent-identity', () => {
  let db: Database.Database;

  /** Helper: generate a valid agent_id + public_key pair */
  function makeAgent(name: string) {
    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    const agentId = deriveAgentId(publicKeyHex);
    return { agent_id: agentId, display_name: name, public_key: publicKeyHex };
  }

  beforeEach(() => {
    db = new Database(':memory:');
    ensureAgentsTable(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('ensureAgentsTable', () => {
    it('creates the agents table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it('is idempotent — safe to call multiple times', () => {
      ensureAgentsTable(db);
      ensureAgentsTable(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });
  });

  describe('createAgentRecord', () => {
    it('creates an agent with required fields', () => {
      const agent = makeAgent('test-bot');
      const record = createAgentRecord(db, agent);

      expect(record.agent_id).toBe(agent.agent_id);
      expect(record.display_name).toBe('test-bot');
      expect(record.public_key).toBe(agent.public_key);
      expect(record.operator_id).toBeNull();
      expect(record.server_id).toBeNull();
      expect(record.legacy_owner).toBeNull();
      expect(record.created_at).toBeTruthy();
      expect(record.updated_at).toBeTruthy();
    });

    it('creates an agent with optional fields', () => {
      const agent = makeAgent('fleet-bot');
      const record = createAgentRecord(db, {
        ...agent,
        operator_id: 'op-001',
        server_id: 'mac-mini',
        legacy_owner: 'old-owner-string',
      });

      expect(record.operator_id).toBe('op-001');
      expect(record.server_id).toBe('mac-mini');
      expect(record.legacy_owner).toBe('old-owner-string');
    });

    it('throws AGENT_EXISTS for duplicate agent_id', () => {
      const agent = makeAgent('dup-bot');
      createAgentRecord(db, agent);

      expect(() => createAgentRecord(db, agent)).toThrow('AGENT_EXISTS');
    });
  });

  describe('lookupAgent', () => {
    it('returns agent by agent_id', () => {
      const agent = makeAgent('lookup-bot');
      createAgentRecord(db, agent);

      const found = lookupAgent(db, agent.agent_id);
      expect(found).not.toBeNull();
      expect(found!.display_name).toBe('lookup-bot');
    });

    it('returns null for unknown agent_id', () => {
      expect(lookupAgent(db, 'nonexistent12345')).toBeNull();
    });
  });

  describe('lookupAgentByOwner', () => {
    it('returns agent by legacy owner string', () => {
      const agent = makeAgent('legacy-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'Cheng Wen Chen' });

      const found = lookupAgentByOwner(db, 'Cheng Wen Chen');
      expect(found).not.toBeNull();
      expect(found!.agent_id).toBe(agent.agent_id);
    });

    it('returns null for unknown owner', () => {
      expect(lookupAgentByOwner(db, 'nobody')).toBeNull();
    });
  });

  describe('listAgentsByOperator', () => {
    it('returns all agents for an operator', () => {
      const a1 = makeAgent('bot-1');
      const a2 = makeAgent('bot-2');
      const a3 = makeAgent('other-bot');

      createAgentRecord(db, { ...a1, operator_id: 'op-001' });
      createAgentRecord(db, { ...a2, operator_id: 'op-001' });
      createAgentRecord(db, { ...a3, operator_id: 'op-002' });

      const fleet = listAgentsByOperator(db, 'op-001');
      expect(fleet).toHaveLength(2);
      expect(fleet.map((a) => a.display_name).sort()).toEqual(['bot-1', 'bot-2']);
    });

    it('returns empty array for unknown operator', () => {
      expect(listAgentsByOperator(db, 'unknown')).toEqual([]);
    });
  });

  describe('updateAgentRecord', () => {
    it('updates display_name', () => {
      const agent = makeAgent('old-name');
      createAgentRecord(db, agent);

      updateAgentRecord(db, agent.agent_id, { display_name: 'new-name' });

      const found = lookupAgent(db, agent.agent_id);
      expect(found!.display_name).toBe('new-name');
    });

    it('updates operator_id', () => {
      const agent = makeAgent('orphan-bot');
      createAgentRecord(db, agent);

      updateAgentRecord(db, agent.agent_id, { operator_id: 'op-001' });

      const found = lookupAgent(db, agent.agent_id);
      expect(found!.operator_id).toBe('op-001');
    });

    it('updates server_id', () => {
      const agent = makeAgent('mobile-bot');
      createAgentRecord(db, agent);

      updateAgentRecord(db, agent.agent_id, { server_id: 'new-server' });

      const found = lookupAgent(db, agent.agent_id);
      expect(found!.server_id).toBe('new-server');
    });

    it('updates updated_at timestamp', async () => {
      const agent = makeAgent('timestamp-bot');
      const record = createAgentRecord(db, agent);
      const originalUpdatedAt = record.updated_at;

      await new Promise((r) => setTimeout(r, 5));
      updateAgentRecord(db, agent.agent_id, { display_name: 'renamed' });

      const found = lookupAgent(db, agent.agent_id);
      expect(found!.updated_at).not.toBe(originalUpdatedAt);
    });

    it('throws AGENT_NOT_FOUND for unknown agent', () => {
      expect(() =>
        updateAgentRecord(db, 'nonexistent12345', { display_name: 'x' }),
      ).toThrow('AGENT_NOT_FOUND');
    });

    it('no-ops when no fields provided', () => {
      const agent = makeAgent('noop-bot');
      createAgentRecord(db, agent);

      // Should not throw
      updateAgentRecord(db, agent.agent_id, {});
    });
  });

  describe('resolveIdentifier', () => {
    it('resolves agent_id directly', () => {
      const agent = makeAgent('direct-bot');
      createAgentRecord(db, agent);

      expect(resolveIdentifier(db, agent.agent_id)).toBe(agent.agent_id);
    });

    it('resolves legacy owner to agent_id', () => {
      const agent = makeAgent('legacy-resolve-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'my-old-owner' });

      expect(resolveIdentifier(db, 'my-old-owner')).toBe(agent.agent_id);
    });

    it('returns input unchanged for unregistered identifier', () => {
      expect(resolveIdentifier(db, 'unknown-agent')).toBe('unknown-agent');
    });

    it('prefers agent_id match over legacy owner lookup', () => {
      // Create agent whose agent_id happens to be the identifier
      const agent = makeAgent('priority-bot');
      createAgentRecord(db, agent);

      // Also create another agent with legacy_owner matching the first agent's id
      const other = makeAgent('other-bot');
      createAgentRecord(db, { ...other, legacy_owner: agent.agent_id });

      // Should resolve to the direct agent_id match
      expect(resolveIdentifier(db, agent.agent_id)).toBe(agent.agent_id);
    });
  });

  describe('resolveCanonicalIdentity', () => {
    it('returns resolved canonical identity for agent_id input', () => {
      const agent = makeAgent('canonical-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'legacy-canonical' });

      const resolved = resolveCanonicalIdentity(db, agent.agent_id);
      expect(resolved.resolved).toBe(true);
      expect(resolved.agent_id).toBe(agent.agent_id);
      expect(resolved.legacy_owner).toBe('legacy-canonical');
      expect(resolved.source).toBe('agent_id');
    });

    it('returns resolved canonical identity for legacy owner input', () => {
      const agent = makeAgent('legacy-canonical-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'legacy-owner-x' });

      const resolved = resolveCanonicalIdentity(db, 'legacy-owner-x');
      expect(resolved.resolved).toBe(true);
      expect(resolved.agent_id).toBe(agent.agent_id);
      expect(resolved.source).toBe('legacy_owner');
    });

    it('returns unresolved identity for unknown identifier', () => {
      const resolved = resolveCanonicalIdentity(db, 'unknown-owner');
      expect(resolved.resolved).toBe(false);
      expect(resolved.agent_id).toBe('unknown-owner');
      expect(resolved.source).toBe('unresolved');
    });
  });

  describe('sameAgentIdentity', () => {
    it('matches canonical agent_id and legacy owner as same identity', () => {
      const agent = makeAgent('same-agent-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'legacy-same' });

      expect(sameAgentIdentity(db, agent.agent_id, 'legacy-same')).toBe(true);
    });

    it('does not match unrelated identifiers', () => {
      const agent = makeAgent('diff-agent-bot');
      createAgentRecord(db, { ...agent, legacy_owner: 'legacy-diff' });

      expect(sameAgentIdentity(db, agent.agent_id, 'other-owner')).toBe(false);
    });
  });

  describe('integration with openCreditDb', () => {
    it('agents table is created when credit DB opens', async () => {
      // Dynamic import to avoid circular dep issues in test
      const { openCreditDb } = await import('../credit/ledger.js');
      const creditDb = openCreditDb(':memory:');

      const tables = creditDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);

      creditDb.close();
    });
  });
});
