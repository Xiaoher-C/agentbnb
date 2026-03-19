import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, getBalance } from '../credit/ledger.js';
import { hubAgentRoutesPlugin } from './routes.js';
import type Database from 'better-sqlite3';

// Set up test master key
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

const TEST_SKILL_ROUTE = {
  skill_id: 'tts-elevenlabs',
  mode: 'direct_api',
  config: {
    id: 'tts-elevenlabs',
    type: 'api',
    name: 'ElevenLabs TTS',
    endpoint: 'https://api.elevenlabs.io/v1/text-to-speech',
    method: 'POST',
    pricing: { credits_per_call: 5 },
  },
};

describe('hub-agent/routes', () => {
  let server: FastifyInstance;
  let registryDb: Database.Database;
  let creditDb: Database.Database;

  beforeEach(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    server = Fastify({ logger: false });
    await server.register(hubAgentRoutesPlugin, { registryDb, creditDb });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('POST /api/agents', () => {
    it('creates a Hub Agent and returns 201', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'My TTS Agent',
          skill_routes: [TEST_SKILL_ROUTE],
          secrets: { ELEVENLABS_KEY: 'sk-test-123' },
        }),
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.agent_id).toBeTruthy();
      expect(data.name).toBe('My TTS Agent');
      expect(data.public_key).toBeTruthy();
      expect(data.skill_routes).toHaveLength(1);
      expect(data.status).toBe('active');
      // Secrets should not be in response
      expect(data.secrets).toBeUndefined();
      expect(data.ELEVENLABS_KEY).toBeUndefined();
    });

    it('bootstraps 50 credits for new agent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Credit Test Agent',
          skill_routes: [TEST_SKILL_ROUTE],
        }),
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      const balance = getBalance(creditDb, data.agent_id);
      expect(balance).toBe(50);
    });

    it('returns 400 with missing name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ skill_routes: [] }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/agents', () => {
    it('returns empty array when no agents exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/hub-agents',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.agents).toEqual([]);
    });

    it('returns all agents with secrets omitted', async () => {
      // Create two agents
      await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Agent A',
          skill_routes: [TEST_SKILL_ROUTE],
          secrets: { KEY: 'secret' },
        }),
      });
      await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Agent B',
          skill_routes: [],
        }),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/hub-agents',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.agents).toHaveLength(2);
      // No secrets in list
      for (const agent of data.agents) {
        expect(agent.secrets).toBeUndefined();
        expect(agent.secrets_enc).toBeUndefined();
        expect(agent.private_key_enc).toBeUndefined();
      }
    });
  });

  describe('GET /api/agents/:id', () => {
    it('returns agent detail with secret_keys (not values)', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Detail Agent',
          skill_routes: [TEST_SKILL_ROUTE],
          secrets: { API_KEY: 'secret-val', OTHER_KEY: 'val2' },
        }),
      });
      const agentId = createResp.json().agent_id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/hub-agents/${agentId}`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.agent_id).toBe(agentId);
      expect(data.name).toBe('Detail Agent');
      // Secret keys listed, not values
      expect(data.secret_keys).toEqual(expect.arrayContaining(['API_KEY', 'OTHER_KEY']));
      expect(data.secrets).toBeUndefined();
    });

    it('returns 404 for nonexistent agent', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/hub-agents/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Hub Agent not found');
    });
  });

  describe('PUT /api/agents/:id', () => {
    it('updates name and skill_routes', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Original',
          skill_routes: [TEST_SKILL_ROUTE],
        }),
      });
      const agentId = createResp.json().agent_id;

      const response = await server.inject({
        method: 'PUT',
        url: `/api/hub-agents/${agentId}`,
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'Updated Name',
          skill_routes: [{
            skill_id: 'image-gen',
            mode: 'relay',
            config: { relay_owner: 'other-agent' },
          }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.name).toBe('Updated Name');
      expect(data.skill_routes).toHaveLength(1);
      expect(data.skill_routes[0].skill_id).toBe('image-gen');
    });

    it('returns 404 for nonexistent agent', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/hub-agents/nonexistent-id',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ name: 'X' }),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('deletes agent and returns ok', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/hub-agents',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          name: 'To Delete',
          skill_routes: [TEST_SKILL_ROUTE],
        }),
      });
      const agentId = createResp.json().agent_id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/hub-agents/${agentId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);

      // Verify agent is gone
      const getResp = await server.inject({
        method: 'GET',
        url: `/api/hub-agents/${agentId}`,
      });
      expect(getResp.statusCode).toBe(404);
    });

    it('returns 404 for nonexistent agent', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/hub-agents/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
