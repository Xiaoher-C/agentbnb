import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  getAutonomyTier,
  DEFAULT_AUTONOMY_CONFIG,
  insertAuditEvent,
} from './tiers.js';
import type { AutonomyConfig, AutonomyEvent } from './tiers.js';
import { createRequestLogTable } from '../registry/request-log.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-tiers-test-'));
  db = new Database(join(tmpDir, 'test.db'));
  createRequestLogTable(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getAutonomyTier — boundary tests
// ---------------------------------------------------------------------------

describe('getAutonomyTier', () => {
  const config: AutonomyConfig = {
    tier1_max_credits: 10,
    tier2_max_credits: 50,
  };

  it('returns 1 when creditAmount < tier1_max_credits', () => {
    expect(getAutonomyTier(5, config)).toBe(1);
  });

  it('returns 1 when creditAmount is 0 and tier1_max_credits > 0', () => {
    expect(getAutonomyTier(0, config)).toBe(1);
  });

  it('returns 2 when tier1_max_credits <= creditAmount < tier2_max_credits', () => {
    expect(getAutonomyTier(25, config)).toBe(2);
  });

  it('returns 3 when creditAmount >= tier2_max_credits', () => {
    expect(getAutonomyTier(100, config)).toBe(3);
  });

  it('returns 2 at exact tier1_max_credits boundary (amount equals tier1_max_credits)', () => {
    // amount == tier1_max_credits: NOT < tier1, so falls to tier2 check
    expect(getAutonomyTier(10, config)).toBe(2);
  });

  it('returns 3 at exact tier2_max_credits boundary (amount equals tier2_max_credits)', () => {
    // amount == tier2_max_credits: NOT < tier2, so returns 3
    expect(getAutonomyTier(50, config)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_AUTONOMY_CONFIG — Tier 3 by default for all amounts
// ---------------------------------------------------------------------------

describe('DEFAULT_AUTONOMY_CONFIG', () => {
  it('has tier1_max_credits=0 and tier2_max_credits=0', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.tier1_max_credits).toBe(0);
    expect(DEFAULT_AUTONOMY_CONFIG.tier2_max_credits).toBe(0);
  });

  it('returns Tier 3 for amount 0', () => {
    expect(getAutonomyTier(0, DEFAULT_AUTONOMY_CONFIG)).toBe(3);
  });

  it('returns Tier 3 for amount 5', () => {
    expect(getAutonomyTier(5, DEFAULT_AUTONOMY_CONFIG)).toBe(3);
  });

  it('returns Tier 3 for amount 10', () => {
    expect(getAutonomyTier(10, DEFAULT_AUTONOMY_CONFIG)).toBe(3);
  });

  it('returns Tier 3 for amount 50', () => {
    expect(getAutonomyTier(50, DEFAULT_AUTONOMY_CONFIG)).toBe(3);
  });

  it('returns Tier 3 for amount 100', () => {
    expect(getAutonomyTier(100, DEFAULT_AUTONOMY_CONFIG)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// insertAuditEvent — writes audit rows correctly
// ---------------------------------------------------------------------------

describe('insertAuditEvent', () => {
  it('writes an auto_share event with correct action_type and tier_invoked', () => {
    const event: AutonomyEvent = {
      type: 'auto_share',
      skill_id: 'skill-abc',
      tier_invoked: 1,
      idle_rate: 0.8,
    };

    insertAuditEvent(db, event);

    const row = db
      .prepare(
        'SELECT * FROM request_log WHERE action_type = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get('auto_share') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['action_type']).toBe('auto_share');
    expect(row!['tier_invoked']).toBe(1);
    expect(row!['card_name']).toBe('autonomy-audit');
    expect(row!['requester']).toBe('self');
    expect(row!['status']).toBe('success');
    expect(row!['skill_id']).toBe('skill-abc');
    expect(row!['credits_charged']).toBe(0);
  });

  it('writes an auto_request event with correct credits and peer info', () => {
    const event: AutonomyEvent = {
      type: 'auto_request',
      card_id: 'card-xyz',
      skill_id: 'skill-xyz',
      tier_invoked: 1,
      credits: 5,
      peer: 'agent-bob',
    };

    insertAuditEvent(db, event);

    const row = db
      .prepare(
        'SELECT * FROM request_log WHERE action_type = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get('auto_request') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['action_type']).toBe('auto_request');
    expect(row!['tier_invoked']).toBe(1);
    expect(row!['card_id']).toBe('card-xyz');
    expect(row!['credits_charged']).toBe(5);
    expect(row!['skill_id']).toBe('skill-xyz');
  });

  it('writes an auto_share_notify (Tier 2) event', () => {
    const event: AutonomyEvent = {
      type: 'auto_share_notify',
      skill_id: 'skill-notify',
      tier_invoked: 2,
      idle_rate: 0.5,
    };

    insertAuditEvent(db, event);

    const row = db
      .prepare(
        'SELECT * FROM request_log WHERE action_type = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get('auto_share_notify') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['tier_invoked']).toBe(2);
    expect(row!['card_id']).toBe('system');
  });

  it('writes an auto_request_pending (Tier 3) event', () => {
    const event: AutonomyEvent = {
      type: 'auto_request_pending',
      card_id: 'card-pending',
      skill_id: 'skill-pending',
      tier_invoked: 3,
      credits: 100,
      peer: 'agent-charlie',
    };

    insertAuditEvent(db, event);

    const row = db
      .prepare(
        'SELECT * FROM request_log WHERE action_type = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get('auto_request_pending') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['tier_invoked']).toBe(3);
    expect(row!['credits_charged']).toBe(100);
  });
});
