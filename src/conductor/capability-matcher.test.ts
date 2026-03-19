import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, runMigrations, insertCard } from '../registry/store.js';
import { matchSubTasks } from './capability-matcher.js';
import type { SubTask } from './types.js';
import type { CapabilityCard } from '../types/index.js';

vi.mock('../cli/remote-registry.js', () => ({
  fetchRemoteCards: vi.fn(),
}));

import { fetchRemoteCards } from '../cli/remote-registry.js';

/** Helper to build a minimal v1.0 card. */
function makeV1Card(overrides: Partial<CapabilityCard> & { owner: string; id: string }): CapabilityCard {
  return {
    spec_version: '1.0',
    name: overrides.name ?? 'Test Card',
    description: overrides.description ?? 'A test card',
    level: overrides.level ?? 1,
    inputs: [],
    outputs: [],
    pricing: overrides.pricing ?? { credits_per_call: 10 },
    availability: { online: true },
    metadata: overrides.metadata ?? { success_rate: 0.9, tags: [] },
    ...overrides,
  };
}

/** Helper to build a v2.0 card with skills. */
function makeV2Card(
  base: { owner: string; id: string; name?: string; description?: string },
  skills: Array<{
    id: string;
    name: string;
    description: string;
    category?: string;
    credits_per_call: number;
  }>,
): CapabilityCard {
  return {
    spec_version: '1.0',
    id: base.id,
    owner: base.owner,
    name: base.name ?? 'Multi-skill Agent',
    description: base.description ?? 'A multi-skill agent',
    level: 2,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 0 },
    availability: { online: true },
    metadata: { success_rate: 0.8, tags: [] },
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      level: 1 as const,
      category: s.category,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: s.credits_per_call },
    })),
  } as unknown as CapabilityCard;
}

