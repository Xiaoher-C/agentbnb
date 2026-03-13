import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPeers, savePeer, removePeer, findPeer, type PeerConfig } from './peers.js';

/**
 * Each test suite gets an isolated temp directory via AGENTBNB_DIR.
 * This matches the test isolation pattern used in index.test.ts.
 */
describe('peers: CRUD operations', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-peers-test-'));
    savedEnv = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tmpDir;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['AGENTBNB_DIR'];
    } else {
      process.env['AGENTBNB_DIR'] = savedEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test 1: savePeer stores a peer to peers.json in config dir', () => {
    const peer: PeerConfig = {
      name: 'alice',
      url: 'http://192.168.1.50:7700',
      token: 'secret123',
      added_at: '2026-03-13T00:00:00Z',
    };

    savePeer(peer);

    expect(existsSync(join(tmpDir, 'peers.json'))).toBe(true);
    const raw = readFileSync(join(tmpDir, 'peers.json'), 'utf-8');
    const peers = JSON.parse(raw) as PeerConfig[];
    expect(peers).toHaveLength(1);
    expect(peers[0]?.name).toBe('alice');
    expect(peers[0]?.url).toBe('http://192.168.1.50:7700');
  });

  it('Test 2: loadPeers returns all saved peers', () => {
    const peer1: PeerConfig = {
      name: 'alice',
      url: 'http://192.168.1.50:7700',
      token: 'secret123',
      added_at: '2026-03-13T00:00:00Z',
    };
    const peer2: PeerConfig = {
      name: 'bob',
      url: 'http://192.168.1.51:7700',
      token: 'secret456',
      added_at: '2026-03-13T01:00:00Z',
    };

    savePeer(peer1);
    savePeer(peer2);

    const peers = loadPeers();
    expect(peers).toHaveLength(2);
    const names = peers.map((p) => p.name);
    expect(names).toContain('alice');
    expect(names).toContain('bob');
  });

  it('Test 3: findPeer returns matching peer by name (case-insensitive)', () => {
    const peer: PeerConfig = {
      name: 'Alice',
      url: 'http://192.168.1.50:7700',
      token: 'secret123',
      added_at: '2026-03-13T00:00:00Z',
    };

    savePeer(peer);

    const found = findPeer('alice');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Alice');

    const foundUpper = findPeer('ALICE');
    expect(foundUpper).not.toBeNull();
    expect(foundUpper?.url).toBe('http://192.168.1.50:7700');
  });

  it('Test 4: findPeer returns null for unknown peer', () => {
    const peer: PeerConfig = {
      name: 'alice',
      url: 'http://192.168.1.50:7700',
      token: 'secret123',
      added_at: '2026-03-13T00:00:00Z',
    };

    savePeer(peer);

    const found = findPeer('charlie');
    expect(found).toBeNull();
  });

  it('Test 5: removePeer deletes a peer by name', () => {
    savePeer({ name: 'alice', url: 'http://192.168.1.50:7700', token: 'secret123', added_at: '2026-03-13T00:00:00Z' });
    savePeer({ name: 'bob', url: 'http://192.168.1.51:7700', token: 'secret456', added_at: '2026-03-13T01:00:00Z' });

    const removed = removePeer('alice');
    expect(removed).toBe(true);

    const peers = loadPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.name).toBe('bob');
  });

  it('Test 6: savePeer with existing name overwrites the entry', () => {
    savePeer({ name: 'alice', url: 'http://192.168.1.50:7700', token: 'oldtoken', added_at: '2026-03-13T00:00:00Z' });
    savePeer({ name: 'alice', url: 'http://10.0.0.5:7700', token: 'newtoken', added_at: '2026-03-13T02:00:00Z' });

    const peers = loadPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.url).toBe('http://10.0.0.5:7700');
    expect(peers[0]?.token).toBe('newtoken');
  });

  it('Test 7: findPeer returns correct url+token for cross-peer request resolution', () => {
    // Save a peer that would be used with `agentbnb request --peer alice`
    savePeer({
      name: 'alice',
      url: 'http://192.168.1.50:7700',
      token: 'secret123',
      added_at: '2026-03-13T00:00:00Z',
    });

    const peer = findPeer('alice');
    expect(peer).not.toBeNull();
    // These are exactly the fields that will be passed to requestCapability()
    // as gatewayUrl and token when --peer is provided
    expect(peer?.url).toBe('http://192.168.1.50:7700');
    expect(peer?.token).toBe('secret123');
  });
});

describe('peers: loadPeers on empty config dir', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-peers-empty-'));
    savedEnv = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tmpDir;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['AGENTBNB_DIR'];
    } else {
      process.env['AGENTBNB_DIR'] = savedEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when peers.json does not exist', () => {
    const peers = loadPeers();
    expect(peers).toEqual([]);
  });
});
