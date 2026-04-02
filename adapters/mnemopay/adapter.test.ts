import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MnemoPayAdapter } from './adapter.js';
import { createIdentity } from '../../src/identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../../src/credit/signing.js';
import { openCreditDb, bootstrapAgent } from '../../src/credit/ledger.js';
import { AgentBnBError } from '../../src/types/index.js';

describe('MnemoPayAdapter', () => {
  let tempDir: string;
  const OWNER = 'mnemopay-agent';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-mnemopay-adapter-'));
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      owner: OWNER,
      db_path: join(tempDir, 'registry.db'),
      credit_db_path: join(tempDir, 'credit.db'),
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      token: 'test-token',
    }));
    process.env['AGENTBNB_DIR'] = tempDir;
  });

  afterEach(() => {
    delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('creates identity on first run', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      const creditDb = openCreditDb(join(tempDir, 'credit.db'));
      bootstrapAgent(creditDb, OWNER, 100);
      creditDb.close();

      const identity = await adapter.initialize();
      expect(identity.agent_id).toBeTruthy();
      expect(identity.public_key).toBeTruthy();
      adapter.close();
    });

    it('loads existing identity on subsequent runs', async () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      const existingIdentity = createIdentity(tempDir, OWNER);
      const creditDb = openCreditDb(join(tempDir, 'credit.db'));
      bootstrapAgent(creditDb, OWNER, 100);
      creditDb.close();

      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      const identity = await adapter.initialize();
      expect(identity.agent_id).toBe(existingIdentity.agent_id);
      expect(identity.owner).toBe(OWNER);
      adapter.close();
    });
  });

  describe('memory operations', () => {
    it('stores and recalls memories', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });

      const memId = await adapter.remember(
        'Provider alice delivered clean code on translation task',
        { importance: 0.8, tags: ['success', 'alice'] },
      );
      expect(memId).toBeTruthy();

      const memories = await adapter.recall(5);
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain('alice');
      expect(memories[0].importance).toBe(0.8);
      adapter.close();
    });

    it('ranks memories by score (importance × recency × frequency)', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });

      await adapter.remember('Low importance memory', { importance: 0.2 });
      await adapter.remember('High importance memory', { importance: 0.9 });
      await adapter.remember('Medium importance memory', { importance: 0.5 });

      const memories = await adapter.recall(3);
      expect(memories[0].content).toContain('High');
      expect(memories[2].content).toContain('Low');
      adapter.close();
    });

    it('reinforces memories on access', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });

      await adapter.remember('Test memory', { importance: 0.5 });

      // First recall
      const first = await adapter.recall(1);
      expect(first[0].accessCount).toBe(1);

      // Second recall — access count increases
      const second = await adapter.recall(1);
      expect(second[0].accessCount).toBe(2);
      adapter.close();
    });
  });

  describe('getStatus', () => {
    it('returns full status after initialization', async () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      createIdentity(tempDir, OWNER);
      const creditDb = openCreditDb(join(tempDir, 'credit.db'));
      bootstrapAgent(creditDb, OWNER, 100);
      creditDb.close();

      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      await adapter.initialize();
      await adapter.remember('test memory');

      const status = await adapter.getStatus();
      expect(status.identity.owner).toBe(OWNER);
      expect(status.memoriesCount).toBe(1);
      expect(status.reputation).toBe(0.5);
      adapter.close();
    });

    it('throws NOT_INITIALIZED before initialize()', () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      expect(() => adapter.getStatus()).rejects.toThrow();
      adapter.close();
    });
  });

  describe('feedback loop', () => {
    it('agent can charge, settle, and memories are reinforced', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      const agent = adapter.getAgent();

      // Store a memory
      await agent.remember('Provider X is reliable', { importance: 0.5 });

      // Recall to mark as recently accessed
      await agent.recall(5);

      // Charge and settle
      const tx = await agent.charge(10, 'Test task');
      const result = await agent.settle(tx.id);

      // Memories accessed in last hour should be reinforced
      expect(result.reinforced).toBeGreaterThan(0);

      // Check memory importance increased
      const memories = await agent.recall(5);
      expect(memories[0].importance).toBeGreaterThan(0.5);
      adapter.close();
    });

    it('refund docks reputation', async () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      const agent = adapter.getAgent();

      const initialBalance = await agent.balance();
      const initialRep = initialBalance.reputation;

      // Charge then refund
      const tx = await agent.charge(10, 'Failed task');
      await agent.settle(tx.id); // Must settle first to have rep to dock
      const afterSettle = await agent.balance();

      await agent.refund(tx.id);
      const afterRefund = await agent.balance();

      expect(afterRefund.reputation).toBeLessThan(afterSettle.reputation);
      adapter.close();
    });
  });

  describe('close', () => {
    it('can be called multiple times without error', () => {
      const adapter = new MnemoPayAdapter({ configDir: tempDir });
      adapter.close();
      adapter.close();
    });
  });
});
