import type Database from 'better-sqlite3';
import { generateKeyPair } from '../credit/signing.js';
import { deriveAgentId } from '../identity/identity.js';
import { encrypt, decrypt, getMasterKey } from './crypto.js';
import type { HubAgent, CreateAgentRequest, SkillRoute } from './types.js';

// ---------------------------------------------------------------------------
// Table init
// ---------------------------------------------------------------------------

/**
 * Creates the hub_agents table if it does not already exist.
 * Idempotent — safe to call multiple times.
 *
 * @param db - The SQLite database instance (registryDb).
 */
export function initHubAgentTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_public_key TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key_enc TEXT NOT NULL,
      secrets_enc TEXT,
      skill_routes TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Row shape from SQLite SELECT */
interface HubAgentRow {
  agent_id: string;
  name: string;
  owner_public_key: string;
  public_key: string;
  private_key_enc: string;
  secrets_enc: string | null;
  skill_routes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a new Hub Agent with a fresh Ed25519 keypair.
 * Encrypts the private key and any provided secrets with the master key.
 *
 * @param db - The registryDb instance.
 * @param req - CreateAgentRequest with name, skill_routes, and optional secrets.
 * @param ownerPublicKey - The hex-encoded public key of the agent creator.
 * @returns The newly created HubAgent.
 */
export function createHubAgent(
  db: Database.Database,
  req: CreateAgentRequest,
  ownerPublicKey: string,
): HubAgent {
  const masterKey = getMasterKey();
  const keys = generateKeyPair();
  const publicKeyHex = keys.publicKey.toString('hex');
  const agentId = deriveAgentId(publicKeyHex);
  const now = new Date().toISOString();

  // Encrypt private key
  const privateKeyEnc = encrypt(keys.privateKey.toString('hex'), masterKey);

  // Encrypt secrets if provided
  const secretsEnc = req.secrets
    ? encrypt(JSON.stringify(req.secrets), masterKey)
    : null;

  db.prepare(`
    INSERT INTO hub_agents (agent_id, name, owner_public_key, public_key, private_key_enc, secrets_enc, skill_routes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    agentId,
    req.name,
    ownerPublicKey,
    publicKeyHex,
    privateKeyEnc,
    secretsEnc,
    JSON.stringify(req.skill_routes),
    now,
    now,
  );

  return {
    agent_id: agentId,
    name: req.name,
    owner_public_key: ownerPublicKey,
    public_key: publicKeyHex,
    skill_routes: req.skill_routes,
    status: 'active',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Retrieves a single Hub Agent by ID with decrypted secrets.
 *
 * @param db - The registryDb instance.
 * @param agentId - The agent_id to look up.
 * @returns The HubAgent or null if not found.
 */
export function getHubAgent(
  db: Database.Database,
  agentId: string,
): (HubAgent & { secrets?: Record<string, string> }) | null {
  const row = db.prepare('SELECT * FROM hub_agents WHERE agent_id = ?').get(agentId) as HubAgentRow | undefined;
  if (!row) return null;

  const masterKey = getMasterKey();
  const secrets = row.secrets_enc ? JSON.parse(decrypt(row.secrets_enc, masterKey)) as Record<string, string> : undefined;

  return {
    agent_id: row.agent_id,
    name: row.name,
    owner_public_key: row.owner_public_key,
    public_key: row.public_key,
    skill_routes: JSON.parse(row.skill_routes) as SkillRoute[],
    status: row.status as 'active' | 'paused',
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(secrets ? { secrets } : {}),
  };
}

/**
 * Lists all Hub Agents. Secrets are NOT decrypted or included (list view).
 *
 * @param db - The registryDb instance.
 * @returns Array of HubAgent objects (no secrets).
 */
export function listHubAgents(db: Database.Database): HubAgent[] {
  const rows = db.prepare('SELECT agent_id, name, owner_public_key, public_key, skill_routes, status, created_at, updated_at FROM hub_agents ORDER BY created_at DESC').all() as HubAgentRow[];

  return rows.map((row) => ({
    agent_id: row.agent_id,
    name: row.name,
    owner_public_key: row.owner_public_key,
    public_key: row.public_key,
    skill_routes: JSON.parse(row.skill_routes) as SkillRoute[],
    status: row.status as 'active' | 'paused',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Updates a Hub Agent's name, skill_routes, and/or secrets.
 * Re-encrypts secrets if a new value is provided.
 *
 * @param db - The registryDb instance.
 * @param agentId - The agent_id to update.
 * @param updates - Partial update object (name, skill_routes, secrets).
 * @returns The updated HubAgent, or null if not found.
 */
export function updateHubAgent(
  db: Database.Database,
  agentId: string,
  updates: { name?: string; skill_routes?: SkillRoute[]; secrets?: Record<string, string> },
): (HubAgent & { secrets?: Record<string, string> }) | null {
  const existing = db.prepare('SELECT * FROM hub_agents WHERE agent_id = ?').get(agentId) as HubAgentRow | undefined;
  if (!existing) return null;

  const masterKey = getMasterKey();
  const now = new Date().toISOString();

  const newName = updates.name ?? existing.name;
  const newSkillRoutes = updates.skill_routes
    ? JSON.stringify(updates.skill_routes)
    : existing.skill_routes;
  const newSecretsEnc = updates.secrets !== undefined
    ? encrypt(JSON.stringify(updates.secrets), masterKey)
    : existing.secrets_enc;

  db.prepare(`
    UPDATE hub_agents SET name = ?, skill_routes = ?, secrets_enc = ?, updated_at = ?
    WHERE agent_id = ?
  `).run(newName, newSkillRoutes, newSecretsEnc, now, agentId);

  const secrets = newSecretsEnc
    ? JSON.parse(decrypt(newSecretsEnc, masterKey)) as Record<string, string>
    : undefined;

  return {
    agent_id: existing.agent_id,
    name: newName,
    owner_public_key: existing.owner_public_key,
    public_key: existing.public_key,
    skill_routes: JSON.parse(newSkillRoutes) as SkillRoute[],
    status: existing.status as 'active' | 'paused',
    created_at: existing.created_at,
    updated_at: now,
    ...(secrets ? { secrets } : {}),
  };
}

/**
 * Deletes a Hub Agent by ID.
 *
 * @param db - The registryDb instance.
 * @param agentId - The agent_id to delete.
 * @returns true if a row was deleted, false if agent was not found.
 */
export function deleteHubAgent(db: Database.Database, agentId: string): boolean {
  const result = db.prepare('DELETE FROM hub_agents WHERE agent_id = ?').run(agentId);
  return result.changes > 0;
}
