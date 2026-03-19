import { describe, it, expect, beforeEach, beforeAll, afterAll, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { initHubAgentTable, createHubAgent } from './store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { HubAgentExecutor } from './executor.js';
import type { CreateAgentRequest } from './types.js';

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

/** Helper to build a direct_api skill route */
function makeApiSkillRoute(overrides?: Record<string, unknown>) {
  return {
    skill_id: 'tts-elevenlabs',
    mode: 'direct_api' as const,
    config: {
      id: 'tts-elevenlabs',
      type: 'api' as const,
      name: 'ElevenLabs TTS',
      endpoint: 'https://api.elevenlabs.io/v1/text-to-speech',
      method: 'POST' as const,
      auth: { type: 'bearer' as const, token: 'placeholder' },
      input_mapping: { text: 'body.text' },
      output_mapping: { audio: 'response.audio_url' },
      pricing: { credits_per_call: 5 },
      ...overrides,
    },
  };
}

describe('HubAgentExecutor', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let executor: HubAgentExecutor;

  beforeEach(() => {
    registryDb = new Database(':memory:');
    registryDb.pragma('journal_mode = WAL');
    initHubAgentTable(registryDb);
    // Create capability_cards table (needed by executor for online check + price lookup)
    registryDb.exec(`
      CREATE TABLE IF NOT EXISTS capability_cards (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    creditDb = openCreditDb(':memory:');

    executor = new HubAgentExecutor(registryDb, creditDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('direct_api mode', () => {
    it('calls ApiExecutor and returns ExecutionResult on success', async () => {
      // Mock fetch for external API call
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ audio_url: 'https://cdn.example.com/audio.mp3' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'TTS Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      const result = await executor.execute(agent.agent_id, 'tts-elevenlabs', { text: 'hello' });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ audio: 'https://cdn.example.com/audio.mp3' });
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('injects decrypted API key secrets into auth config', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'ok' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'Secret Agent',
        skill_routes: [makeApiSkillRoute()],
        secrets: { api_key: 'real-secret-key-123' },
      }, 'hub-server');

      await executor.execute(agent.agent_id, 'tts-elevenlabs', { text: 'test' });

      // The fetch call should have the decrypted secret as bearer token
      expect(mockFetch).toHaveBeenCalledOnce();
      const [, fetchOptions] = mockFetch.mock.calls[0];
      expect(fetchOptions.headers.Authorization).toBe('Bearer real-secret-key-123');
    });
  });

  describe('relay mode', () => {
    it('queues job when relay target is offline', async () => {
      const agent = createHubAgent(registryDb, {
        name: 'Relay Agent',
        skill_routes: [{
          skill_id: 'relay-skill',
          mode: 'relay' as const,
          config: { relay_owner: 'other-agent' },
        }],
      }, 'hub-server');

      // No card for other-agent -> offline -> queues
      const result = await executor.execute(agent.agent_id, 'relay-skill', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('queued', true);
      expect(result.result).toHaveProperty('job_id');
    });
  });

  describe('queue mode', () => {
    it('always queues and returns job_id', async () => {
      const agent = createHubAgent(registryDb, {
        name: 'Queue Agent',
        skill_routes: [{
          skill_id: 'queue-skill',
          mode: 'queue' as const,
          config: { relay_owner: 'target-owner' },
        }],
      }, 'hub-server');

      const result = await executor.execute(agent.agent_id, 'queue-skill', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('queued', true);
      expect(result.result).toHaveProperty('job_id');
    });
  });

  describe('error cases', () => {
    it('returns error for nonexistent agent', async () => {
      const result = await executor.execute('nonexistent-id', 'some-skill', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Hub Agent not found');
    });

    it('returns error for nonexistent skill_id', async () => {
      const agent = createHubAgent(registryDb, {
        name: 'Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      const result = await executor.execute(agent.agent_id, 'nonexistent-skill', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Skill not found in routing table');
    });

    it('returns error for paused agent', async () => {
      const agent = createHubAgent(registryDb, {
        name: 'Paused Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      // Pause the agent directly in DB
      registryDb.prepare('UPDATE hub_agents SET status = ? WHERE agent_id = ?')
        .run('paused', agent.agent_id);

      const result = await executor.execute(agent.agent_id, 'tts-elevenlabs', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Hub Agent is paused');
    });
  });

  describe('credit escrow', () => {
    it('holds credits before execution and settles on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ audio_url: 'https://cdn.example.com/audio.mp3' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'Paid Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      // Bootstrap requester with credits
      bootstrapAgent(creditDb, 'requester-owner', 100);
      const balanceBefore = getBalance(creditDb, 'requester-owner');
      expect(balanceBefore).toBe(100);

      const result = await executor.execute(
        agent.agent_id,
        'tts-elevenlabs',
        { text: 'hello' },
        'requester-owner',
      );

      expect(result.success).toBe(true);

      // Requester should have been charged 5 credits
      const balanceAfter = getBalance(creditDb, 'requester-owner');
      expect(balanceAfter).toBe(95);

      // Agent owner should have received 5 credits (no bootstrap in executor test)
      const agentBalance = getBalance(creditDb, agent.agent_id);
      expect(agentBalance).toBe(5); // 5 settlement only
    });

    it('releases escrow on execution failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'Failing Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      bootstrapAgent(creditDb, 'requester-owner', 100);

      const result = await executor.execute(
        agent.agent_id,
        'tts-elevenlabs',
        { text: 'hello' },
        'requester-owner',
      );

      expect(result.success).toBe(false);

      // Credits should be refunded
      const balanceAfter = getBalance(creditDb, 'requester-owner');
      expect(balanceAfter).toBe(100);
    });

    it('skips escrow when no requesterOwner provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ audio_url: 'test' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'Free Agent',
        skill_routes: [makeApiSkillRoute()],
      }, 'hub-server');

      // No requesterOwner = no escrow
      const result = await executor.execute(agent.agent_id, 'tts-elevenlabs', { text: 'hi' });

      expect(result.success).toBe(true);
      // No credit changes - just verify no throw
    });
  });

  describe('latency tracking', () => {
    it('records latency_ms in the result', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'ok' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const agent = createHubAgent(registryDb, {
        name: 'Latency Agent',
        skill_routes: [makeApiSkillRoute({ output_mapping: {} })],
      }, 'hub-server');

      const result = await executor.execute(agent.agent_id, 'tts-elevenlabs', { text: 'hi' });

      expect(result.latency_ms).toBeTypeOf('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
