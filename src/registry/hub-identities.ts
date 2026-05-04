import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const HUB_IDENTITIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS hub_identities (
    email TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hub_identities_agent_id
    ON hub_identities(agent_id);
`;

const CHALLENGES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS hub_challenges (
    challenge TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  );
`;

/**
 * Creates hub_identities and hub_challenges tables.
 */
export function ensureHubIdentitiesTables(db: Database.Database): void {
  db.exec(HUB_IDENTITIES_SCHEMA);
  db.exec(CHALLENGES_SCHEMA);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Hub-registered agent identity with server-side encrypted backup. */
export interface HubIdentity {
  email: string;
  agent_id: string;
  public_key: string;
  encrypted_private_key: string;
  kdf_salt: string;
  display_name: string;
  created_at: string;
}

/** Input for registering a new Hub identity. */
export interface RegisterHubIdentityInput {
  email: string;
  public_key: string;
  encrypted_private_key: string;
  kdf_salt: string;
  display_name: string;
}

// ---------------------------------------------------------------------------
// Agent ID derivation
// ---------------------------------------------------------------------------

/**
 * Derives the canonical agent_id from an Ed25519 public key.
 * Format: first 16 hex chars of sha256(publicKey hex) — same as CLI identity.
 *
 * @param publicKeyHex - Hex-encoded Ed25519 public key.
 * @returns agent_id string.
 */
export function deriveAgentId(publicKeyHex: string): string {
  const hash = createHash('sha256').update(publicKeyHex, 'hex').digest('hex');
  return `agent-${hash.slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Challenge store (for signup replay protection)
// ---------------------------------------------------------------------------

/** How long a challenge is valid for (10 minutes). */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * Creates a random challenge and stores it in the DB with an expiration.
 *
 * @param db - Registry database.
 * @returns The challenge string and ISO expiration timestamp.
 */
export function createChallenge(db: Database.Database): { challenge: string; expires_at: string } {
  const challenge = randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  db.prepare('INSERT INTO hub_challenges (challenge, expires_at) VALUES (?, ?)').run(challenge, expires_at);
  return { challenge, expires_at };
}

/**
 * Validates a challenge and marks it as consumed (one-time use).
 *
 * @param db - Registry database.
 * @param challenge - The challenge string to validate.
 * @returns true if valid and not yet consumed, false otherwise.
 */
export function consumeChallenge(db: Database.Database, challenge: string): boolean {
  const row = db.prepare('SELECT expires_at, consumed_at FROM hub_challenges WHERE challenge = ?').get(challenge) as
    | { expires_at: string; consumed_at: string | null }
    | undefined;

  if (!row) return false;
  if (row.consumed_at) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;

  const consumed_at = new Date().toISOString();
  db.prepare('UPDATE hub_challenges SET consumed_at = ? WHERE challenge = ?').run(consumed_at, challenge);
  return true;
}

/**
 * Removes expired and consumed challenges to keep the table small.
 */
export function pruneChallenges(db: Database.Database): void {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM hub_challenges WHERE expires_at < ? OR consumed_at IS NOT NULL').run(cutoff);
}

// ---------------------------------------------------------------------------
// Identity CRUD
// ---------------------------------------------------------------------------

/**
 * Registers a new Hub identity. Returns the created identity.
 *
 * @throws Error if email or agent_id already exists.
 */
export function registerHubIdentity(db: Database.Database, input: RegisterHubIdentityInput): HubIdentity {
  const agent_id = deriveAgentId(input.public_key);
  const created_at = new Date().toISOString();

  db.prepare(`
    INSERT INTO hub_identities (email, agent_id, public_key, encrypted_private_key, kdf_salt, display_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.email, agent_id, input.public_key, input.encrypted_private_key, input.kdf_salt, input.display_name, created_at);

  return { ...input, agent_id, created_at };
}

/**
 * Fetches a Hub identity by email. Returns null if not found.
 */
export function getHubIdentityByEmail(db: Database.Database, email: string): HubIdentity | null {
  const row = db.prepare('SELECT * FROM hub_identities WHERE email = ?').get(email) as HubIdentity | undefined;
  return row ?? null;
}

/**
 * Fetches a Hub identity by agent_id. Returns null if not found.
 *
 * Accepts either the historical prefixed form `agent-<16hex>` (what this
 * module returns from `deriveAgentId`) or the canonical bare `<16hex>` form
 * (what `src/identity/identity.ts:deriveAgentId` and the rest of the platform
 * use). When given a bare form for a row that was stored with the prefix,
 * falls back to looking it up with the prefix re-attached.
 *
 * This unblocks the Hub-first DID auth loop where the request handler now
 * sets `request.agentId` to the canonical bare hex, but rows in
 * `hub_identities` predate the canonicalization. See
 * `docs/maintenance/2026-04-25-ui-backend-gap-audit.md` finding #1.
 */
export function getHubIdentityByAgentId(db: Database.Database, agent_id: string): HubIdentity | null {
  const trimmed = agent_id.trim();
  const stmt = db.prepare('SELECT * FROM hub_identities WHERE agent_id = ?');

  const direct = stmt.get(trimmed) as HubIdentity | undefined;
  if (direct) return direct;

  // If caller passed the bare 16-hex canonical form, also try the prefixed
  // form that this module historically wrote into the column.
  if (!trimmed.startsWith('agent-')) {
    const prefixed = stmt.get(`agent-${trimmed}`) as HubIdentity | undefined;
    if (prefixed) return prefixed;
  }

  return null;
}
