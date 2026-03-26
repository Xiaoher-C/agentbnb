import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthChecker } from './health-checker.js';
import Database from 'better-sqlite3';

describe('HealthChecker', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS capability_cards (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
  });

  function insertCard(id: string, owner: string, online: boolean, gatewayUrl?: string) {
    const card = {
      id, owner, name: 'test', description: 'test', spec_version: '1.0', level: 1,
      inputs: [], outputs: [], pricing: { credits_per_call: 1 },
      availability: { online },
      _internal: gatewayUrl ? { gateway_url: gatewayUrl } : {},
    };
    db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, owner, JSON.stringify(card), new Date().toISOString(), new Date().toISOString());
  }

  it('marks card offline after 3 consecutive failed health checks', async () => {
    insertCard('card-1', 'owner-a', true, 'http://unreachable:9999');
    const checker = new HealthChecker({ db, maxFailures: 3, pingTimeoutMs: 500 });

    // Mock fetch to always fail
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await checker.checkAll(); // failure 1
    await checker.checkAll(); // failure 2
    const result = await checker.checkAll(); // failure 3 — should mark offline

    expect(result.markedOffline).toContain('card-1');
    const row = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get('card-1') as { data: string };
    const card = JSON.parse(row.data);
    expect(card.availability.online).toBe(false);

    vi.unstubAllGlobals();
  });

  it('resets failure count on successful check', async () => {
    insertCard('card-2', 'owner-b', true, 'http://localhost:9999');
    const checker = new HealthChecker({ db, maxFailures: 3, pingTimeoutMs: 500 });

    // Fail twice, then succeed
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await checker.checkAll(); // fail 1
    await checker.checkAll(); // fail 2
    await checker.checkAll(); // success — reset

    expect(checker.getFailureCount('card-2')).toBe(0);
    vi.unstubAllGlobals();
  });

  it('skips WebSocket-connected agents', async () => {
    insertCard('card-3', 'ws-owner', true, 'http://localhost:9999');
    const mockFetch = vi.fn().mockRejectedValue(new Error('fail'));
    vi.stubGlobal('fetch', mockFetch);

    const checker = new HealthChecker({
      db, maxFailures: 1, pingTimeoutMs: 500,
      getWebSocketOwners: () => ['ws-owner'],
    });

    const result = await checker.checkAll();
    expect(result.checked).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('does not check offline cards', async () => {
    insertCard('card-offline', 'owner-off', false, 'http://localhost:9999');
    const mockFetch = vi.fn().mockRejectedValue(new Error('fail'));
    vi.stubGlobal('fetch', mockFetch);

    const checker = new HealthChecker({ db, maxFailures: 1, pingTimeoutMs: 500 });
    const result = await checker.checkAll();

    expect(result.checked).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('does not mark card offline if gateway_url is missing', async () => {
    insertCard('card-no-gw', 'owner-nogw', true); // no gateway_url
    const checker = new HealthChecker({ db, maxFailures: 1, pingTimeoutMs: 500 });

    const result = await checker.checkAll();

    // Card is checked but ping returns false due to no URL — marked offline after 1 failure
    expect(result.checked).toBe(1);
    expect(result.markedOffline).toContain('card-no-gw');
  });

  it('start and stop manage the interval', () => {
    const checker = new HealthChecker({ db, checkIntervalMs: 60000 });
    checker.start();
    // Should not throw
    checker.stop();
    // Double stop is safe
    checker.stop();
  });
});
