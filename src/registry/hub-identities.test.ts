import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureHubIdentitiesTables,
  deriveAgentId,
  createChallenge,
  consumeChallenge,
  pruneChallenges,
  registerHubIdentity,
  getHubIdentityByEmail,
  getHubIdentityByAgentId,
} from './hub-identities.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  ensureHubIdentitiesTables(db);
  return db;
}

function makeInput(overrides: Record<string, string> = {}) {
  return {
    email: 'alice@example.com',
    public_key: 'a1b2c3d4e5f6'.repeat(8), // 96 hex chars (48 bytes mock)
    encrypted_private_key: 'encrypted-blob-base64',
    kdf_salt: 'salt-base64',
    display_name: 'Alice',
    ...overrides,
  };
}

describe('ensureHubIdentitiesTables', () => {
  it('creates tables without error', () => {
    const db = new Database(':memory:');
    expect(() => ensureHubIdentitiesTables(db)).not.toThrow();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    ensureHubIdentitiesTables(db);
    expect(() => ensureHubIdentitiesTables(db)).not.toThrow();
  });
});

describe('deriveAgentId', () => {
  it('produces deterministic agent_id from public key', () => {
    const pub = 'a1b2c3d4e5f6' + '00'.repeat(26); // 64 hex chars
    const id1 = deriveAgentId(pub);
    const id2 = deriveAgentId(pub);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^agent-[a-f0-9]{16}$/);
  });

  it('different keys produce different agent_ids', () => {
    const a = deriveAgentId('aa' + '00'.repeat(31));
    const b = deriveAgentId('bb' + '00'.repeat(31));
    expect(a).not.toBe(b);
  });
});

describe('challenge store', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('creates a challenge with expiration', () => {
    const { challenge, expires_at } = createChallenge(db);
    expect(challenge).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('consumes a valid challenge successfully', () => {
    const { challenge } = createChallenge(db);
    expect(consumeChallenge(db, challenge)).toBe(true);
  });

  it('cannot consume the same challenge twice', () => {
    const { challenge } = createChallenge(db);
    consumeChallenge(db, challenge);
    expect(consumeChallenge(db, challenge)).toBe(false);
  });

  it('rejects non-existent challenges', () => {
    expect(consumeChallenge(db, 'invalid-challenge')).toBe(false);
  });

  it('rejects expired challenges', () => {
    const { challenge } = createChallenge(db);
    // Manually expire
    db.prepare('UPDATE hub_challenges SET expires_at = ? WHERE challenge = ?')
      .run(new Date(Date.now() - 1000).toISOString(), challenge);
    expect(consumeChallenge(db, challenge)).toBe(false);
  });

  it('prunes old challenges without error', () => {
    createChallenge(db);
    expect(() => pruneChallenges(db)).not.toThrow();
  });
});

describe('identity CRUD', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('registers and retrieves an identity', () => {
    const registered = registerHubIdentity(db, makeInput());
    expect(registered.email).toBe('alice@example.com');
    expect(registered.agent_id).toMatch(/^agent-[a-f0-9]{16}$/);
    expect(registered.created_at).toBeTruthy();

    const byEmail = getHubIdentityByEmail(db, 'alice@example.com');
    expect(byEmail?.agent_id).toBe(registered.agent_id);
  });

  it('fetches by agent_id', () => {
    const registered = registerHubIdentity(db, makeInput());
    const byId = getHubIdentityByAgentId(db, registered.agent_id);
    expect(byId?.email).toBe('alice@example.com');
  });

  // Audit ref: docs/maintenance/2026-04-25-ui-backend-gap-audit.md finding #1
  // — DID auth in owner-routes resolves identity through the canonical bare
  // 16-hex form set by `tryVerifyIdentity`, but rows in this table were
  // historically written with the `agent-` prefix. Both forms must look up
  // the same row.
  it('fetches by canonical bare 16-hex agent_id even when row was stored prefixed', () => {
    const registered = registerHubIdentity(db, makeInput());
    expect(registered.agent_id).toMatch(/^agent-[a-f0-9]{16}$/);

    const bare = registered.agent_id.replace(/^agent-/, '');
    const byCanonical = getHubIdentityByAgentId(db, bare);

    expect(byCanonical?.email).toBe('alice@example.com');
    expect(byCanonical?.agent_id).toBe(registered.agent_id);
  });

  it('returns null when bare-hex form does not match any stored row', () => {
    registerHubIdentity(db, makeInput());
    expect(getHubIdentityByAgentId(db, 'deadbeefdeadbeef')).toBeNull();
  });

  it('returns null for missing email', () => {
    expect(getHubIdentityByEmail(db, 'nope@example.com')).toBeNull();
  });

  it('returns null for missing agent_id', () => {
    expect(getHubIdentityByAgentId(db, 'agent-nope')).toBeNull();
  });

  it('prevents duplicate email registration', () => {
    registerHubIdentity(db, makeInput());
    expect(() => registerHubIdentity(db, makeInput())).toThrow();
  });
});
