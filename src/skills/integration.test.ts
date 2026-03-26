import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { createGatewayServer } from '../gateway/server.js';
import { requestCapability } from '../gateway/client.js';
import { searchCards } from '../registry/matcher.js';
import { parseSoulMd, publishFromSoul } from './publish-capability.js';
import { createRequestHandler } from './handle-request.js';

// ============================================================
// SOUL.md parser tests
// ============================================================
describe('parseSoulMd', () => {
  it('extracts agent name from first H1', () => {
    const soul = `# Text Summarizer Agent\n\nA helpful summarizer.\n\n## Summarize Text\nSummarizes long text.`;
    const result = parseSoulMd(soul);
    expect(result.name).toBe('Text Summarizer Agent');
  });

  it('extracts description from first paragraph', () => {
    const soul = `# My Agent\n\nThis agent does amazing things for you.\n\n## My Capability\nDoes the thing.`;
    const result = parseSoulMd(soul);
    expect(result.description).toBe('This agent does amazing things for you.');
  });

  it('extracts capabilities from H2 sections', () => {
    const soul = `# My Agent\n\nA description.\n\n## Cap One\nFirst capability.\n\n## Cap Two\nSecond capability.`;
    const result = parseSoulMd(soul);
    expect(result.capabilities).toHaveLength(2);
    expect(result.capabilities[0].name).toBe('Cap One');
    expect(result.capabilities[1].name).toBe('Cap Two');
  });

  it('defaults to level 2 (Pipeline)', () => {
    const soul = `# Agent\n\nDesc.\n\n## Capability\nDoes something.`;
    const result = parseSoulMd(soul);
    expect(result.level).toBe(2);
  });

  it('handles minimal SOUL.md with just name and one capability', () => {
    const soul = `# Minimal Agent\n\n## Do Stuff\nStuff description.`;
    const result = parseSoulMd(soul);
    expect(result.name).toBe('Minimal Agent');
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].name).toBe('Do Stuff');
  });

  it('handles SOUL.md with no description paragraph gracefully', () => {
    const soul = `# Agent Name\n\n## Some Capability\nCapability details.`;
    const result = parseSoulMd(soul);
    expect(result.name).toBe('Agent Name');
    // description should be empty string — not crash
    expect(typeof result.description).toBe('string');
  });
});

// ============================================================
// publishFromSoul tests
// ============================================================
describe('publishFromSoul', () => {
  it('generates a valid CapabilityCard and inserts into registry', () => {
    const db = openDatabase(':memory:');
    const soul = `# Text Summarizer\n\nTakes text and returns a summary.\n\n## Summarize\nSummarize long text into key points.`;
    const card = publishFromSoul(db, soul, 'agent-b');
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(card.owner).toBe('agent-b');
    expect(card.level).toBe(2);
    expect(card.pricing.credits_per_call).toBe(10);
    expect(card.availability.online).toBe(true);
    db.close();
  });
});

// ============================================================
// createRequestHandler tests
// ============================================================
describe('createRequestHandler', () => {
  it('returns a handler function that processes incoming params and returns result', async () => {
    const CARD_ID = 'test-card-id';
    const handlerFn = createRequestHandler({
      [CARD_ID]: async (params) => {
        // Echo the text back as-is to verify params flow through
        const input = (params as Record<string, unknown>).text as string;
        return { echo: input };
      },
    });

    // handlerFn is a Fastify route handler — test via a Fastify app
    const app = Fastify({ logger: false });
    app.post('/handle', handlerFn);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      body: { card_id: CARD_ID, params: { text: 'Hello World!', requester: 'agent-a' } },
    });

    expect(res.statusCode).toBe(200);
    // Handler returns result directly (no wrapping) — gateway JSON-RPC layer wraps in { result }
    const body = JSON.parse(res.body) as { echo: string };
    expect(body.echo).toBe('Hello World!');

    await app.close();
  });

  it('returns 404 when card_id has no registered handler', async () => {
    const handlerFn = createRequestHandler({});

    const app = Fastify({ logger: false });
    app.post('/handle', handlerFn);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      body: { card_id: 'unknown-id', params: {} },
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });
});

