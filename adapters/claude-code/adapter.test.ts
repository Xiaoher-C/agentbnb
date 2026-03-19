import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter } from './adapter.js';
import { createIdentity } from '../../src/identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../../src/credit/signing.js';
import { openCreditDb, bootstrapAgent } from '../../src/credit/ledger.js';
import { AgentBnBError } from '../../src/types/index.js';

describe('ClaudeCodeAdapter', () => {
  let tempDir: string;
  const OWNER = 'claude-code-agent';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-claude-adapter-'));
    // Write minimal config so SDK authenticate() uses correct owner
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
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      // Set up keypair so identity creation works
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
      // First: set up full identity
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      const existingIdentity = createIdentity(tempDir, OWNER);
      const creditDb = openCreditDb(join(tempDir, 'credit.db'));
      bootstrapAgent(creditDb, OWNER, 100);
      creditDb.close();

      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      const identity = await adapter.initialize();
      expect(identity.agent_id).toBe(existingIdentity.agent_id);
      expect(identity.owner).toBe(OWNER);
      adapter.close();
    });
  });

  describe('getBudgetTier', () => {
    it('returns auto for cost < 10', () => {
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      expect(adapter.getBudgetTier(0)).toBe('auto');
      expect(adapter.getBudgetTier(5)).toBe('auto');
      expect(adapter.getBudgetTier(9)).toBe('auto');
      adapter.close();
    });

    it('returns notify for cost 10-50', () => {
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      expect(adapter.getBudgetTier(10)).toBe('notify');
      expect(adapter.getBudgetTier(30)).toBe('notify');
      expect(adapter.getBudgetTier(50)).toBe('notify');
      adapter.close();
    });

    it('returns ask for cost > 50', () => {
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      expect(adapter.getBudgetTier(51)).toBe('ask');
      expect(adapter.getBudgetTier(100)).toBe('ask');
      adapter.close();
    });

    it('respects custom tier thresholds', () => {
      const adapter = new ClaudeCodeAdapter({
        configDir: tempDir,
        budgetTiers: { tier1: 5, tier2: 20 },
      });
      expect(adapter.getBudgetTier(3)).toBe('auto');
      expect(adapter.getBudgetTier(5)).toBe('notify');
      expect(adapter.getBudgetTier(20)).toBe('notify');
      expect(adapter.getBudgetTier(21)).toBe('ask');
      adapter.close();
    });
  });

  describe('getStatus', () => {
    it('returns balance and identity after initialization', async () => {
      const keys = generateKeyPair();
      saveKeyPair(tempDir, keys);
      createIdentity(tempDir, OWNER);
      const creditDb = openCreditDb(join(tempDir, 'credit.db'));
      bootstrapAgent(creditDb, OWNER, 100);
      creditDb.close();

      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      await adapter.initialize();
      const status = adapter.getStatus();
      expect(status.balance).toBe(100);
      expect(status.identity.owner).toBe(OWNER);
      expect(status.tier).toBe('ask'); // 100 credits > tier2 (50)
      adapter.close();
    });

    it('throws NOT_INITIALIZED before initialize()', () => {
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      expect(() => adapter.getStatus()).toThrow(AgentBnBError);
      adapter.close();
    });
  });

  describe('close', () => {
    it('can be called multiple times without error', () => {
      const adapter = new ClaudeCodeAdapter({ configDir: tempDir });
      adapter.close();
      adapter.close();
    });
  });
});
