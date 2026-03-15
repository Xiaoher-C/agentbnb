import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createRequestHandler } from './handle-request.js';
import type { HandlerMap } from './handle-request.js';

// ─── Handler dispatch tests ───────────────────────────────────────────────────

describe('createRequestHandler — skill_id dispatch', () => {
  /**
   * Test 6: Handler dispatch tries handlers[skill_id] first, falls back to handlers[card_id].
   * When skill_id is present and a handler is registered for it, that handler is used.
   */
  it('Test 6: dispatch uses skill_id key when handler is registered for it', async () => {
    const handlers: HandlerMap = {
      'skill-tts': async (_params) => ({ output: 'from tts skill handler' }),
    };

    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: {
        card_id: 'card-uuid-123',
        skill_id: 'skill-tts',
        params: { text: 'hello' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ output: string }>();
    expect(body.output).toBe('from tts skill handler');
  });

  /**
   * Test 7: Handler dispatch with skill_id returns correct handler result.
   * When two skills have different handlers, the correct one is invoked.
   */
  it('Test 7: dispatch returns result from the correct skill handler', async () => {
    const handlers: HandlerMap = {
      'skill-tts': async (_params) => ({ output: 'TTS result' }),
      'skill-stt': async (_params) => ({ output: 'STT result' }),
    };

    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    // Request skill-stt specifically
    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: {
        card_id: 'card-uuid-123',
        skill_id: 'skill-stt',
        params: {},
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ output: string }>();
    expect(body.output).toBe('STT result');
  });

  /**
   * Backward compat: when skill_id is absent, falls back to card_id key.
   */
  it('falls back to card_id key when skill_id is not provided', async () => {
    const cardId = 'card-legacy-uuid';
    const handlers: HandlerMap = {
      [cardId]: async (_params) => ({ output: 'legacy handler result' }),
    };

    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: {
        card_id: cardId,
        // No skill_id — v1.0 style request
        params: {},
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ output: string }>();
    expect(body.output).toBe('legacy handler result');
  });

  /**
   * When skill_id is provided but no handler for it, falls back to card_id handler.
   */
  it('falls back to card_id handler when skill_id handler is not found', async () => {
    const cardId = 'card-uuid-fallback';
    const handlers: HandlerMap = {
      [cardId]: async (_params) => ({ output: 'card_id fallback result' }),
    };

    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: {
        card_id: cardId,
        skill_id: 'skill-not-registered',
        params: {},
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ output: string }>();
    expect(body.output).toBe('card_id fallback result');
  });

  /**
   * When neither skill_id nor card_id has a registered handler, returns 404.
   */
  it('returns 404 when no handler found for skill_id or card_id', async () => {
    const handlers: HandlerMap = {
      'other-skill': async (_params) => ({ output: 'other' }),
    };

    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: {
        card_id: 'unknown-card',
        skill_id: 'unknown-skill',
        params: {},
      },
    });

    expect(res.statusCode).toBe(404);
  });

  /**
   * Returns 400 when neither card_id nor skill_id is provided.
   */
  it('returns 400 when both card_id and skill_id are absent', async () => {
    const handlers: HandlerMap = {};
    const app = Fastify({ logger: false });
    app.post('/handle', createRequestHandler(handlers));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/handle',
      payload: { params: {} },
    });

    expect(res.statusCode).toBe(400);
  });
});
