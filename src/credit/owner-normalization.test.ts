import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openCreditDb } from './ledger.js';
import { createAgentRecord } from '../identity/agent-identity.js';
import {
  canonicalizeCreditOwner,
  migrateCreditOwnerData,
} from './owner-normalization.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertBalance(db: Database.Database, owner: string, balance: number): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO credit_balances (owner, balance, updated_at) VALUES (?, ?, ?)',
  ).run(owner, balance, now);
}

function getBalance(db: Database.Database, owner: string): number | undefined {
  const row = db
    .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
    .get(owner) as { balance: number } | undefined;
  return row?.balance;
}

function insertTransaction(db: Database.Database, owner: string, amount: number): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO credit_transactions (id, owner, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`tx-${Math.random()}`, owner, amount, 'bootstrap', null, now);
}

function insertEscrow(db: Database.Database, owner: string, amount: number): string {
  const now = new Date().toISOString();
  const id = `esc-${Math.random()}`;
  db.prepare(
    "INSERT INTO credit_escrow (id, owner, amount, card_id, status, created_at, funding_source) VALUES (?, ?, ?, ?, 'held', ?, 'balance')",
  ).run(id, owner, amount, 'card-1', now);
  return id;
}

function insertProviderRegistry(db: Database.Database, owner: string, num: number): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO provider_registry (owner, provider_number, registered_at) VALUES (?, ?, ?)',
  ).run(owner, num, now);
}

function insertDemandVoucher(db: Database.Database, owner: string, amount: number): string {
  const now = new Date().toISOString();
  const id = `voucher-${Math.random()}`;
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare(
    'INSERT INTO demand_vouchers (id, owner, amount, remaining, created_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
  ).run(id, owner, amount, amount, now, expires);
  return id;
}

