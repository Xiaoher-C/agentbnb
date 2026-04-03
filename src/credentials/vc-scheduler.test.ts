import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { generateKeyPair } from '../credit/signing.js';
import {
  ensureVCTable,
  upsertCredential,
  getStoredCredentials,
  refreshAllCredentials,
} from './vc-scheduler.js';
import { issueCredential } from './vc.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE capability_cards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE request_log (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      card_name TEXT DEFAULT '',
      requester TEXT DEFAULT '',
      status TEXT NOT NULL,
      latency_ms INTEGER DEFAULT 0,
      credits_charged INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      skill_id TEXT,
      action_type TEXT,
      failure_reason TEXT
    );
    CREATE TABLE feedback (
      id TEXT PRIMARY KEY,
      provider_agent TEXT NOT NULL,
      skill_id TEXT,
      rating INTEGER,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe('vc-scheduler', () => {
  const keys = generateKeyPair();

  describe('ensureVCTable', () => {
    it('creates vc_credentials table idempotently', () => {
      const db = createTestDb();
      ensureVCTable(db);
      ensureVCTable(db); // second call should not throw
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vc_credentials'").all();
      expect(tables).toHaveLength(1);
      db.close();
    });
  });

  describe('upsertCredential', () => {
    it('inserts and updates credentials', () => {
      const db = createTestDb();
      const vc = issueCredential({
        subject: { id: 'did:agentbnb:test1' },
        types: ['VerifiableCredential', 'AgentReputationCredential'],
        issuerDid: 'did:agentbnb:platform',
        signerKey: keys.privateKey,
      });

      upsertCredential(db, 'test1', 'AgentReputationCredential', vc);
      let stored = getStoredCredentials(db, 'test1');
      expect(stored).toHaveLength(1);
      expect(stored[0]!.credential_type).toBe('AgentReputationCredential');

      // Upsert replaces
      upsertCredential(db, 'test1', 'AgentReputationCredential', vc);
      stored = getStoredCredentials(db, 'test1');
      expect(stored).toHaveLength(1); // still 1, not 2
      db.close();
    });
  });

  describe('refreshAllCredentials', () => {
    it('issues ReputationCredential for agents with executions', () => {
      const db = createTestDb();

      // Insert agent card
      db.prepare(`INSERT INTO capability_cards (id, owner, data) VALUES (?, ?, ?)`).run(
        'card-1', 'alice',
        JSON.stringify({ id: 'card-1', owner: 'alice', agent_id: 'aaa1112233445566', spec_version: '2.0', agent_name: 'Alice', skills: [{ id: 'summarize', name: 'Summarize', description: '', level: 1, inputs: [], outputs: [], pricing: { credits_per_call: 5 } }], availability: { online: true } }),
      );

      // Insert execution logs
      for (let i = 0; i < 5; i++) {
        db.prepare(`INSERT INTO request_log (id, card_id, status, latency_ms, credits_charged, skill_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
          `req-${i}`, 'card-1', 'success', 1000 + i * 100, 5, 'summarize',
        );
      }

      const count = refreshAllCredentials(db, keys.privateKey);
      expect(count).toBe(1); // 1 reputation only (5 uses < 100 milestone)

      const stored = getStoredCredentials(db, 'aaa1112233445566');
      expect(stored).toHaveLength(1);
      expect(stored[0]!.credential_type).toBe('AgentReputationCredential');

      const vc = JSON.parse(stored[0]!.credential_json);
      expect(vc.type).toContain('AgentReputationCredential');
      expect(vc.credentialSubject.totalTransactions).toBe(5);
      expect(vc.credentialSubject.successRate).toBe(1);
      expect(vc.proof).toBeDefined();
      expect(vc.proof.type).toBe('Ed25519Signature2020');

      db.close();
    });

    it('issues SkillCredential for milestones', () => {
      const db = createTestDb();

      db.prepare(`INSERT INTO capability_cards (id, owner, data) VALUES (?, ?, ?)`).run(
        'card-2', 'bob',
        JSON.stringify({ id: 'card-2', owner: 'bob', agent_id: 'bbb2223344556677', spec_version: '2.0', agent_name: 'Bob', skills: [{ id: 'translate', name: 'Translate', description: '', level: 1, inputs: [], outputs: [], pricing: { credits_per_call: 3 } }], availability: { online: true } }),
      );

      // Insert 150 executions for 'translate' skill
      const insert = db.prepare(`INSERT INTO request_log (id, card_id, status, latency_ms, credits_charged, skill_id) VALUES (?, ?, ?, ?, ?, ?)`);
      for (let i = 0; i < 150; i++) {
        insert.run(`req-b-${i}`, 'card-2', i < 140 ? 'success' : 'failure', 500, 3, 'translate');
      }

      const count = refreshAllCredentials(db, keys.privateKey);
      expect(count).toBe(2); // 1 reputation + 1 skill (bronze: 150 >= 100)

      const stored = getStoredCredentials(db, 'bbb2223344556677');
      const skillCred = stored.find((s) => s.credential_type.startsWith('AgentSkillCredential'));
      expect(skillCred).toBeDefined();

      const vc = JSON.parse(skillCred!.credential_json);
      expect(vc.credentialSubject.milestone).toBe(100);
      expect(vc.credentialSubject.milestoneLevel).toBe('bronze');
      expect(vc.credentialSubject.totalUses).toBe(150);

      db.close();
    });

    it('returns 0 for agents with no executions', () => {
      const db = createTestDb();
      db.prepare(`INSERT INTO capability_cards (id, owner, data) VALUES (?, ?, ?)`).run(
        'card-3', 'charlie',
        JSON.stringify({ id: 'card-3', owner: 'charlie', agent_id: 'ccc3334455667788', spec_version: '2.0', agent_name: 'Charlie', skills: [{ id: 'echo', name: 'Echo', description: '', level: 1, inputs: [], outputs: [], pricing: { credits_per_call: 1 } }], availability: { online: true } }),
      );

      const count = refreshAllCredentials(db, keys.privateKey);
      expect(count).toBe(0);
      db.close();
    });

    it('is idempotent — second run replaces, not duplicates', () => {
      const db = createTestDb();
      db.prepare(`INSERT INTO capability_cards (id, owner, data) VALUES (?, ?, ?)`).run(
        'card-4', 'dave',
        JSON.stringify({ id: 'card-4', owner: 'dave', agent_id: 'ddd4445566778899', spec_version: '2.0', agent_name: 'Dave', skills: [{ id: 'code', name: 'Code', description: '', level: 1, inputs: [], outputs: [], pricing: { credits_per_call: 10 } }], availability: { online: true } }),
      );
      for (let i = 0; i < 3; i++) {
        db.prepare(`INSERT INTO request_log (id, card_id, status, latency_ms, credits_charged, skill_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
          `req-d-${i}`, 'card-4', 'success', 800, 10, 'code',
        );
      }

      refreshAllCredentials(db, keys.privateKey);
      refreshAllCredentials(db, keys.privateKey);

      const stored = getStoredCredentials(db, 'ddd4445566778899');
      expect(stored).toHaveLength(1); // only 1 reputation, no duplicate
      db.close();
    });
  });
});