describe('CapabilityMatcher', () => {
  function setupDb() {
    const db = openDatabase();
    runMigrations(db);
    return db;
  }

  it('matches 2 sub-tasks to the correct agents', async () => {
    const db = setupDb();

    // Insert cards for text_gen and tts
    const textCard = makeV1Card({
      id: randomUUID(),
      owner: 'agent-text',
      name: 'Text Generator',
      description: 'text generation writing',
      metadata: { success_rate: 0.95, tags: ['text_gen'] },
    });
    const ttsCard = makeV1Card({
      id: randomUUID(),
      owner: 'agent-tts',
      name: 'TTS Engine',
      description: 'text to speech tts audio',
      metadata: { success_rate: 0.9, tags: ['tts'] },
    });
    insertCard(db, textCard);
    insertCard(db, ttsCard);

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate text',
        required_capability: 'text generation',
        params: {},
        depends_on: [],
        estimated_credits: 10,
      },
      {
        id: 'st-2',
        description: 'Convert to speech',
        required_capability: 'tts audio',
        params: {},
        depends_on: ['st-1'],
        estimated_credits: 10,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results).toHaveLength(2);
    expect(results[0]!.subtask_id).toBe('st-1');
    expect(results[0]!.selected_agent).toBe('agent-text');
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[1]!.subtask_id).toBe('st-2');
    expect(results[1]!.selected_agent).toBe('agent-tts');
    expect(results[1]!.score).toBeGreaterThan(0);
  });

  it('excludes conductor own card from candidates (self-exclusion)', async () => {
    const db = setupDb();

    const selfCard = makeV1Card({
      id: randomUUID(),
      owner: 'conductor-agent',
      name: 'Text Generator',
      description: 'text generation',
      metadata: { success_rate: 1.0, tags: ['text_gen'] },
    });
    const otherCard = makeV1Card({
      id: randomUUID(),
      owner: 'agent-other',
      name: 'Text Generator Alt',
      description: 'text generation alternative',
      metadata: { success_rate: 0.7, tags: ['text_gen'] },
    });
    insertCard(db, selfCard);
    insertCard(db, otherCard);

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate text',
        required_capability: 'text generation',
        params: {},
        depends_on: [],
        estimated_credits: 10,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results).toHaveLength(1);
    expect(results[0]!.selected_agent).toBe('agent-other');
    // Conductor's own card should NOT appear anywhere
    expect(results[0]!.alternatives.every((a) => a.agent !== 'conductor-agent')).toBe(true);
  });

  it('populates alternatives when multiple agents match', async () => {
    const db = setupDb();

    // Insert 3 agents for same capability
    const agents = ['agent-a', 'agent-b', 'agent-c'];
    for (const owner of agents) {
      insertCard(
        db,
        makeV1Card({
          id: randomUUID(),
          owner,
          name: `Video Producer ${owner}`,
          description: 'video generation production',
          pricing: { credits_per_call: 15 },
          metadata: { success_rate: 0.8, tags: ['video_gen'] },
        }),
      );
    }

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Produce video',
        required_capability: 'video generation',
        params: {},
        depends_on: [],
        estimated_credits: 15,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results).toHaveLength(1);
    expect(results[0]!.selected_agent).toBeTruthy();
    // Should have up to 2 alternatives
    expect(results[0]!.alternatives.length).toBe(2);
  });

  it('returns empty match when no cards match the capability', async () => {
    const db = setupDb();

    // No cards inserted at all
    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate hologram',
        required_capability: 'hologram projection',
        params: {},
        depends_on: [],
        estimated_credits: 50,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results).toHaveLength(1);
    expect(results[0]!.selected_agent).toBe('');
    expect(results[0]!.selected_skill).toBe('');
    expect(results[0]!.score).toBe(0);
    expect(results[0]!.alternatives).toEqual([]);
  });

  it('handles v2.0 multi-skill cards via direct DB insertion', async () => {
    const db = setupDb();

    // V2 cards bypass insertCard() (which validates v1.0 only) — insert directly
    const cardId = randomUUID();
    const v2Data = {
      spec_version: '2.0',
      id: cardId,
      owner: 'agent-multi',
      agent_name: 'Multi Agent',
      skills: [
        {
          id: 'skill-tts',
          name: 'TTS Skill',
          description: 'text to speech tts audio',
          level: 1,
          inputs: [],
          outputs: [],
          pricing: { credits_per_call: 8 },
        },
        {
          id: 'skill-translate',
          name: 'Translate Skill',
          description: 'language translation',
          level: 1,
          inputs: [],
          outputs: [],
          pricing: { credits_per_call: 5 },
        },
      ],
      availability: { online: true },
      metadata: { success_rate: 0.85 },
    };

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cardId, 'agent-multi', JSON.stringify(v2Data), now, now);

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Convert text to speech',
        required_capability: 'tts speech',
        params: {},
        depends_on: [],
        estimated_credits: 8,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results).toHaveLength(1);
    expect(results[0]!.selected_agent).toBe('agent-multi');
    // Should have selected a skill from the v2 card
    expect(results[0]!.selected_skill).toBeTruthy();
    expect(results[0]!.credits).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Remote fallback tests
  // -----------------------------------------------------------------------

  it('falls back to remote when local has no match and registryUrl is set', async () => {
    const db = setupDb();

    const remoteCard = makeV1Card({
      id: randomUUID(),
      owner: 'remote-agent',
      name: 'Hologram Projector',
      description: 'hologram projection',
      metadata: { success_rate: 0.9, tags: ['hologram'] },
    });

    vi.mocked(fetchRemoteCards).mockResolvedValue([remoteCard]);

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Project hologram',
        required_capability: 'hologram projection',
        params: {},
        depends_on: [],
        estimated_credits: 10,
      },
    ];

    const results = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: 'conductor-agent',
      registryUrl: 'http://registry.example.com',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.selected_agent).toBe('remote-agent');
    expect(fetchRemoteCards).toHaveBeenCalledWith('http://registry.example.com', { q: 'hologram projection', online: true });
  });

  it('does NOT call fetchRemoteCards when local has a match', async () => {
    const db = setupDb();

    insertCard(db, makeV1Card({
      id: randomUUID(),
      owner: 'local-agent',
      name: 'Text Generator',
      description: 'text generation writing',
      metadata: { success_rate: 0.9, tags: ['text_gen'] },
    }));

    vi.mocked(fetchRemoteCards).mockClear();

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate text',
        required_capability: 'text generation',
        params: {},
        depends_on: [],
        estimated_credits: 10,
      },
    ];

    const results = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: 'conductor-agent',
      registryUrl: 'http://registry.example.com',
    });

    expect(results[0]!.selected_agent).toBe('local-agent');
    expect(fetchRemoteCards).not.toHaveBeenCalled();
  });

  it('returns empty match when no registryUrl and no local match (same as before)', async () => {
    const db = setupDb();

    vi.mocked(fetchRemoteCards).mockClear();

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate hologram',
        required_capability: 'hologram projection',
        params: {},
        depends_on: [],
        estimated_credits: 50,
      },
    ];

    const results = await matchSubTasks({ db, subtasks, conductorOwner: 'conductor-agent' });

    expect(results[0]!.selected_agent).toBe('');
    expect(results[0]!.score).toBe(0);
    expect(fetchRemoteCards).not.toHaveBeenCalled();
  });

  it('returns empty match gracefully when remote fetch fails', async () => {
    const db = setupDb();

    vi.mocked(fetchRemoteCards).mockRejectedValue(new Error('Network error'));

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate hologram',
        required_capability: 'hologram projection',
        params: {},
        depends_on: [],
        estimated_credits: 50,
      },
    ];

    const results = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: 'conductor-agent',
      registryUrl: 'http://registry.example.com',
    });

    expect(results[0]!.selected_agent).toBe('');
    expect(results[0]!.score).toBe(0);
    // Should not crash
  });

  it('correctly mixes local and remote results for 2 subtasks', async () => {
    const db = setupDb();

    // Local card only matches text generation
    insertCard(db, makeV1Card({
      id: randomUUID(),
      owner: 'local-text-agent',
      name: 'Text Generator',
      description: 'text generation writing',
      metadata: { success_rate: 0.9, tags: ['text_gen'] },
    }));

    // Remote card for hologram (not in local)
    const remoteCard = makeV1Card({
      id: randomUUID(),
      owner: 'remote-holo-agent',
      name: 'Hologram Projector',
      description: 'hologram projection',
      metadata: { success_rate: 0.8, tags: ['hologram'] },
    });

    vi.mocked(fetchRemoteCards).mockResolvedValue([remoteCard]);

    const subtasks: SubTask[] = [
      {
        id: 'st-1',
        description: 'Generate text',
        required_capability: 'text generation',
        params: {},
        depends_on: [],
        estimated_credits: 10,
      },
      {
        id: 'st-2',
        description: 'Project hologram',
        required_capability: 'hologram projection',
        params: {},
        depends_on: ['st-1'],
        estimated_credits: 10,
      },
    ];

    const results = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: 'conductor-agent',
      registryUrl: 'http://registry.example.com',
    });

    expect(results).toHaveLength(2);
    // st-1 matched locally
    expect(results[0]!.selected_agent).toBe('local-text-agent');
    // st-2 matched via remote fallback
    expect(results[1]!.selected_agent).toBe('remote-holo-agent');
  });
});
