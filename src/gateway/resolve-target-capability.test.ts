import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../registry/store.js';
import { resolveTargetCapability } from './resolve-target-capability.js';
import type { CapabilityCard } from '../types/index.js';
import { createAgentRecord } from '../identity/agent-identity.js';

vi.mock('../cli/remote-registry.js', () => ({
  fetchRemoteCards: vi.fn(),
}));

import { fetchRemoteCards } from '../cli/remote-registry.js';

function insertRawCard(db: Database.Database, card: Record<string, unknown>): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    String(card['id']),
    String(card['owner']),
    JSON.stringify(card),
    now,
    now,
  );
}

describe('resolveTargetCapability', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('resolves capability from local registry by exact skill_id', async () => {
    createAgentRecord(db, {
      agent_id: 'aaaaaaaaaaaaaaaa',
      display_name: 'local-owner',
      public_key: '11'.repeat(32),
      legacy_owner: 'local-owner',
    });

    insertRawCard(db, {
      spec_version: '2.0',
      id: 'card-local',
      owner: 'local-owner',
      agent_name: 'Local Agent',
      availability: { online: true },
      skills: [
        {
          id: 'skill-stock-analysis',
          name: 'Stock Analysis',
          description: 'Analyze US market data',
          level: 1,
          inputs: [],
          outputs: [],
          pricing: { credits_per_call: 7 },
          availability: { online: true },
        },
      ],
    });

    const resolved = await resolveTargetCapability('skill-stock-analysis', {
      registryDb: db,
      onlineOnly: true,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.cardId).toBe('card-local');
    expect(resolved?.skillId).toBe('skill-stock-analysis');
    expect(resolved?.agent_id).toBe('aaaaaaaaaaaaaaaa');
    expect(resolved?.via_relay).toBe(false);
    expect(resolved?.source).toBe('local');
  });

  it('resolves capability from remote registry query results', async () => {
    vi.mocked(fetchRemoteCards).mockResolvedValue([
      {
        spec_version: '2.0',
        id: 'card-remote',
        owner: 'remote-owner',
        gateway_url: 'https://peer.example.com',
        availability: { online: true },
        pricing: { credits_per_call: 20 },
        skills: [
          {
            id: 'skill-remote-stock',
            name: 'Remote Stock Analysis',
            description: 'Analyze stock trends',
            level: 1,
            inputs: [],
            outputs: [],
            pricing: { credits_per_call: 12 },
          },
        ],
        agent_id: 'bbbbbbbbbbbbbbbb',
      },
    ] as unknown as CapabilityCard[]);

    const resolved = await resolveTargetCapability('stock analysis', {
      registryDb: db,
      registryUrl: 'https://registry.example.com',
      onlineOnly: true,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.cardId).toBe('card-remote');
    expect(resolved?.owner).toBe('remote-owner');
    expect(resolved?.agent_id).toBe('bbbbbbbbbbbbbbbb');
    expect(resolved?.via_relay).toBe(false);
    expect(resolved?.source).toBe('remote');
  });

  it('falls back to relay-connected providers when query search misses', async () => {
    vi.mocked(fetchRemoteCards)
      .mockResolvedValueOnce([] as CapabilityCard[])
      .mockResolvedValueOnce([
        {
          spec_version: '2.0',
          id: 'card-relay',
          owner: 'relay-owner',
          availability: { online: true },
          pricing: { credits_per_call: 20 },
          skills: [
            {
              id: 'skill-stock-analysis',
              name: 'Stock Analysis',
              description: 'Analyze stocks over relay',
              level: 1,
              inputs: [],
              outputs: [],
              pricing: { credits_per_call: 9 },
            },
          ],
        },
      ] as unknown as CapabilityCard[]);

    const resolved = await resolveTargetCapability('stock analysis', {
      registryDb: db,
      registryUrl: 'https://registry.example.com',
      onlineOnly: true,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.cardId).toBe('card-relay');
    expect(resolved?.via_relay).toBe(true);
    expect(resolved?.source).toBe('relay');
  });
});
