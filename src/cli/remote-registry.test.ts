import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CapabilityCard } from '../types/index.js';
import {
  fetchRemoteCards,
  mergeResults,
  RegistryTimeoutError,
  RegistryConnectionError,
  RegistryAuthError,
} from './remote-registry.js';
import { AgentBnBError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCard(id: string, name: string): CapabilityCard {
  return {
    spec_version: '1.0',
    id,
    owner: 'test-owner',
    name,
    description: 'A test capability card',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'result', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {},
  };
}

const LOCAL_CARD_1 = makeCard('00000000-0000-0000-0000-000000000001', 'Local Voice');
const LOCAL_CARD_2 = makeCard('00000000-0000-0000-0000-000000000002', 'Local Translate');
const REMOTE_CARD_1 = makeCard('00000000-0000-0000-0000-000000000011', 'Remote Image');
const REMOTE_CARD_2 = makeCard('00000000-0000-0000-0000-000000000012', 'Remote Video');
const DUPLICATE_CARD = makeCard('00000000-0000-0000-0000-000000000001', 'Duplicate (remote version)');

// ---------------------------------------------------------------------------
// fetchRemoteCards
// ---------------------------------------------------------------------------

describe('fetchRemoteCards', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws AgentBnBError with INVALID_REGISTRY_URL for malformed URL', async () => {
    await expect(fetchRemoteCards('not-a-url', {})).rejects.toMatchObject({
      code: 'INVALID_REGISTRY_URL',
    });
  });

  it('builds URL with no params (only limit=100)', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ total: 0, limit: 100, offset: 0, items: [] }),
      };
    }));

    await fetchRemoteCards('http://host:7701', {});
    expect(capturedUrl).toBe('http://host:7701/cards?limit=100');
  });

  it('builds URL with q, level, online, tag params', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ total: 1, limit: 100, offset: 0, items: [REMOTE_CARD_1] }),
      };
    }));

    await fetchRemoteCards('http://host:7701', { q: 'voice', level: 1, online: true, tag: 'tts' });
    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('q')).toBe('voice');
    expect(parsed.searchParams.get('level')).toBe('1');
    expect(parsed.searchParams.get('online')).toBe('true');
    expect(parsed.searchParams.get('tag')).toBe('tts');
    expect(parsed.searchParams.get('limit')).toBe('100');
  });

  it('returns items array from response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total: 2, limit: 100, offset: 0, items: [REMOTE_CARD_1, REMOTE_CARD_2] }),
    })));

    const result = await fetchRemoteCards('http://host:7701', {});
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(REMOTE_CARD_1.id);
    expect(result[1]?.id).toBe(REMOTE_CARD_2.id);
  });

  it('throws RegistryTimeoutError when fetch times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: { signal?: AbortSignal }) => {
      // Simulate never-resolving fetch — wait for abort
      return new Promise<never>((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }));

    await expect(fetchRemoteCards('http://host:7701', {}, 50)).rejects.toBeInstanceOf(RegistryTimeoutError);
  }, 2000);

  it('throws RegistryConnectionError on network failure (ECONNREFUSED)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('fetch failed');
      (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
      throw err;
    }));

    await expect(fetchRemoteCards('http://host:7701', {})).rejects.toBeInstanceOf(RegistryConnectionError);
  });

  it('throws RegistryAuthError on 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    })));

    await expect(fetchRemoteCards('http://host:7701', {})).rejects.toBeInstanceOf(RegistryAuthError);
  });

  it('throws RegistryAuthError on 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    })));

    await expect(fetchRemoteCards('http://host:7701', {})).rejects.toBeInstanceOf(RegistryAuthError);
  });

  it('RegistryTimeoutError message contains registry URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: { signal?: AbortSignal }) => {
      return new Promise<never>((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }));

    try {
      await fetchRemoteCards('http://host:7701', {}, 50);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryTimeoutError);
      expect((err as Error).message).toContain('http://host:7701');
    }
  }, 2000);

  it('RegistryConnectionError has REGISTRY_CONNECTION code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));

    try {
      await fetchRemoteCards('http://host:7701', {});
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as AgentBnBError).code).toBe('REGISTRY_CONNECTION');
    }
  });

  it('RegistryAuthError has REGISTRY_AUTH code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
    })));

    try {
      await fetchRemoteCards('http://host:7701', {});
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as AgentBnBError).code).toBe('REGISTRY_AUTH');
    }
  });
});

