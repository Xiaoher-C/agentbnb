/**
 * Integration test: Gateway + SkillExecutor end-to-end flow.
 *
 * Verifies that:
 * 1. Gateway dispatches to SkillExecutor.execute() when skillExecutor is provided.
 * 2. Escrow settles on success; credits are deducted from requester.
 * 3. Escrow is released on failure (unknown skill_id).
 * 4. Backward compat: Gateway without skillExecutor falls back to handlerUrl fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { openDatabase, insertCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { createGatewayServer } from '../gateway/server.js';
import { createSkillExecutor } from './executor.js';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import { ApiExecutor } from './api-executor.js';
import { PipelineExecutor } from './pipeline-executor.js';
import { OpenClawBridge } from './openclaw-bridge.js';
import { CommandExecutor } from './command-executor.js';
import { parseSkillsFile } from './skill-config.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Builds a minimal valid CapabilityCard. */
function makeCard(id: string, owner: string, creditsPerCall: number) {
  return {
    spec_version: '1.0' as const,
    id,
    owner,
    name: 'Test Skill Card',
    description: 'A card for integration testing.',
    level: 1 as const,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: creditsPerCall },
    availability: { online: true },
  };
}

/** Creates a SkillExecutor with all 4 modes from a YAML string. */
function buildSkillExecutor(yaml: string) {
  const configs = parseSkillsFile(yaml);
  const modes = new Map<string, ExecutorMode>();
  const executor = createSkillExecutor(configs, modes);
  modes.set('api', new ApiExecutor());
  modes.set('pipeline', new PipelineExecutor(executor));
  modes.set('openclaw', new OpenClawBridge());
  modes.set('command', new CommandExecutor());
  return executor;
}

// ─── Suite 1: SkillExecutor dispatch path ─────────────────────────────────

describe('Gateway → SkillExecutor integration', () => {
  let registryDb: ReturnType<typeof openDatabase>;
  let creditDb: ReturnType<typeof openCreditDb>;
  let gateway: FastifyInstance;
  const CARD_ID = randomUUID();
  const OWNER = 'test-agent-b';
  const REQUESTER = 'test-agent-a';
  const TOKEN = 'integration-token-abc';
  const SKILL_ID = 'echo-skill';
  const CREDITS_PER_CALL = 5;

  const SKILLS_YAML = `
skills:
  - id: ${SKILL_ID}
    type: command
    name: Echo Skill
    command: echo "test result"
    output_type: text
    allowed_commands:
      - echo
    pricing:
      credits_per_call: ${CREDITS_PER_CALL}
`;

  beforeAll(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    // Bootstrap agents
    bootstrapAgent(creditDb, REQUESTER, 100);
    bootstrapAgent(creditDb, OWNER, 100);

    // Insert card into registry
    insertCard(registryDb, makeCard(CARD_ID, OWNER, CREDITS_PER_CALL));

    // Build SkillExecutor from inline YAML
    const skillExecutor = buildSkillExecutor(SKILLS_YAML);

    // Create gateway with skillExecutor
    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [TOKEN],
      handlerUrl: 'http://127.0.0.1:9999/unused', // not used when skillExecutor provided
      silent: true,
      skillExecutor,
    });

    await gateway.ready();
  });

  afterAll(async () => {
    await gateway.close();
    registryDb.close();
    creditDb.close();
  });

  it('returns JSON-RPC success with command output when skillExecutor dispatches', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'capability.execute',
        params: {
          card_id: CARD_ID,
          skill_id: SKILL_ID,
          requester: REQUESTER,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { jsonrpc: string; id: number; result: unknown };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    // echo outputs "test result" — CommandExecutor trims it
    expect(body.result).toBe('test result');
  });

  it('voucher used for hold — requester balance unchanged', () => {
    // Voucher used for hold (5 <= 50), balance unchanged
    const balance = getBalance(creditDb, REQUESTER);
    expect(balance).toBe(100);
  });

  it('credits the owner on success with first provider bonus', () => {
    // fee=floor(5*0.05)=0, providerAmount=5, bonus 2x: 5, total=10
    const balance = getBalance(creditDb, OWNER);
    expect(balance).toBe(100 + 10);
  });

  it('returns JSON-RPC error and releases escrow for unknown skill_id', async () => {
    const balanceBefore = getBalance(creditDb, REQUESTER);

    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'capability.execute',
        params: {
          card_id: CARD_ID,
          skill_id: 'does-not-exist',
          requester: REQUESTER,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { jsonrpc: string; id: number; error: { code: number; message: string } };
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toMatch(/Skill not found/);

    // Voucher used for hold (5 <= remaining voucher), release refunds to balance
    const balanceAfter = getBalance(creditDb, REQUESTER);
    expect(balanceAfter).toBe(balanceBefore + CREDITS_PER_CALL);
  });
});

// ─── Suite 2: Backward compat — no SkillExecutor, fetch(handlerUrl) used ──

describe('Gateway backward compat (no skillExecutor, uses handlerUrl)', () => {
  let registryDb: ReturnType<typeof openDatabase>;
  let creditDb: ReturnType<typeof openCreditDb>;
  let handlerServer: FastifyInstance;
  let gateway: FastifyInstance;
  const CARD_ID = randomUUID();
  const OWNER = 'compat-agent-b';
  const REQUESTER = 'compat-agent-a';
  const TOKEN = 'compat-token-xyz';
  const CREDITS_PER_CALL = 3;

  beforeAll(async () => {
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
    bootstrapAgent(creditDb, REQUESTER, 50);
    bootstrapAgent(creditDb, OWNER, 50);
    insertCard(registryDb, makeCard(CARD_ID, OWNER, CREDITS_PER_CALL));

    // Start a stub handler server
    handlerServer = Fastify({ logger: false });
    handlerServer.post('/handle', async () => ({ compat: 'ok' }));
    await handlerServer.listen({ port: 0, host: '127.0.0.1' });
    const addr = handlerServer.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    // Gateway with NO skillExecutor — must use handlerUrl
    gateway = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [TOKEN],
      handlerUrl: `http://127.0.0.1:${port}/handle`,
      silent: true,
      // skillExecutor intentionally omitted
    });
    await gateway.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await handlerServer.close();
    await gateway.close();
    registryDb.close();
    creditDb.close();
  });

  it('falls back to handlerUrl fetch when no skillExecutor is configured', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/rpc',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 99,
        method: 'capability.execute',
        params: {
          card_id: CARD_ID,
          requester: REQUESTER,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { jsonrpc: string; result: unknown };
    expect(body.result).toEqual({ compat: 'ok' });

    // Voucher used for hold (3 <= 50), balance unchanged
    const balance = getBalance(creditDb, REQUESTER);
    expect(balance).toBe(50);
  });
});
