import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureAgentsTable, createAgentRecord } from './agent-identity.js';
import { deriveAgentId } from './identity.js';
import { generateKeyPair } from '../credit/signing.js';
import {
  ensureOperatorsTable,
  registerOperator,
  getOperator,
  claimAgent,
  createClaimRequest,
} from './operators.js';

describe('operators', () => {
  let db: Database.Database;

  function makeAgent(name: string) {
    const keys = generateKeyPair();
    const publicKeyHex = keys.publicKey.toString('hex');
    return { agent_id: deriveAgentId(publicKeyHex), display_name: name, public_key: publicKeyHex };
  }

  beforeEach(() => {
    db = new Database(':memory:');
    ensureAgentsTable(db);
    ensureOperatorsTable(db);
  });

  afterEach(() => { db.close(); });

  describe('registerOperator', () => {
    it('creates an operator', () => {
      const keys = generateKeyPair();
      const op = registerOperator(db, 'op-001', 'Alice', keys.publicKey.toString('hex'));
      expect(op.operator_id).toBe('op-001');
      expect(op.display_name).toBe('Alice');
    });

    it('is idempotent', () => {
      const keys = generateKeyPair();
      registerOperator(db, 'op-001', 'Alice', keys.publicKey.toString('hex'));
      const op2 = registerOperator(db, 'op-001', 'Alice v2', keys.publicKey.toString('hex'));
      expect(op2.display_name).toBe('Alice'); // original, not updated
    });
  });

  describe('getOperator', () => {
    it('returns null for unknown operator', () => {
      expect(getOperator(db, 'nope')).toBeNull();
    });
  });

  describe('claimAgent', () => {
    it('claims an unclaimed agent with valid signature', () => {
      const opKeys = generateKeyPair();
      const agent = makeAgent('bot-1');
      createAgentRecord(db, agent);
      registerOperator(db, 'op-001', 'Alice', opKeys.publicKey.toString('hex'));

      const claim = createClaimRequest(agent.agent_id, 'op-001', opKeys.privateKey);
      const result = claimAgent(db, claim, opKeys.publicKey.toString('hex'));

      expect(result.success).toBe(true);
    });

    it('rejects invalid signature', () => {
      const opKeys = generateKeyPair();
      const otherKeys = generateKeyPair();
      const agent = makeAgent('bot-1');
      createAgentRecord(db, agent);

      const claim = createClaimRequest(agent.agent_id, 'op-001', otherKeys.privateKey);
      const result = claimAgent(db, claim, opKeys.publicKey.toString('hex'));

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Invalid operator signature');
    });

    it('rejects claim on non-existent agent', () => {
      const opKeys = generateKeyPair();
      const claim = createClaimRequest('nonexistent1234', 'op-001', opKeys.privateKey);
      const result = claimAgent(db, claim, opKeys.publicKey.toString('hex'));

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Agent not found');
    });

    it('rejects claim on agent already claimed by another operator', () => {
      const opKeys1 = generateKeyPair();
      const opKeys2 = generateKeyPair();
      const agent = makeAgent('bot-1');
      createAgentRecord(db, { ...agent, operator_id: 'op-other' });

      const claim = createClaimRequest(agent.agent_id, 'op-001', opKeys1.privateKey);
      const result = claimAgent(db, claim, opKeys1.publicKey.toString('hex'));

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Agent already claimed by another operator');
    });

    it('allows re-claim by same operator', () => {
      const opKeys = generateKeyPair();
      const agent = makeAgent('bot-1');
      createAgentRecord(db, { ...agent, operator_id: 'op-001' });

      const claim = createClaimRequest(agent.agent_id, 'op-001', opKeys.privateKey);
      const result = claimAgent(db, claim, opKeys.publicKey.toString('hex'));

      expect(result.success).toBe(true);
    });
  });
});
