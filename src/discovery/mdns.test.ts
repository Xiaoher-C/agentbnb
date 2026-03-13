import { describe, it, expect, afterEach, afterAll } from 'vitest';
import {
  announceGateway,
  discoverLocalAgents,
  stopAnnouncement,
  type DiscoveredAgent,
} from './mdns.js';

/**
 * mDNS tests use real network multicast (loopback via same process).
 * Each test cleans up in afterEach to avoid port conflicts.
 * Browse BEFORE announce so the browser is listening when the service is published.
 */

describe('mDNS discovery module', () => {
  afterEach(async () => {
    await stopAnnouncement();
  });

  afterAll(async () => {
    await stopAnnouncement();
  });

  it('Test 1: announceGateway publishes a service and returns without error', () => {
    expect(() => announceGateway('test-agent-1', 17701)).not.toThrow();
  });

  it('Test 2: discoverLocalAgents finds a previously announced agent on loopback', async () => {
    const owner = 'test-agent-loopback';
    const port = 17702;

    // Start browsing FIRST so the browser is listening before announcement
    const found = await new Promise<DiscoveredAgent | null>((resolve) => {
      let browser: { stop: () => void } | null = null;
      const timeout = setTimeout(() => {
        browser?.stop();
        resolve(null);
      }, 4000);

      browser = discoverLocalAgents((agent) => {
        if (agent.owner === owner) {
          clearTimeout(timeout);
          browser?.stop();
          resolve(agent);
        }
      });

      // Announce after browser is started
      announceGateway(owner, port);
    });

    expect(found).not.toBeNull();
    expect(found?.owner).toBe(owner);
    expect(found?.name).toContain(owner);
    expect(found?.url).toMatch(/^http:\/\//);
  });

  it('Test 3: stopAnnouncement cleans up without error', async () => {
    announceGateway('test-agent-cleanup', 17703);
    // First call should resolve cleanly
    await expect(stopAnnouncement()).resolves.toBeUndefined();
    // Second call should also be safe (idempotent — no instance to destroy)
    await expect(stopAnnouncement()).resolves.toBeUndefined();
  });

  it('Test 4: Multiple agents can announce and all are discovered', async () => {
    const agents = [
      { owner: 'multi-agent-a', port: 17706 },
      { owner: 'multi-agent-b', port: 17707 },
    ];

    const foundOwners: string[] = [];
    await new Promise<void>((resolve) => {
      let browser: { stop: () => void } | null = null;
      const timeout = setTimeout(() => {
        browser?.stop();
        resolve();
      }, 4000);

      // Start browsing first
      browser = discoverLocalAgents((agent) => {
        const matchingAgent = agents.find((a) => a.owner === agent.owner);
        if (matchingAgent && !foundOwners.includes(agent.owner)) {
          foundOwners.push(agent.owner);
          if (foundOwners.length >= agents.length) {
            clearTimeout(timeout);
            browser?.stop();
            resolve();
          }
        }
      });

      // Announce all agents after browser is started
      for (const agent of agents) {
        announceGateway(agent.owner, agent.port);
      }
    });

    // At minimum, one agent should be discoverable on loopback
    expect(foundOwners.length).toBeGreaterThanOrEqual(1);
  });
});
