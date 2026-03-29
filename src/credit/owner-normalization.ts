import type Database from 'better-sqlite3';
import { ensureAgentsTable, resolveCanonicalIdentity } from '../identity/agent-identity.js';

const RESERVED_OWNERS = new Set(['platform_treasury']);

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

function mergeBalanceRows(
  db: Database.Database,
  oldOwner: string,
  newOwner: string,
  now: string,
): void {
  if (!tableExists(db, 'credit_balances')) return;

  const oldRow = db
    .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
    .get(oldOwner) as { balance: number } | undefined;
  if (!oldRow) return;

  const newRow = db
    .prepare('SELECT balance FROM credit_balances WHERE owner = ?')
    .get(newOwner) as { balance: number } | undefined;

  if (newRow) {
    db.prepare(
      'UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE owner = ?',
    ).run(oldRow.balance, now, newOwner);
    db.prepare('DELETE FROM credit_balances WHERE owner = ?').run(oldOwner);
    return;
  }

  db.prepare('UPDATE credit_balances SET owner = ?, updated_at = ? WHERE owner = ?').run(
    newOwner,
    now,
    oldOwner,
  );
}

function mergeProviderRegistryRows(
  db: Database.Database,
  oldOwner: string,
  newOwner: string,
): void {
  if (!tableExists(db, 'provider_registry')) return;

  const oldRow = db
    .prepare('SELECT provider_number FROM provider_registry WHERE owner = ?')
    .get(oldOwner) as { provider_number: number } | undefined;
  if (!oldRow) return;

  const newRow = db
    .prepare('SELECT provider_number FROM provider_registry WHERE owner = ?')
    .get(newOwner) as { provider_number: number } | undefined;

  if (newRow) {
    db.prepare('DELETE FROM provider_registry WHERE owner = ?').run(oldOwner);
    return;
  }

  db.prepare('UPDATE provider_registry SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);
}

function mergeReliabilityRows(
  db: Database.Database,
  oldOwner: string,
  newOwner: string,
  now: string,
): void {
  if (!tableExists(db, 'provider_reliability_metrics')) return;

  const oldRow = db
    .prepare('SELECT * FROM provider_reliability_metrics WHERE owner = ?')
    .get(oldOwner) as
    | {
        owner: string;
        current_streak: number;
        longest_streak: number;
        total_hires: number;
        repeat_hires: number;
        feedback_count: number;
        feedback_sum: number;
        availability_checks: number;
        availability_hits: number;
        cycle_start: string;
        updated_at: string;
      }
    | undefined;
  if (!oldRow) return;

  const newRow = db
    .prepare('SELECT * FROM provider_reliability_metrics WHERE owner = ?')
    .get(newOwner) as typeof oldRow;

  if (!newRow) {
    db.prepare(
      'UPDATE provider_reliability_metrics SET owner = ?, updated_at = ? WHERE owner = ?',
    ).run(newOwner, now, oldOwner);
    return;
  }

  const cycleStartCandidates = [oldRow.cycle_start, newRow.cycle_start].filter(Boolean);
  const mergedCycleStart =
    cycleStartCandidates.length > 0
      ? cycleStartCandidates.slice().sort((left, right) => left.localeCompare(right))[0]!
      : now;

  db.prepare(
    `UPDATE provider_reliability_metrics
     SET current_streak = ?,
         longest_streak = ?,
         total_hires = ?,
         repeat_hires = ?,
         feedback_count = ?,
         feedback_sum = ?,
         availability_checks = ?,
         availability_hits = ?,
         cycle_start = ?,
         updated_at = ?
     WHERE owner = ?`,
  ).run(
    Math.max(oldRow.current_streak, newRow.current_streak),
    Math.max(oldRow.longest_streak, newRow.longest_streak),
    oldRow.total_hires + newRow.total_hires,
    oldRow.repeat_hires + newRow.repeat_hires,
    oldRow.feedback_count + newRow.feedback_count,
    oldRow.feedback_sum + newRow.feedback_sum,
    oldRow.availability_checks + newRow.availability_checks,
    oldRow.availability_hits + newRow.availability_hits,
    mergedCycleStart,
    now,
    newOwner,
  );
  db.prepare('DELETE FROM provider_reliability_metrics WHERE owner = ?').run(oldOwner);
}

/**
 * Migrates all legacy credit owner references from one identifier to another.
 * Safe to call repeatedly; existing rows are merged when both sides exist.
 */
export function migrateCreditOwnerData(
  db: Database.Database,
  oldOwner: string,
  newOwner: string,
): void {
  if (!oldOwner || !newOwner || oldOwner === newOwner) return;

  const now = new Date().toISOString();

  db.transaction(() => {
    mergeBalanceRows(db, oldOwner, newOwner, now);

    if (tableExists(db, 'credit_transactions')) {
      db.prepare('UPDATE credit_transactions SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);
    }

    if (tableExists(db, 'credit_escrow')) {
      db.prepare('UPDATE credit_escrow SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);
    }

    mergeProviderRegistryRows(db, oldOwner, newOwner);

    if (tableExists(db, 'demand_vouchers')) {
      db.prepare('UPDATE demand_vouchers SET owner = ? WHERE owner = ?').run(newOwner, oldOwner);
    }

    mergeReliabilityRows(db, oldOwner, newOwner, now);
  })();
}

/**
 * Resolves an owner or legacy alias to the canonical agent_id used by the credit system.
 * When an alias is resolved, legacy rows are migrated forward to the canonical owner.
 */
export function canonicalizeCreditOwner(
  db: Database.Database,
  owner: string,
): string {
  if (!owner || RESERVED_OWNERS.has(owner)) {
    return owner;
  }

  ensureAgentsTable(db);
  const resolved = resolveCanonicalIdentity(db, owner);
  if (!resolved.resolved) {
    return owner;
  }

  const aliases = new Set<string>();
  if (owner !== resolved.agent_id) {
    aliases.add(owner);
  }
  if (resolved.legacy_owner && resolved.legacy_owner !== resolved.agent_id) {
    aliases.add(resolved.legacy_owner);
  }

  for (const alias of aliases) {
    migrateCreditOwnerData(db, alias, resolved.agent_id);
  }

  return resolved.agent_id;
}
