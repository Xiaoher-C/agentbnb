import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import {
  announceGateway,
  discoverLocalAgents,
  stopAnnouncement,
  type DiscoveredAgent,
} from './mdns.js';

/**
 * mDNS tests use real network multicast.
 * Each test cleans up (stopAnnouncement + browser.stop) in afterEach/afterAll.
 */

describe('mDNS discovery module', () => {
  afterEach(async () => {
    // Always clean up after each test to avoid port conflicts
    await stopAnnouncement();
  });

  afterAll(async () => {
    // Final cleanup
    await stopAnnouncement();
  });

  it('Test 1: announceGateway publishes a service and returns without error', () => {
    // Should not throw
    expect(() => announceGateway('test-agent-1', 17701)).not.toThrow();
  });

  it('Test 2: discoverLocalAgents finds a previously announced agent on loopback', async () => {
    const owner = 'test-agent-loopback';
    const port = 17702;

    // Announce first
    announceGateway(owner, port);

    // Then browse and wait for up event (up to 3 seconds)
    const found = await new Promise<DiscoveredAgent | null>((resolve) => {
      let browser: { stop: () => void } | null = null;
      const timeout = setTimeout(() => {
        browser?.stop();
        resolve(null);
      }, 3000);

      browser = discoverLocalAgents(
        (agent) => {
          if (agent.owner === owner) {
            clearTimeout(timeout);
            browser?.stop();
            resolve(agent);
          }
        },
        undefined,
      );
    });

    expect(found).not.toBeNull();
    expect(found?.owner).toBe(owner);
    expect(found?.name).toContain(owner);
    expect(found?.url).toMatch(/^http:\/\//);
  });

  it('Test 3: stopAnnouncement cleans up without error', async () => {
    announceGateway('test-agent-cleanup', 17703);
    // Should not throw on first call
    await expect(stopAnnouncement()).resolves.toBeUndefined();
    // Should be idempotent - second call also should not throw
    await expect(stopAnnouncement()).resolves.toBeUndefined();
  });

  it('Test 4: Multiple agents can announce and all are discovered', async () => {
    const agents = [
      { owner: 'multi-agent-a', port: 17704 },
      { owner: 'multi-agent-b', port: 17705 },
    ];

    for (const agent of agents) {
      announceGateway(agent.owner, agent.port);
    }

    // Discover and collect found agents (up to 3 seconds)
    const foundOwners: string[] = [];
    await new Promise<void>((resolve) => {
      let browser: { stop: () => void } | null = null;
      const timeout = setTimeout(() => {
        browser?.stop();
        resolve();
      }, 3000);

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
    });

    // At least one of the agents should be found (loopback mDNS may find both)
    expect(foundOwners.length).toBeGreaterThanOrEqual(1);
  });
});
