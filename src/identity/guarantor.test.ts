import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  registerGuarantor,
  linkAgentToGuarantor,
  getGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
  ensureGuarantorTables,
  MAX_AGENTS_PER_GUARANTOR,
  GUARANTOR_CREDIT_POOL,
} from './guarantor.js';
import { AgentBnBError } from '../types/index.js';

describe('guarantor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureGuarantorTables(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('registerGuarantor', () => {
    it('creates a guarantor with the default credit pool', () => {
      const record = registerGuarantor(db, 'octocat');
      expect(record.github_login).toBe('octocat');
      expect(record.credit_pool).toBe(GUARANTOR_CREDIT_POOL);
      expect(record.agent_count).toBe(0);
      expect(record.id).toBeTruthy();
    });

    it('throws GUARANTOR_EXISTS if login already registered', () => {
      registerGuarantor(db, 'octocat');
      expect(() => registerGuarantor(db, 'octocat')).toThrow(AgentBnBError);
      try {
        registerGuarantor(db, 'octocat');
      } catch (err) {
        expect((err as AgentBnBError).code).toBe('GUARANTOR_EXISTS');
      }
    });
  });

  describe('getGuarantor', () => {
    it('returns null for unknown login', () => {
      expect(getGuarantor(db, 'nonexistent')).toBeNull();
    });

    it('returns the guarantor record', () => {
      registerGuarantor(db, 'octocat');
      const record = getGuarantor(db, 'octocat');
      expect(record).not.toBeNull();
      expect(record!.github_login).toBe('octocat');
    });
  });

  describe('linkAgentToGuarantor', () => {
    it('links an agent and increments agent_count', () => {
      registerGuarantor(db, 'octocat');
      const updated = linkAgentToGuarantor(db, 'agent-001', 'octocat');
      expect(updated.agent_count).toBe(1);
    });

    it('links multiple agents up to the maximum', () => {
      registerGuarantor(db, 'octocat');
      for (let i = 0; i < MAX_AGENTS_PER_GUARANTOR; i++) {
        linkAgentToGuarantor(db, `agent-${i}`, 'octocat');
      }
      const record = getGuarantor(db, 'octocat');
      expect(record!.agent_count).toBe(MAX_AGENTS_PER_GUARANTOR);
    });

    it('throws MAX_AGENTS_EXCEEDED when limit reached', () => {
      registerGuarantor(db, 'octocat');
      for (let i = 0; i < MAX_AGENTS_PER_GUARANTOR; i++) {
        linkAgentToGuarantor(db, `agent-${i}`, 'octocat');
      }
      expect(() => linkAgentToGuarantor(db, 'agent-overflow', 'octocat')).toThrow(AgentBnBError);
      try {
        linkAgentToGuarantor(db, 'agent-overflow', 'octocat');
      } catch (err) {
        expect((err as AgentBnBError).code).toBe('MAX_AGENTS_EXCEEDED');
      }
    });

    it('throws GUARANTOR_NOT_FOUND for unknown login', () => {
      expect(() => linkAgentToGuarantor(db, 'agent-001', 'unknown')).toThrow(AgentBnBError);
      try {
        linkAgentToGuarantor(db, 'agent-001', 'unknown');
      } catch (err) {
        expect((err as AgentBnBError).code).toBe('GUARANTOR_NOT_FOUND');
      }
    });

    it('throws AGENT_ALREADY_LINKED if agent is already linked', () => {
      registerGuarantor(db, 'octocat');
      linkAgentToGuarantor(db, 'agent-001', 'octocat');
      expect(() => linkAgentToGuarantor(db, 'agent-001', 'octocat')).toThrow(AgentBnBError);
      try {
        linkAgentToGuarantor(db, 'agent-001', 'octocat');
      } catch (err) {
        expect((err as AgentBnBError).code).toBe('AGENT_ALREADY_LINKED');
      }
    });
  });

  describe('getAgentGuarantor', () => {
    it('returns null for unlinked agent', () => {
      expect(getAgentGuarantor(db, 'unlinked-agent')).toBeNull();
    });

    it('returns the guarantor for a linked agent', () => {
      registerGuarantor(db, 'octocat');
      linkAgentToGuarantor(db, 'agent-001', 'octocat');
      const guarantor = getAgentGuarantor(db, 'agent-001');
      expect(guarantor).not.toBeNull();
      expect(guarantor!.github_login).toBe('octocat');
    });
  });

  describe('initiateGithubAuth', () => {
    it('throws when GITHUB_CLIENT_ID is not set', () => {
      const original = process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_ID;
      try {
        expect(() => initiateGithubAuth(db)).toThrow(/GITHUB_CLIENT_ID/);
      } finally {
        if (original !== undefined) process.env.GITHUB_CLIENT_ID = original;
      }
    });

    it('returns an auth_url with client_id and stores state when configured', () => {
      process.env.GITHUB_CLIENT_ID = 'test-client-id';
      try {
        const auth = initiateGithubAuth(db);
        expect(auth.auth_url).toContain('github.com');
        expect(auth.auth_url).toContain('client_id=test-client-id');
        expect(auth.auth_url).toContain(`state=${auth.state}`);
        expect(auth.state).toBeTruthy();
      } finally {
        delete process.env.GITHUB_CLIENT_ID;
      }
    });
  });

  describe('constants', () => {
    it('MAX_AGENTS_PER_GUARANTOR is 10', () => {
      expect(MAX_AGENTS_PER_GUARANTOR).toBe(10);
    });

    it('GUARANTOR_CREDIT_POOL is 50', () => {
      expect(GUARANTOR_CREDIT_POOL).toBe(50);
    });
  });
});
