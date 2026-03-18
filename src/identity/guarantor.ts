import { z } from 'zod';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Maximum agents a single human guarantor can back. */
export const MAX_AGENTS_PER_GUARANTOR = 10;

/** Free credits granted per human guarantor registration. */
export const GUARANTOR_CREDIT_POOL = 50;

/**
 * A Human Guarantor — a real person backing one or more agents.
 * Provides initial trust and credit pool for the agent network.
 */
export const GuarantorRecordSchema = z.object({
  id: z.string().uuid(),
  github_login: z.string().min(1),
  agent_count: z.number().int().nonnegative(),
  credit_pool: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
});

export type GuarantorRecord = z.infer<typeof GuarantorRecordSchema>;

// ---------------------------------------------------------------------------
// Database migration
// ---------------------------------------------------------------------------

const GUARANTOR_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guarantors (
    id TEXT PRIMARY KEY,
    github_login TEXT UNIQUE NOT NULL,
    agent_count INTEGER NOT NULL DEFAULT 0,
    credit_pool INTEGER NOT NULL DEFAULT ${GUARANTOR_CREDIT_POOL},
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_guarantors (
    agent_id TEXT PRIMARY KEY,
    guarantor_id TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (guarantor_id) REFERENCES guarantors(id)
  );
`;

/**
 * Ensures guarantor tables exist in the credit database.
 * Safe to call multiple times (CREATE IF NOT EXISTS).
 *
 * @param db - The credit database instance.
 */
export function ensureGuarantorTables(db: Database.Database): void {
  db.exec(GUARANTOR_SCHEMA);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Registers a new human guarantor via GitHub login.
 * Grants GUARANTOR_CREDIT_POOL (50) credits to be distributed among linked agents.
 *
 * @param db - The credit database instance.
 * @param githubLogin - GitHub username of the guarantor.
 * @returns The created GuarantorRecord.
 * @throws {AgentBnBError} with code 'GUARANTOR_EXISTS' if login already registered.
 */
export function registerGuarantor(db: Database.Database, githubLogin: string): GuarantorRecord {
  ensureGuarantorTables(db);

  const existing = db.prepare('SELECT * FROM guarantors WHERE github_login = ?').get(githubLogin) as
    | Record<string, unknown>
    | undefined;

  if (existing) {
    throw new AgentBnBError(
      `Guarantor already registered: ${githubLogin}`,
      'GUARANTOR_EXISTS',
    );
  }

  const record: GuarantorRecord = {
    id: randomUUID(),
    github_login: githubLogin,
    agent_count: 0,
    credit_pool: GUARANTOR_CREDIT_POOL,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO guarantors (id, github_login, agent_count, credit_pool, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(record.id, record.github_login, record.agent_count, record.credit_pool, record.created_at);

  return record;
}

/**
 * Links an agent to a human guarantor.
 * Enforces the MAX_AGENTS_PER_GUARANTOR limit (10).
 *
 * @param db - The credit database instance.
 * @param agentId - The agent_id to link.
 * @param githubLogin - The guarantor's GitHub login.
 * @returns Updated GuarantorRecord.
 * @throws {AgentBnBError} with code 'GUARANTOR_NOT_FOUND' if login not registered.
 * @throws {AgentBnBError} with code 'MAX_AGENTS_EXCEEDED' if limit reached.
 * @throws {AgentBnBError} with code 'AGENT_ALREADY_LINKED' if agent already has a guarantor.
 */
export function linkAgentToGuarantor(
  db: Database.Database,
  agentId: string,
  githubLogin: string,
): GuarantorRecord {
  ensureGuarantorTables(db);

  const guarantor = db
    .prepare('SELECT * FROM guarantors WHERE github_login = ?')
    .get(githubLogin) as Record<string, unknown> | undefined;

  if (!guarantor) {
    throw new AgentBnBError(
      `Guarantor not found: ${githubLogin}`,
      'GUARANTOR_NOT_FOUND',
    );
  }

  if ((guarantor['agent_count'] as number) >= MAX_AGENTS_PER_GUARANTOR) {
    throw new AgentBnBError(
      `Maximum agents per guarantor reached (${MAX_AGENTS_PER_GUARANTOR})`,
      'MAX_AGENTS_EXCEEDED',
    );
  }

  // Check if agent is already linked
  const existingLink = db
    .prepare('SELECT * FROM agent_guarantors WHERE agent_id = ?')
    .get(agentId) as Record<string, unknown> | undefined;

  if (existingLink) {
    throw new AgentBnBError(
      `Agent ${agentId} is already linked to a guarantor`,
      'AGENT_ALREADY_LINKED',
    );
  }

  db.transaction(() => {
    db.prepare('INSERT INTO agent_guarantors (agent_id, guarantor_id, linked_at) VALUES (?, ?, ?)').run(
      agentId,
      guarantor['id'],
      new Date().toISOString(),
    );

    db.prepare('UPDATE guarantors SET agent_count = agent_count + 1 WHERE id = ?').run(guarantor['id']);
  })();

  return getGuarantor(db, githubLogin)!;
}

/**
 * Retrieves a guarantor record by GitHub login.
 *
 * @param db - The credit database instance.
 * @param githubLogin - The GitHub username to look up.
 * @returns GuarantorRecord or null if not found.
 */
export function getGuarantor(db: Database.Database, githubLogin: string): GuarantorRecord | null {
  ensureGuarantorTables(db);

  const row = db.prepare('SELECT * FROM guarantors WHERE github_login = ?').get(githubLogin) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;

  return {
    id: row['id'] as string,
    github_login: row['github_login'] as string,
    agent_count: row['agent_count'] as number,
    credit_pool: row['credit_pool'] as number,
    created_at: row['created_at'] as string,
  };
}

/**
 * Gets the guarantor linked to an agent, if any.
 *
 * @param db - The credit database instance.
 * @param agentId - The agent_id to look up.
 * @returns GuarantorRecord or null if agent has no guarantor.
 */
export function getAgentGuarantor(db: Database.Database, agentId: string): GuarantorRecord | null {
  ensureGuarantorTables(db);

  const link = db
    .prepare(
      `SELECT g.* FROM guarantors g
       JOIN agent_guarantors ag ON ag.guarantor_id = g.id
       WHERE ag.agent_id = ?`,
    )
    .get(agentId) as Record<string, unknown> | undefined;

  if (!link) return null;

  return {
    id: link['id'] as string,
    github_login: link['github_login'] as string,
    agent_count: link['agent_count'] as number,
    credit_pool: link['credit_pool'] as number,
    created_at: link['created_at'] as string,
  };
}

// ---------------------------------------------------------------------------
// GitHub OAuth stub
// ---------------------------------------------------------------------------

/**
 * Initiates a GitHub OAuth flow for guarantor verification.
 * This is a STUB — returns placeholder values. Actual OAuth implementation
 * is deferred to a future version.
 *
 * @returns Object with auth_url and state for the OAuth flow.
 */
export function initiateGithubAuth(): { auth_url: string; state: string } {
  return {
    auth_url: 'https://github.com/login/oauth/authorize?client_id=PLACEHOLDER&scope=read:user',
    state: randomUUID(),
  };
}
