import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
  initHubAgentTable,
  createHubAgent,
  getHubAgent,
  listHubAgents,
  updateHubAgent,
  deleteHubAgent,
} from './store.js';
import type { CreateAgentRequest, SkillRoute } from './types.js';

// Set up a test master key
const TEST_KEY_HEX = randomBytes(32).toString('hex');
const originalEnv = process.env.HUB_MASTER_KEY;

beforeAll(() => {
  process.env.HUB_MASTER_KEY = TEST_KEY_HEX;
});

afterAll(() => {
  if (originalEnv !== undefined) {
    process.env.HUB_MASTER_KEY = originalEnv;
  } else {
    delete process.env.HUB_MASTER_KEY;
  }
});

function makeTestRequest(overrides?: Partial<CreateAgentRequest>): CreateAgentRequest {
  return {
    name: 'Test Hub Agent',
    skill_routes: [
      {
        skill_id: 'tts-elevenlabs',
        mode: 'direct_api' as const,
        config: {
          id: 'tts-elevenlabs',
          type: 'api' as const,
          name: 'ElevenLabs TTS',
          endpoint: 'https://api.elevenlabs.io/v1/text-to-speech',
          method: 'POST' as const,
          pricing: { credits_per_call: 5 },
        },
      },
    ],
    ...overrides,
  };
}

