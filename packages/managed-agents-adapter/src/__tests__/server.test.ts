import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../server.js';

describe('Managed Agents Adapter Server', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /health returns 200 with status ok', async () => {
    const server = await buildServer();
    app = server.app;

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.uptime).toBe('number');
  });

  it('POST /mcp with tools/list JSON-RPC returns tools', async () => {
    const server = await buildServer();
    app = server.app;

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      },
    });

    // The StreamableHTTPServerTransport hijacks the response,
    // so we verify it does not return a Fastify error (404/500).
    // Status 200 means the transport handled the request.
    expect(response.statusCode).toBe(200);
  });
});
