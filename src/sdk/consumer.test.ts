import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentBnBConsumer } from './consumer.js';
import { createIdentity } from '../identity/identity.js';
import { generateKeyPair, saveKeyPair } from '../credit/signing.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { AgentBnBError } from '../types/index.js';
import { writeFileSync } from 'node:fs';

describe('AgentBnBConsumer', () => {
  let tempDir: string;
  const OWNER = 'test-consumer';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentbnb-consumer-'));
    // Set up identity, keypair, and credit DB
    const keys = generateKeyPair();
    saveKeyPair(tempDir, keys);
    createIdentity(tempDir, OWNER);
    const db = openCreditDb(join(tempDir, 'credit.db'));
    bootstrapAgent(db, OWNER, 100);
    db.close();

    // Write minimal config so authenticate() uses correct owner
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      owner: OWNER,
      db_path: join(tempDir, 'registry.db'),
      credit_db_path: join(tempDir, 'credit.db'),
      gateway_url: 'http://localhost:7700',
      gateway_port: 7700,
      token: 'test-token',
    }));

    // Point config to temp dir
    process.env['AGENTBNB_DIR'] = tempDir;
  });

  afterEach(() => {
    delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('authenticate', () => {
    it('loads identity from config directory', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      const identity = consumer.authenticate();
      expect(identity.owner).toBe(OWNER);
      expect(identity.agent_id).toBeTruthy();
      consumer.close();
    });
  });

  describe('getIdentity', () => {
    it('throws NOT_AUTHENTICATED before authenticate()', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      expect(() => consumer.getIdentity()).toThrow(AgentBnBError);
      consumer.close();
    });

    it('returns identity after authenticate()', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      consumer.authenticate();
      const identity = consumer.getIdentity();
      expect(identity.owner).toBe(OWNER);
      consumer.close();
    });
  });

  describe('getBalance', () => {
    it('returns the bootstrapped credit balance', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      consumer.authenticate();
      expect(consumer.getBalance()).toBe(100);
      consumer.close();
    });
  });

  describe('getReputation', () => {
    it('returns default reputation for new agent', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      consumer.authenticate();
      const rep = consumer.getReputation();
      expect(rep.success_rate).toBe(1); // no requests = 100% default
      expect(rep.total_requests).toBe(0);
      consumer.close();
    });
  });

  describe('close', () => {
    it('can be called multiple times without error', () => {
      const consumer = new AgentBnBConsumer({ configDir: tempDir });
      consumer.authenticate();
      consumer.close();
      consumer.close(); // Should not throw
    });
  });
});
