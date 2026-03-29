import type Database from 'better-sqlite3';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Agent record in the centralized agents table.
 * Represents a cryptographically-bound agent identity in the network.
 */
export interface AgentRecord {
  /** Primary key: hex(sha256(public_key)).slice(0, 16) */
  agent_id: string;
  /** Human-readable display name */
  display_name: string;
  /** Hex-encoded Ed25519 public key */
  public_key: string;
  /** Operator who claims this agent (nullable) */
  operator_id: string | null;
  /** Server currently running this agent (nullable) */
  server_id: string | null;
  /** Legacy owner string for backward compatibility */
  legacy_owner: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AGENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    operator_id TEXT,
    server_id TEXT,
    legacy_owner TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agents_operator ON agents(operator_id);
  CREATE INDEX IF NOT EXISTS idx_agents_legacy_owner ON agents(legacy_owner);
`;

/**
 * Creates the agents table if it does not exist.
 * Safe to call multiple times (idempotent).
 *
 * @param db - SQLite database instance (credit DB or registry DB).
 */
export function ensureAgentsTable(db: Database.Database): void {
  db.exec(AGENTS_SCHEMA);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Creates an agent record in the agents table.
 * Throws if an agent with this agent_id already exists.
 *
 * @param db - Database instance with agents table.
 * @param agent - Agent record to insert.
 */
export function createAgentRecord(
  db: Database.Database,
  agent: Pick<AgentRecord, 'agent_id' | 'display_name' | 'public_key'> &
    Partial<Pick<AgentRecord, 'operator_id' | 'server_id' | 'legacy_owner'>>,
): AgentRecord {
  const now = new Date().toISOString();

  const record: AgentRecord = {
    agent_id: agent.agent_id,
    display_name: agent.display_name,
    public_key: agent.public_key,
    operator_id: agent.operator_id ?? null,
    server_id: agent.server_id ?? null,
    legacy_owner: agent.legacy_owner ?? null,
    created_at: now,
    updated_at: now,
  };

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO agents
       (agent_id, display_name, public_key, operator_id, server_id, legacy_owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.agent_id,
      record.display_name,
      record.public_key,
      record.operator_id,
      record.server_id,
      record.legacy_owner,
      record.created_at,
      record.updated_at,
    );

  if (result.changes === 0) {
    throw new AgentBnBError(
      'AGENT_EXISTS',
      `Agent ${agent.agent_id} already exists`,
    );
  }

  return record;
}

/**
 * Looks up an agent by agent_id.
 *
 * @param db - Database instance with agents table.
 * @param agentId - The 16-char hex agent ID.
 * @returns AgentRecord or null if not found.
 */
export function lookupAgent(
  db: Database.Database,
  agentId: string,
): AgentRecord | null {
  return (
    (db
      .prepare('SELECT * FROM agents WHERE agent_id = ?')
      .get(agentId) as AgentRecord | undefined) ?? null
  );
}

/**
 * Looks up an agent by legacy owner string.
 * Used during the v7→v8 transition period.
 *
 * @param db - Database instance with agents table.
 * @param owner - Legacy owner string.
 * @returns AgentRecord or null if not found.
 */
export function lookupAgentByOwner(
  db: Database.Database,
  owner: string,
): AgentRecord | null {
  return (
    (db
      .prepare('SELECT * FROM agents WHERE legacy_owner = ?')
      .get(owner) as AgentRecord | undefined) ?? null
  );
}

/**
 * Lists all agents claimed by an operator.
 *
 * @param db - Database instance with agents table.
 * @param operatorId - Operator identifier.
 * @returns Array of agent records.
 */
export function listAgentsByOperator(
  db: Database.Database,
  operatorId: string,
): AgentRecord[] {
  return db
    .prepare('SELECT * FROM agents WHERE operator_id = ? ORDER BY created_at')
    .all(operatorId) as AgentRecord[];
}

/**
 * Updates mutable fields on an agent record.
 *
 * @param db - Database instance with agents table.
 * @param agentId - Agent to update.
 * @param updates - Fields to change.
 */
export function updateAgentRecord(
  db: Database.Database,
  agentId: string,
  updates: Partial<Pick<AgentRecord, 'display_name' | 'operator_id' | 'server_id'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.operator_id !== undefined) {
    fields.push('operator_id = ?');
    values.push(updates.operator_id);
  }
  if (updates.server_id !== undefined) {
    fields.push('server_id = ?');
    values.push(updates.server_id);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(agentId);

  const result = db
    .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE agent_id = ?`)
    .run(...values);

  if (result.changes === 0) {
    throw new AgentBnBError('AGENT_NOT_FOUND', `Agent ${agentId} not found`);
  }
}