function insertReliability(
  db: Database.Database,
  owner: string,
  overrides: Partial<{
    current_streak: number;
    longest_streak: number;
    total_hires: number;
    repeat_hires: number;
    feedback_count: number;
    feedback_sum: number;
    availability_checks: number;
    availability_hits: number;
    cycle_start: string;
  }> = {},
): void {
  const now = new Date().toISOString();
  const d = {
    current_streak: 0,
    longest_streak: 0,
    total_hires: 0,
    repeat_hires: 0,
    feedback_count: 0,
    feedback_sum: 0,
    availability_checks: 0,
    availability_hits: 0,
    cycle_start: now,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO provider_reliability_metrics
     (owner, current_streak, longest_streak, total_hires, repeat_hires,
      feedback_count, feedback_sum, availability_checks, availability_hits,
      cycle_start, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    owner,
    d.current_streak,
    d.longest_streak,
    d.total_hires,
    d.repeat_hires,
    d.feedback_count,
    d.feedback_sum,
    d.availability_checks,
    d.availability_hits,
    d.cycle_start,
    now,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateCreditOwnerData', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
  });

  it('should merge balances when both old and new owner exist', () => {
    // Arrange
    insertBalance(db, 'old-agent', 50);
    insertBalance(db, 'new-agent', 30);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    expect(getBalance(db, 'new-agent')).toBe(80);
    expect(getBalance(db, 'old-agent')).toBeUndefined();
  });

  it('should move balance row when only old owner exists', () => {
    // Arrange
    insertBalance(db, 'old-agent', 100);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    expect(getBalance(db, 'new-agent')).toBe(100);
    expect(getBalance(db, 'old-agent')).toBeUndefined();
  });

  it('should be a no-op when old owner has no data', () => {
    // Arrange
    insertBalance(db, 'new-agent', 50);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    expect(getBalance(db, 'new-agent')).toBe(50);
  });

  it('should be a no-op when oldOwner equals newOwner', () => {
    // Arrange
    insertBalance(db, 'same-agent', 100);

    // Act
    migrateCreditOwnerData(db, 'same-agent', 'same-agent');

    // Assert
    expect(getBalance(db, 'same-agent')).toBe(100);
  });

  it('should be a no-op when oldOwner is empty string', () => {
    // Arrange
    insertBalance(db, 'new-agent', 50);

    // Act
    migrateCreditOwnerData(db, '', 'new-agent');

    // Assert
    expect(getBalance(db, 'new-agent')).toBe(50);
  });

  it('should be a no-op when newOwner is empty string', () => {
    // Arrange
    insertBalance(db, 'old-agent', 50);

    // Act
    migrateCreditOwnerData(db, 'old-agent', '');

    // Assert
    expect(getBalance(db, 'old-agent')).toBe(50);
  });

  it('should migrate transaction rows from old to new owner', () => {
    // Arrange
    insertTransaction(db, 'old-agent', 10);
    insertTransaction(db, 'old-agent', 20);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const rows = db
      .prepare('SELECT owner FROM credit_transactions WHERE owner = ?')
      .all('new-agent') as { owner: string }[];
    expect(rows).toHaveLength(2);
    const oldRows = db
      .prepare('SELECT owner FROM credit_transactions WHERE owner = ?')
      .all('old-agent') as { owner: string }[];
    expect(oldRows).toHaveLength(0);
  });

  it('should migrate escrow rows from old to new owner', () => {
    // Arrange
    const escrowId = insertEscrow(db, 'old-agent', 25);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const row = db
      .prepare('SELECT owner FROM credit_escrow WHERE id = ?')
      .get(escrowId) as { owner: string };
    expect(row.owner).toBe('new-agent');
  });

  it('should migrate demand voucher rows from old to new owner', () => {
    // Arrange
    const voucherId = insertDemandVoucher(db, 'old-agent', 50);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const row = db
      .prepare('SELECT owner FROM demand_vouchers WHERE id = ?')
      .get(voucherId) as { owner: string };
    expect(row.owner).toBe('new-agent');
  });

  it('should merge provider registry rows when both exist', () => {
    // Arrange
    insertProviderRegistry(db, 'old-agent', 1);
    insertProviderRegistry(db, 'new-agent', 2);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert - new-agent keeps its row, old-agent is deleted
    const newRow = db
      .prepare('SELECT provider_number FROM provider_registry WHERE owner = ?')
      .get('new-agent') as { provider_number: number } | undefined;
    expect(newRow?.provider_number).toBe(2);
    const oldRow = db
      .prepare('SELECT provider_number FROM provider_registry WHERE owner = ?')
      .get('old-agent') as { provider_number: number } | undefined;
    expect(oldRow).toBeUndefined();
  });

  it('should move provider registry row when only old owner exists', () => {
    // Arrange
    insertProviderRegistry(db, 'old-agent', 5);

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const row = db
      .prepare('SELECT provider_number FROM provider_registry WHERE owner = ?')
      .get('new-agent') as { provider_number: number } | undefined;
    expect(row?.provider_number).toBe(5);
  });

  it('should merge reliability metrics when both exist', () => {
    // Arrange
    insertReliability(db, 'old-agent', {
      current_streak: 3,
      longest_streak: 5,
      total_hires: 10,
      repeat_hires: 2,
      feedback_count: 4,
      feedback_sum: 16,
      availability_checks: 20,
      availability_hits: 18,
      cycle_start: '2025-01-01T00:00:00.000Z',
    });
    insertReliability(db, 'new-agent', {
      current_streak: 1,
      longest_streak: 7,
      total_hires: 5,
      repeat_hires: 1,
      feedback_count: 2,
      feedback_sum: 8,
      availability_checks: 10,
      availability_hits: 9,
      cycle_start: '2025-06-01T00:00:00.000Z',
    });

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const row = db
      .prepare('SELECT * FROM provider_reliability_metrics WHERE owner = ?')
      .get('new-agent') as Record<string, unknown>;
    expect(row.current_streak).toBe(3); // max(3, 1)
    expect(row.longest_streak).toBe(7); // max(5, 7)
    expect(row.total_hires).toBe(15); // 10 + 5
    expect(row.repeat_hires).toBe(3); // 2 + 1
    expect(row.feedback_count).toBe(6); // 4 + 2
    expect(row.feedback_sum).toBe(24); // 16 + 8
    expect(row.availability_checks).toBe(30); // 20 + 10
    expect(row.availability_hits).toBe(27); // 18 + 9
    expect(row.cycle_start).toBe('2025-01-01T00:00:00.000Z'); // earlier date

    const oldRow = db
      .prepare('SELECT * FROM provider_reliability_metrics WHERE owner = ?')
      .get('old-agent');
    expect(oldRow).toBeUndefined();
  });

  it('should move reliability metrics when only old owner exists', () => {
    // Arrange
    insertReliability(db, 'old-agent', { total_hires: 7 });

    // Act
    migrateCreditOwnerData(db, 'old-agent', 'new-agent');

    // Assert
    const row = db
      .prepare('SELECT total_hires FROM provider_reliability_metrics WHERE owner = ?')
      .get('new-agent') as { total_hires: number } | undefined;
    expect(row?.total_hires).toBe(7);
  });

  describe('edge cases: special characters and spaces in owner names', () => {
    it('should handle owner names with spaces', () => {
      // Arrange
      insertBalance(db, 'agent with spaces', 40);

      // Act
      migrateCreditOwnerData(db, 'agent with spaces', 'clean-agent');

      // Assert
      expect(getBalance(db, 'clean-agent')).toBe(40);
      expect(getBalance(db, 'agent with spaces')).toBeUndefined();
    });

    it('should handle owner names with special characters', () => {
      // Arrange
      insertBalance(db, 'agent@host:8080/path', 60);

      // Act
      migrateCreditOwnerData(db, 'agent@host:8080/path', 'canonical-id');

      // Assert
      expect(getBalance(db, 'canonical-id')).toBe(60);
      expect(getBalance(db, 'agent@host:8080/path')).toBeUndefined();
    });

    it('should handle owner names with leading/trailing spaces', () => {
      // Arrange - simulates genesis-bot credit sync issue
      insertBalance(db, ' spaced-agent ', 25);

      // Act
      migrateCreditOwnerData(db, ' spaced-agent ', 'spaced-agent');

      // Assert
      expect(getBalance(db, 'spaced-agent')).toBe(25);
      expect(getBalance(db, ' spaced-agent ')).toBeUndefined();
    });

    it('should handle owner names with unicode characters', () => {
      // Arrange
      insertBalance(db, 'agent-\u00e9\u00e8\u00ea', 15);

      // Act
      migrateCreditOwnerData(db, 'agent-\u00e9\u00e8\u00ea', 'normalized');

      // Assert
      expect(getBalance(db, 'normalized')).toBe(15);
    });
  });
});

