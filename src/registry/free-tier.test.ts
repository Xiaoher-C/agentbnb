import { describe, it, expect, beforeEach } from 'vitest';
import { openCreditDb } from '../credit/ledger.js';
import Database from 'better-sqlite3';
import { initFreeTierTable, recordFreeTierUse, getFreeTierUsage } from './free-tier.js';

describe('Free-tier usage tracking', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
    initFreeTierTable(db);
  });

  it('Test 1: initFreeTierTable creates the table without error (idempotent)', () => {
    // Calling again should not throw — idempotent via CREATE TABLE IF NOT EXISTS
    expect(() => initFreeTierTable(db)).not.toThrow();
  });

  it('Test 2: recordFreeTierUse increments usage count for agent+skill pair', () => {
    recordFreeTierUse(db, 'agent-alice', 'skill-translate');
    recordFreeTierUse(db, 'agent-alice', 'skill-translate');
    recordFreeTierUse(db, 'agent-alice', 'skill-translate');

    const count = getFreeTierUsage(db, 'agent-alice', 'skill-translate');
    expect(count).toBe(3);
  });

  it('Test 3: getFreeTierUsage returns 0 for unknown agent+skill', () => {
    const count = getFreeTierUsage(db, 'agent-unknown', 'skill-nonexistent');
    expect(count).toBe(0);
  });

  it('Test 4: getFreeTierUsage returns correct count after multiple uses', () => {
    recordFreeTierUse(db, 'agent-bob', 'skill-summarize');
    recordFreeTierUse(db, 'agent-bob', 'skill-summarize');

    const count = getFreeTierUsage(db, 'agent-bob', 'skill-summarize');
    expect(count).toBe(2);
  });

  it('Test 5: Different agents have independent usage counts for same skill', () => {
    recordFreeTierUse(db, 'agent-alice', 'skill-classify');
    recordFreeTierUse(db, 'agent-alice', 'skill-classify');
    recordFreeTierUse(db, 'agent-bob', 'skill-classify');

    expect(getFreeTierUsage(db, 'agent-alice', 'skill-classify')).toBe(2);
    expect(getFreeTierUsage(db, 'agent-bob', 'skill-classify')).toBe(1);
  });
});