describe('hub-agent/store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    initHubAgentTable(db);
  });

  describe('initHubAgentTable', () => {
    it('creates the hub_agents table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_agents'").all();
      expect(tables).toHaveLength(1);
    });

    it('is idempotent — calling twice does not error', () => {
      expect(() => initHubAgentTable(db)).not.toThrow();
    });
  });

  describe('createHubAgent', () => {
    it('creates an agent with Ed25519 keypair and returns HubAgent', () => {
      const req = makeTestRequest();
      const agent = createHubAgent(db, req, 'owner-pub-key-hex');

      expect(agent.agent_id).toBeTruthy();
      expect(agent.agent_id.length).toBe(16); // sha256 first 16 hex chars
      expect(agent.name).toBe('Test Hub Agent');
      expect(agent.owner_public_key).toBe('owner-pub-key-hex');
      expect(agent.public_key).toBeTruthy();
      expect(agent.skill_routes).toHaveLength(1);
      expect(agent.skill_routes[0].skill_id).toBe('tts-elevenlabs');
      expect(agent.status).toBe('active');
      expect(agent.created_at).toBeTruthy();
      expect(agent.updated_at).toBeTruthy();
    });

    it('stores encrypted private key (not plaintext)', () => {
      const req = makeTestRequest();
      const agent = createHubAgent(db, req, 'owner-pub-key');

      const row = db.prepare('SELECT private_key_enc FROM hub_agents WHERE agent_id = ?').get(agent.agent_id) as { private_key_enc: string };
      // Encrypted format: iv:authTag:ciphertext
      expect(row.private_key_enc.split(':')).toHaveLength(3);
    });

    it('stores encrypted secrets when provided', () => {
      const req = makeTestRequest({ secrets: { ELEVENLABS_KEY: 'sk-test-123' } });
      const agent = createHubAgent(db, req, 'owner-pub-key');

      const row = db.prepare('SELECT secrets_enc FROM hub_agents WHERE agent_id = ?').get(agent.agent_id) as { secrets_enc: string | null };
      expect(row.secrets_enc).toBeTruthy();
      expect(row.secrets_enc!.split(':')).toHaveLength(3);
      // Should NOT contain plaintext
      expect(row.secrets_enc).not.toContain('sk-test-123');
    });

    it('stores null secrets_enc when no secrets provided', () => {
      const req = makeTestRequest();
      const agent = createHubAgent(db, req, 'owner-pub-key');

      const row = db.prepare('SELECT secrets_enc FROM hub_agents WHERE agent_id = ?').get(agent.agent_id) as { secrets_enc: string | null };
      expect(row.secrets_enc).toBeNull();
    });
  });

  describe('getHubAgent', () => {
    it('returns null for nonexistent agent', () => {
      const result = getHubAgent(db, 'nonexistent-id');
      expect(result).toBeNull();
    });

    it('returns HubAgent with decrypted secrets for existing agent', () => {
      const req = makeTestRequest({ secrets: { MY_KEY: 'secret-value-42' } });
      const created = createHubAgent(db, req, 'owner-pub');

      const agent = getHubAgent(db, created.agent_id);
      expect(agent).not.toBeNull();
      expect(agent!.agent_id).toBe(created.agent_id);
      expect(agent!.name).toBe('Test Hub Agent');
      expect(agent!.secrets).toEqual({ MY_KEY: 'secret-value-42' });
    });

    it('returns HubAgent without secrets when none were stored', () => {
      const req = makeTestRequest();
      const created = createHubAgent(db, req, 'owner-pub');

      const agent = getHubAgent(db, created.agent_id);
      expect(agent).not.toBeNull();
      expect(agent!.secrets).toBeUndefined();
    });
  });

  describe('listHubAgents', () => {
    it('returns empty array when no agents exist', () => {
      const agents = listHubAgents(db);
      expect(agents).toEqual([]);
    });

    it('returns array of HubAgent objects with secrets omitted', () => {
      createHubAgent(db, makeTestRequest({ name: 'Agent A', secrets: { KEY: 'val' } }), 'pub-a');
      createHubAgent(db, makeTestRequest({ name: 'Agent B' }), 'pub-b');

      const agents = listHubAgents(db);
      expect(agents).toHaveLength(2);

      // No secrets in list view
      for (const agent of agents) {
        expect((agent as Record<string, unknown>).secrets).toBeUndefined();
        expect((agent as Record<string, unknown>).secrets_enc).toBeUndefined();
        expect((agent as Record<string, unknown>).private_key_enc).toBeUndefined();
      }
    });
  });

  describe('updateHubAgent', () => {
    it('updates name', async () => {
      const created = createHubAgent(db, makeTestRequest(), 'owner-pub');
      // Wait 2ms so updated_at differs
      await new Promise((r) => setTimeout(r, 2));
      const updated = updateHubAgent(db, created.agent_id, { name: 'New Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.updated_at).not.toBe(created.updated_at);
    });

    it('updates skill_routes', () => {
      const created = createHubAgent(db, makeTestRequest(), 'owner-pub');
      const newRoutes: SkillRoute[] = [
        {
          skill_id: 'image-gen',
          mode: 'relay',
          config: { relay_owner: 'other-agent' },
        },
      ];
      const updated = updateHubAgent(db, created.agent_id, { skill_routes: newRoutes });

      expect(updated).not.toBeNull();
      expect(updated!.skill_routes).toHaveLength(1);
      expect(updated!.skill_routes[0].skill_id).toBe('image-gen');
    });

    it('re-encrypts secrets when new secrets provided', () => {
      const created = createHubAgent(
        db,
        makeTestRequest({ secrets: { OLD: 'old-val' } }),
        'owner-pub',
      );
      const updated = updateHubAgent(db, created.agent_id, { secrets: { NEW: 'new-val' } });

      expect(updated).not.toBeNull();
      expect(updated!.secrets).toEqual({ NEW: 'new-val' });

      // Verify in DB it's encrypted
      const row = db.prepare('SELECT secrets_enc FROM hub_agents WHERE agent_id = ?').get(created.agent_id) as { secrets_enc: string };
      expect(row.secrets_enc).not.toContain('new-val');
    });

    it('returns null for nonexistent agent', () => {
      const result = updateHubAgent(db, 'nonexistent', { name: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('deleteHubAgent', () => {
    it('removes the agent row', () => {
      const created = createHubAgent(db, makeTestRequest(), 'owner-pub');
      const deleted = deleteHubAgent(db, created.agent_id);
      expect(deleted).toBe(true);

      const agent = getHubAgent(db, created.agent_id);
      expect(agent).toBeNull();
    });

    it('returns false for nonexistent agent', () => {
      const deleted = deleteHubAgent(db, 'nonexistent');
      expect(deleted).toBe(false);
    });
  });
});