describe('canonicalizeCreditOwner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openCreditDb(':memory:');
  });

  it('should return the canonical agent_id when a matching agent record exists by legacy_owner', () => {
    // Arrange
    createAgentRecord(db, {
      agent_id: 'abcdef0123456789',
      display_name: 'Test Agent',
      public_key: 'deadbeef',
      legacy_owner: 'old-owner-string',
    });

    // Act
    const result = canonicalizeCreditOwner(db, 'old-owner-string');

    // Assert
    expect(result).toBe('abcdef0123456789');
  });

  it('should return the canonical agent_id when looked up by agent_id directly', () => {
    // Arrange
    createAgentRecord(db, {
      agent_id: 'abcdef0123456789',
      display_name: 'Test Agent',
      public_key: 'deadbeef',
    });

    // Act
    const result = canonicalizeCreditOwner(db, 'abcdef0123456789');

    // Assert
    expect(result).toBe('abcdef0123456789');
  });

  it('should return the input unchanged when no agent record matches', () => {
    // Arrange - no agent records

    // Act
    const result = canonicalizeCreditOwner(db, 'unknown-owner');

    // Assert
    expect(result).toBe('unknown-owner');
  });

  it('should return reserved owner names unchanged', () => {
    // Act
    const result = canonicalizeCreditOwner(db, 'platform_treasury');

    // Assert
    expect(result).toBe('platform_treasury');
  });

  it('should return empty string unchanged', () => {
    // Act
    const result = canonicalizeCreditOwner(db, '');

    // Assert
    expect(result).toBe('');
  });

  it('should migrate balance data from legacy owner to canonical agent_id', () => {
    // Arrange
    insertBalance(db, 'legacy-name', 200);
    createAgentRecord(db, {
      agent_id: 'abcdef0123456789',
      display_name: 'Test Agent',
      public_key: 'deadbeef',
      legacy_owner: 'legacy-name',
    });

    // Act
    const result = canonicalizeCreditOwner(db, 'legacy-name');

    // Assert
    expect(result).toBe('abcdef0123456789');
    expect(getBalance(db, 'abcdef0123456789')).toBe(200);
    expect(getBalance(db, 'legacy-name')).toBeUndefined();
  });

  it('should handle owner names with spaces during canonicalization', () => {
    // Arrange - simulates genesis-bot credit sync bug with spaces
    insertBalance(db, 'agent with space', 75);
    createAgentRecord(db, {
      agent_id: '1234567890abcdef',
      display_name: 'Spaced Agent',
      public_key: 'cafebabe',
      legacy_owner: 'agent with space',
    });

    // Act
    const result = canonicalizeCreditOwner(db, 'agent with space');

    // Assert
    expect(result).toBe('1234567890abcdef');
    expect(getBalance(db, '1234567890abcdef')).toBe(75);
    expect(getBalance(db, 'agent with space')).toBeUndefined();
  });

  it('should not migrate data for reserved owners even if agent record exists', () => {
    // Act - platform_treasury is reserved, should skip resolution
    const result = canonicalizeCreditOwner(db, 'platform_treasury');

    // Assert
    expect(result).toBe('platform_treasury');
  });
});