// ============================================================
// End-to-end integration test
// ============================================================
describe('End-to-end: Agent A requests Agent B capability', () => {
  let registryDb: ReturnType<typeof openDatabase>;
  let creditDb: ReturnType<typeof openCreditDb>;
  let handlerServer: FastifyInstance;
  let gatewayServer: FastifyInstance;
  let handlerPort: number;
  let gatewayPort: number;
  let cardId: string;

  const AGENT_A = 'openclaw-agent-a';
  const AGENT_B = 'openclaw-agent-b';
  const TOKEN = 'test-token-123';

  beforeAll(async () => {
    // Set up shared in-memory databases
    registryDb = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');

    // Bootstrap both agents with 100 credits each
    bootstrapAgent(creditDb, AGENT_A, 100);
    bootstrapAgent(creditDb, AGENT_B, 100);

    // Agent B publishes a "Text Summarizer" capability via SOUL.md
    const soulContent = `# OpenClaw Text Summarizer

Summarizes text for agents in the OpenClaw pipeline.

## Summarize Text
Takes a long text input and returns a concise summary by extracting the first sentence.`;

    const card = publishFromSoul(registryDb, soulContent, AGENT_B);
    cardId = card.id;

    // Agent B sets up a local handler that actually processes requests
    const HANDLER_CARD_ID = cardId;
    const handlerFn = createRequestHandler({
      [HANDLER_CARD_ID]: async (params) => {
        const text = (params as Record<string, unknown>).text as string;
        // Simple "summarizer": take first sentence (split on .!?)
        const firstSentence = text.split(/[.!?]/)[0]?.trim() ?? text;
        return { summary: firstSentence };
      },
    });

    // Start handler server on a random port
    handlerServer = Fastify({ logger: false });
    handlerServer.post('/handle', handlerFn);
    await handlerServer.listen({ port: 0, host: '127.0.0.1' });
    const handlerAddr = handlerServer.server.address();
    handlerPort = typeof handlerAddr === 'object' && handlerAddr !== null ? handlerAddr.port : 0;

    // Agent B starts a gateway server pointing to the handler
    gatewayServer = createGatewayServer({
      registryDb,
      creditDb,
      tokens: [TOKEN],
      handlerUrl: `http://127.0.0.1:${handlerPort}/handle`,
      silent: true,
    });
    await gatewayServer.listen({ port: 0, host: '127.0.0.1' });
    const gatewayAddr = gatewayServer.server.address();
    gatewayPort = typeof gatewayAddr === 'object' && gatewayAddr !== null ? gatewayAddr.port : 0;
  });

  afterAll(async () => {
    await handlerServer.close();
    await gatewayServer.close();
    registryDb.close();
    creditDb.close();
  });

  it("Agent A can discover Agent B's capability via search", () => {
    const results = searchCards(registryDb, 'summarize');
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((c) => c.id === cardId);
    expect(found).toBeDefined();
  });

  it("Agent A receives summarized text result from Agent B's gateway", async () => {
    const result = await requestCapability({
      gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
      token: TOKEN,
      cardId,
      params: {
        requester: AGENT_A,
        text: 'The quick brown fox jumped over the lazy dog. Then it ran away.',
      },
    });

    // The handler returns { summary: firstSentence } directly,
    // and the gateway wraps it as JSON-RPC result, so requestCapability
    // returns { summary: firstSentence }
    const typed = result as { summary: string };
    expect(typed.summary).toBe('The quick brown fox jumped over the lazy dog');
  });

  it("Agent A's balance unchanged (voucher used for hold)", () => {
    // Voucher used for hold (10 <= 50), balance unchanged
    const balance = getBalance(creditDb, AGENT_A);
    expect(balance).toBe(100);
  });

  it("Agent B's balance increased by card pricing + first provider bonus", () => {
    // fee=floor(10*0.05)=0, providerAmount=10, bonus 2x: 10, total=20
    const balance = getBalance(creditDb, AGENT_B);
    expect(balance).toBe(120); // 100 + 10 + 10 (2x first provider bonus)
  });
});