// ---------------------------------------------------------------------------
// mergeResults
// ---------------------------------------------------------------------------

describe('mergeResults', () => {
  it('tags local cards with source: local', () => {
    const result = mergeResults([LOCAL_CARD_1], [], false);
    expect(result[0]?.source).toBe('local');
  });

  it('tags remote cards with source: remote', () => {
    const result = mergeResults([], [REMOTE_CARD_1], false);
    expect(result[0]?.source).toBe('remote');
  });

  it('deduplicates by id — local wins over remote', () => {
    const result = mergeResults([LOCAL_CARD_1], [DUPLICATE_CARD], false);
    const card = result.find((c) => c.id === LOCAL_CARD_1.id);
    expect(card).toBeDefined();
    expect(card?.source).toBe('local');
    expect(card?.name).toBe('Local Voice'); // not "Duplicate (remote version)"
    // Should only appear once
    const matches = result.filter((c) => c.id === LOCAL_CARD_1.id);
    expect(matches).toHaveLength(1);
  });

  it('returns local-first order when hasQuery=false', () => {
    const result = mergeResults([LOCAL_CARD_1, LOCAL_CARD_2], [REMOTE_CARD_1, REMOTE_CARD_2], false);
    // All local come before all remote
    const localIdx1 = result.findIndex((c) => c.id === LOCAL_CARD_1.id);
    const localIdx2 = result.findIndex((c) => c.id === LOCAL_CARD_2.id);
    const remoteIdx1 = result.findIndex((c) => c.id === REMOTE_CARD_1.id);
    const remoteIdx2 = result.findIndex((c) => c.id === REMOTE_CARD_2.id);
    expect(localIdx1).toBeLessThan(remoteIdx1);
    expect(localIdx2).toBeLessThan(remoteIdx1);
    expect(localIdx1).toBeLessThan(remoteIdx2);
  });

  it('interleaves when hasQuery=true', () => {
    const result = mergeResults([LOCAL_CARD_1, LOCAL_CARD_2], [REMOTE_CARD_1, REMOTE_CARD_2], true);
    // Interleaved: [local1, remote1, local2, remote2] or similar alternating pattern
    // Check that sources alternate (no two consecutive same source in first 4)
    const sources = result.slice(0, 4).map((c) => c.source);
    // At least one local and one remote in first 4 positions
    expect(sources).toContain('local');
    expect(sources).toContain('remote');
    // Should not be all local first then all remote
    const allLocalFirst = sources.every((s, i) => i < 2 ? s === 'local' : s === 'remote');
    expect(allLocalFirst).toBe(false);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeResults([], [], false)).toHaveLength(0);
    expect(mergeResults([], [], true)).toHaveLength(0);
  });

  it('handles only local cards', () => {
    const result = mergeResults([LOCAL_CARD_1, LOCAL_CARD_2], [], false);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.source === 'local')).toBe(true);
  });

  it('handles only remote cards', () => {
    const result = mergeResults([], [REMOTE_CARD_1, REMOTE_CARD_2], true);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.source === 'remote')).toBe(true);
  });

  it('deduplication works with query mode (hasQuery=true)', () => {
    const result = mergeResults([LOCAL_CARD_1], [DUPLICATE_CARD, REMOTE_CARD_1], true);
    const matches = result.filter((c) => c.id === LOCAL_CARD_1.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe('local');
  });
});
