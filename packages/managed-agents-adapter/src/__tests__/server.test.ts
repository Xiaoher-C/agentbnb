import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildServer } from '../server.js';

describe('Managed Agents Adapter Server', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let tmpDir: string;

  beforeAll(() => {
    // Use a temp directory for the keystore during tests
    tmpDir = mkdtempSync(join(tmpdir(), 'adapter-test-'));
    process.env['KEYSTORE_PATH'] = tmpDir;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    // Clean up temp keystore
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    delete process.env['KEYSTORE_PATH'];
  });

  it('GET /health returns 200 with status ok and service account', async () => {
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
    expect(body.service_account).toBeDefined();
    expect(body.service_account.did).toMatch(/^did:agentbnb:/);
    expect(body.service_account.agent_id).toHaveLength(16);
  });

  it('POST /mcp with initialize JSON-RPC returns 200', async () => {
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

    expect(response.statusCode).toBe(200);
  });
});