/**
 * Resolves an identifier that may be either an agent_id or a legacy owner string.
 * Returns the canonical agent_id. Used during the v7→v8 transition.
 *
 * Resolution order:
 * 1. Direct agent_id match (16-char hex)
 * 2. Legacy owner string match
 * 3. Returns input unchanged (for backward compat with unregistered agents)
 *
 * @param db - Database instance with agents table.
 * @param identifier - Either an agent_id or legacy owner string.
 * @returns Canonical agent_id, or the input if no match found.
 */
export function resolveIdentifier(
  db: Database.Database,
  identifier: string,
): string {
  ensureAgentsTable(db);

  // Fast path: looks like an agent_id (16-char hex)
  if (/^[a-f0-9]{16}$/.test(identifier)) {
    const agent = lookupAgent(db, identifier);
    if (agent) return agent.agent_id;
  }

  // Try legacy owner lookup
  const byOwner = lookupAgentByOwner(db, identifier);
  if (byOwner) return byOwner.agent_id;

  // Fallback: return as-is (unregistered agent, backward compat)
  return identifier;
}

/**
 * Canonical identity resolution result for owner/agent_id bridge flows.
 */
export interface CanonicalIdentity {
  /** Canonical agent identifier when resolved; otherwise returns input identifier. */
  agent_id: string;
  /** Legacy owner associated with the resolved agent, if any. */
  legacy_owner: string | null;
  /** Whether the identifier was resolved through the agents table. */
  resolved: boolean;
  /** How resolution succeeded (or failed). */
  source: 'agent_id' | 'legacy_owner' | 'unresolved';
}

/**
 * Resolves an identifier that may be either a canonical agent_id or a legacy owner.
 *
 * Unlike resolveIdentifier(), this returns richer metadata used by migration-safe
 * routing logic. When no row is found, the input is echoed as-is with `resolved=false`.
 *
 * @param db - Database instance with agents table.
 * @param identifier - Either agent_id or legacy owner string.
 * @returns Canonical identity resolution result.
 */
export function resolveCanonicalIdentity(
  db: Database.Database,
  identifier: string,
): CanonicalIdentity {
  ensureAgentsTable(db);

  if (/^[a-f0-9]{16}$/.test(identifier)) {
    const byAgentId = lookupAgent(db, identifier);
    if (byAgentId) {
      return {
        agent_id: byAgentId.agent_id,
        legacy_owner: byAgentId.legacy_owner,
        resolved: true,
        source: 'agent_id',
      };
    }
  }

  const byOwner = lookupAgentByOwner(db, identifier);
  if (byOwner) {
    return {
      agent_id: byOwner.agent_id,
      legacy_owner: byOwner.legacy_owner,
      resolved: true,
      source: 'legacy_owner',
    };
  }

  return {
    agent_id: identifier,
    legacy_owner: null,
    resolved: false,
    source: 'unresolved',
  };
}

/**
 * Checks whether two identifiers refer to the same canonical agent.
 *
 * Resolution strategy:
 * - If both identifiers resolve, compare canonical agent_id.
 * - Otherwise, fall back to exact string equality for backward compatibility.
 *
 * @param db - Database instance with agents table.
 * @param left - First identifier (owner or agent_id).
 * @param right - Second identifier (owner or agent_id).
 * @returns True when both identify the same agent.
 */
export function sameAgentIdentity(
  db: Database.Database,
  left: string,
  right: string,
): boolean {
  const leftResolved = resolveCanonicalIdentity(db, left);
  const rightResolved = resolveCanonicalIdentity(db, right);

  if (leftResolved.resolved && rightResolved.resolved) {
    return leftResolved.agent_id === rightResolved.agent_id;
  }

  return left === right;
}
