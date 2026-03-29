import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentBnBConfig } from '../cli/config.js';
import { ProcessGuard } from './process-guard.js';
import {
  ServiceCoordinator,
  buildRelayRegistrationCards,
  loadPersistedRuntime,
  resolveNodeExecutable,
} from './service-coordinator.js';

function makeConfig(overrides: Partial<AgentBnBConfig> = {}): AgentBnBConfig {
  const root = mkdtempSync(join(tmpdir(), 'agentbnb-service-coordinator-config-'));
  return {
    owner: 'test-owner',
    gateway_url: 'http://127.0.0.1:7700',
    gateway_port: 7700,
    db_path: join(root, 'registry.db'),
    credit_db_path: join(root, 'credit.db'),
    token: 'test-token',
    ...overrides,
  };
}

describe('ServiceCoordinator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-service-coordinator-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads node_exec from persisted runtime.json', () => {
    const runtimePath = join(tmpDir, 'runtime.json');
    writeFileSync(
      runtimePath,
      JSON.stringify({
        node_exec: '/opt/node/bin/node',
        node_version: 'v24.0.0',
        source: 'OPENCLAW_NODE_EXEC',
        detected_at: '2026-03-21T00:00:00.000Z',
      }),
      'utf8',
    );

    const runtime = loadPersistedRuntime(tmpDir);
    expect(runtime).not.toBeNull();
    expect(runtime?.node_exec).toBe('/opt/node/bin/node');
    expect(resolveNodeExecutable(runtime)).toBe('/opt/node/bin/node');
  });

  it('falls back to process.execPath when no persisted runtime is found', () => {
    const runtime = loadPersistedRuntime(tmpDir);
    expect(runtime).toBeNull();
    expect(resolveNodeExecutable(runtime)).toBe(process.execPath);
  });

  it('buildRelayRegistrationCards falls back to a synthetic card when registry is empty', () => {
    const registration = buildRelayRegistrationCards('relay-owner', []);

    expect(registration.primaryCard.owner).toBe('relay-owner');
    expect(registration.primaryCard.name).toBe('relay-owner');
    expect(registration.additionalCards).toEqual([]);
  });

  it('buildRelayRegistrationCards publishes every local card on the relay connection', () => {
    const primary = { id: 'card-primary', owner: 'relay-owner', name: 'Primary' };
    const conductor = { id: 'card-conductor', owner: 'relay-owner', name: 'Conductor' };
    const extraSkill = { id: 'card-extra', owner: 'relay-owner', name: 'Extra Skill' };

    const registration = buildRelayRegistrationCards('relay-owner', [primary, conductor, extraSkill]);

    expect(registration.primaryCard).toEqual(primary);
    expect(registration.additionalCards).toEqual([conductor, extraSkill]);
  });

  it('foreground startup failure rolls back lock and releases pid file', async () => {
    const config = makeConfig({
      db_path: join(tmpDir, 'missing', 'registry.db'),
      credit_db_path: join(tmpDir, 'missing', 'credit.db'),
    });
    const pidPath = join(tmpDir, '.pid');
    const guard = new ProcessGuard(pidPath);
    const coordinator = new ServiceCoordinator(config, guard);

    await expect(
      coordinator.ensureRunning({
        foreground: true,
        port: 7700,
        registryPort: 0,
        relay: false,
      }),
    ).rejects.toThrow();

    expect(guard.getRunningMeta()).toBeNull();
    expect(existsSync(pidPath)).toBe(false);
  });

  it('healthCheck validates AgentBnB JSON-RPC signature', async () => {
    const server = Fastify({ logger: false });
    server.get('/health', async () => ({ status: 'ok', version: '0.0.1' }));
    server.post('/rpc', async () => ({
      jsonrpc: '2.0',
      id: 'agentbnb-health-signature',
      error: { code: -32601, message: 'Method not found' },
    }));
    await server.listen({ port: 0, host: '127.0.0.1' });

    const address = server.server.address() as { port: number };
    const port = address.port;
    const config = makeConfig({
      gateway_url: `http://127.0.0.1:${port}`,
      gateway_port: port,
    });
    const pidPath = join(tmpDir, '.pid');
    const guard = new ProcessGuard(pidPath);
    guard.acquire({
      started_at: new Date().toISOString(),
      port,
      owner: config.owner,
    });
    const coordinator = new ServiceCoordinator(config, guard);

    try {
      const result = await coordinator.healthCheck();
      expect(result.ok).toBe(true);
      expect(result.agentbnb).toBe(true);
      expect(result.version).toBe('0.0.1');
    } finally {
      guard.release();
      await server.close();
    }
  });

  it('healthCheck rejects servers without AgentBnB JSON-RPC signature', async () => {
    const server = Fastify({ logger: false });
    server.get('/health', async () => ({ status: 'ok', version: '0.0.1' }));
    server.post('/rpc', async () => ({
      jsonrpc: '2.0',
      id: 'agentbnb-health-signature',
      error: { code: -32000, message: 'Unauthorized' },
    }));
    await server.listen({ port: 0, host: '127.0.0.1' });

    const address = server.server.address() as { port: number };
    const port = address.port;
    const config = makeConfig({
      gateway_url: `http://127.0.0.1:${port}`,
      gateway_port: port,
    });
    const pidPath = join(tmpDir, '.pid');
    const guard = new ProcessGuard(pidPath);
    guard.acquire({
      started_at: new Date().toISOString(),
      port,
      owner: config.owner,
    });
    const coordinator = new ServiceCoordinator(config, guard);

    try {
      const result = await coordinator.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.agentbnb).toBe(false);
      expect(result.version).toBe('0.0.1');
    } finally {
      guard.release();
      await server.close();
    }
  });
});
