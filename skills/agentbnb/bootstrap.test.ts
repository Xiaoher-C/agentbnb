/**
 * Integration test for bootstrap.ts activate()/deactivate() lifecycle.
 *
 * Tests the full lifecycle using real implementations with in-memory DBs:
 *   activate() -> runtime + card published + gateway listening + IdleMonitor running
 *   deactivate() -> gateway closed + runtime shutdown + resources cleaned up
 *
 * No mocks — this is an end-to-end integration test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activate, deactivate } from './bootstrap.js';
import type { BootstrapContext } from './bootstrap.js';
import { IdleMonitor } from '../../src/autonomy/idle-monitor.js';

// ---------------------------------------------------------------------------
// Test fixture: minimal SOUL.md with 2 skills
// ---------------------------------------------------------------------------
const SOUL_MD_CONTENT = `# Test Agent

A test agent for integration testing.

## Code Review
Reviews code for quality and bugs.

## Translation
Translates text between languages.
`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('bootstrap activate/deactivate lifecycle', () => {
  let tmpDir: string | undefined;
  let ctx: BootstrapContext | undefined;

  /**
   * Create a fresh temp dir with a SOUL.md file.
   * Returns the absolute path to the SOUL.md file.
   */
  function setupSoulMd(): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    const path = join(tmpDir, 'SOUL.md');
    writeFileSync(path, SOUL_MD_CONTENT, 'utf8');
    return path;
  }

  // Ensure all resources are torn down after every test
  afterEach(async () => {
    if (ctx) {
      await deactivate(ctx).catch(() => undefined);
      ctx = undefined;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // Test 1: activate() returns BootstrapContext with all components
  // ---------------------------------------------------------------------------
  it('activate() returns BootstrapContext with all components', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    // runtime has both DB handles
    expect(ctx.runtime).toBeDefined();
    expect(ctx.runtime.registryDb).toBeDefined();
    expect(ctx.runtime.creditDb).toBeDefined();

    // gateway is a Fastify instance (has inject method)
    expect(ctx.gateway).toBeDefined();
    expect(typeof ctx.gateway.inject).toBe('function');

    // idleMonitor is an IdleMonitor instance
    expect(ctx.idleMonitor).toBeInstanceOf(IdleMonitor);

    // card has correct structure: spec_version 2.0, 2 skills
    expect(ctx.card.spec_version).toBe('2.0');
    expect(Array.isArray(ctx.card.skills)).toBe(true);
    expect(ctx.card.skills!.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Test 2: activate() publishes card from SOUL.md into registry
  // ---------------------------------------------------------------------------
  it('activate() publishes card from SOUL.md into registry', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    // Query the registry DB for capability_cards owned by this agent
    const rows = ctx.runtime.registryDb
      .prepare('SELECT id, owner, data FROM capability_cards WHERE owner = ?')
      .all('test-agent') as Array<{ id: string; owner: string; data: string }>;

    expect(rows.length).toBe(1);
    expect(rows[0].owner).toBe('test-agent');

    // Parse the card data and verify both skills are present
    const cardData = JSON.parse(rows[0].data) as {
      skills?: Array<{ name: string }>;
    };
    const skillNames = (cardData.skills ?? []).map((s) => s.name);
    expect(skillNames).toContain('Code Review');
    expect(skillNames).toContain('Translation');
  });

  // ---------------------------------------------------------------------------
  // Test 3: activate() starts gateway that responds to health check
  // ---------------------------------------------------------------------------
  it('activate() starts gateway that responds to health check', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    // Use Fastify inject — no real HTTP connection needed
    const response = await ctx.gateway.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  // ---------------------------------------------------------------------------
  // Test 4: activate() registers IdleMonitor job in runtime.jobs
  // ---------------------------------------------------------------------------
  it('activate() registers IdleMonitor job in runtime.jobs', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    // At least one cron job registered (the IdleMonitor's polling job)
    expect(ctx.runtime.jobs.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 5: deactivate() sets runtime.isDraining to true
  // ---------------------------------------------------------------------------
  it('deactivate() sets runtime.isDraining to true', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    expect(ctx.runtime.isDraining).toBe(false);

    await deactivate(ctx);
    // Clear so afterEach doesn't double-deactivate
    const savedCtx = ctx;
    ctx = undefined;

    expect(savedCtx.runtime.isDraining).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 6: deactivate() closes DB handles
  // ---------------------------------------------------------------------------
  it('deactivate() closes DB handles', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    // Capture reference before clearing ctx
    const runtime = ctx.runtime;
    await deactivate(ctx);
    ctx = undefined;

    // Queries should throw after DB handles are closed
    expect(() => {
      runtime.registryDb.prepare('SELECT 1').get();
    }).toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 7: deactivate() is idempotent
  // ---------------------------------------------------------------------------
  it('deactivate() is idempotent', async () => {
    const soulMdPath = setupSoulMd();

    ctx = await activate({
      owner: 'test-agent',
      soulMdPath,
      registryDbPath: ':memory:',
      creditDbPath: ':memory:',
      gatewayPort: 0,
      silent: true,
    });

    await deactivate(ctx);
    // Second call must not throw
    await expect(deactivate(ctx)).resolves.not.toThrow();

    ctx = undefined;
  });

  // ---------------------------------------------------------------------------
  // Test 8: activate() throws when SOUL.md does not exist
  // ---------------------------------------------------------------------------
  it('activate() throws when SOUL.md does not exist', async () => {
    await expect(
      activate({
        owner: 'test-agent',
        soulMdPath: '/nonexistent/path/SOUL.md',
        registryDbPath: ':memory:',
        creditDbPath: ':memory:',
        gatewayPort: 0,
        silent: true,
      }),
    ).rejects.toThrow();
  });
});
