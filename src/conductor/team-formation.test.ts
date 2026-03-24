/**
 * Unit tests for team-formation.ts — formTeam() function (capability-first).
 *
 * matchSubTasks is mocked so these tests run without a real DB or registry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchResult, SubTask } from './types.js';

// Mock matchSubTasks before importing formTeam
vi.mock('./capability-matcher.js', () => ({
  matchSubTasks: vi.fn(),
}));

import { formTeam } from './team-formation.js';
import { matchSubTasks } from './capability-matcher.js';

const mockMatchSubTasks = vi.mocked(matchSubTasks);

/** Create a minimal SubTask for testing */
function makeSubTask(id: string, required_capability = 'text_gen'): SubTask {
  return {
    id,
    description: `Task ${id}`,
    required_capability,
    params: {},
    depends_on: [],
    estimated_credits: 5,
  };
}

/** Create a MatchResult with configurable score and credits */
function makeMatch(
  subtask_id: string,
  agent: string,
  score: number,
  credits: number,
  alternatives: MatchResult['alternatives'] = [],
): MatchResult {
  return {
    subtask_id,
    selected_agent: agent,
    selected_skill: 'default',
    selected_card_id: `card-${agent}`,
    score,
    credits,
    alternatives,
  };
}

/** Stub DB (not used when matchSubTasks is mocked) */
const stubDb = {} as import('better-sqlite3').Database;

describe('formTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty team for empty subtasks array', async () => {
    const team = await formTeam({
      subtasks: [],
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(0);
    expect(team.unrouted).toHaveLength(0);
    expect(team.team_id).toBeTruthy();
    expect(team.strategy).toBe('balanced');
    expect(mockMatchSubTasks).not.toHaveBeenCalled();
  });

  it('all subtasks attempt matching (capability-first — no role filtering)', async () => {
    const subtasks = [makeSubTask('t1'), makeSubTask('t2')];

    mockMatchSubTasks
      .mockResolvedValueOnce([makeMatch('t1', 'agent-a', 0.8, 10)])
      .mockResolvedValueOnce([makeMatch('t2', 'agent-b', 0.7, 8)]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    // Both subtasks should match — no unrouted
    expect(team.matched).toHaveLength(2);
    expect(team.unrouted).toHaveLength(0);
    // matchSubTasks called once per subtask
    expect(mockMatchSubTasks).toHaveBeenCalledTimes(2);
  });

  it('routes 3 subtasks: 2 matched, 1 unrouted when no agent found', async () => {
    const subtasks = [
      makeSubTask('t1', 'text_gen'),
      makeSubTask('t2', 'tts'),
      makeSubTask('t3', 'rare_capability'),
    ];

    mockMatchSubTasks
      .mockResolvedValueOnce([makeMatch('t1', 'agent-a', 0.8, 10)])
      .mockResolvedValueOnce([makeMatch('t2', 'agent-b', 0.7, 8)])
      .mockResolvedValueOnce([{
        subtask_id: 't3',
        selected_agent: '',
        selected_skill: '',
        score: 0,
        credits: 0,
        alternatives: [],
      }]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(2);
    expect(team.unrouted).toHaveLength(1);
    expect(team.unrouted[0]!.id).toBe('t3');
  });

  it('TeamMember.capability_type equals subtask.required_capability', async () => {
    const subtasks = [makeSubTask('t1', 'video_gen')];
    mockMatchSubTasks.mockResolvedValue([makeMatch('t1', 'agent-a', 0.8, 10)]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(1);
    expect(team.matched[0]!.capability_type).toBe('video_gen');
  });

  it('balanced strategy selects first match result (scorePeers composite order)', async () => {
    const subtasks = [makeSubTask('t1')];
    mockMatchSubTasks.mockResolvedValue([
      makeMatch('t1', 'agent-best', 0.9, 20, [
        { agent: 'agent-cheaper', skill: 'default', score: 0.5, credits: 5 },
      ]),
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(1);
    expect(team.matched[0]!.agent).toBe('agent-best');
    expect(team.matched[0]!.score).toBe(0.9);
  });

  it('cost_optimized selects the cheaper candidate over a higher-scored one', async () => {
    const subtasks = [makeSubTask('t1')];
    mockMatchSubTasks.mockResolvedValue([
      makeMatch('t1', 'agent-expensive', 0.9, 50, [
        { agent: 'agent-cheap', skill: 'default', score: 0.6, credits: 10 },
      ]),
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'cost_optimized',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(1);
    expect(team.matched[0]!.agent).toBe('agent-cheap');
    expect(team.matched[0]!.credits).toBe(10);
  });

  it('cost_optimized breaks ties by highest score when credits are equal', async () => {
    const subtasks = [makeSubTask('t1')];
    mockMatchSubTasks.mockResolvedValue([
      makeMatch('t1', 'agent-low-score', 0.4, 10, [
        { agent: 'agent-high-score', skill: 'default', score: 0.8, credits: 10 },
      ]),
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'cost_optimized',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(1);
    expect(team.matched[0]!.agent).toBe('agent-high-score');
  });

  it('quality_optimized selects highest-scored candidate over cheaper one', async () => {
    const subtasks = [makeSubTask('t1')];
    mockMatchSubTasks.mockResolvedValue([
      makeMatch('t1', 'agent-cheap', 0.4, 5, [
        { agent: 'agent-quality', skill: 'default', score: 0.95, credits: 100 },
      ]),
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'quality_optimized',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(1);
    expect(team.matched[0]!.agent).toBe('agent-quality');
    expect(team.matched[0]!.score).toBe(0.95);
  });

  it('places subtask into unrouted when no agent matched (empty selected_agent)', async () => {
    const subtasks = [makeSubTask('t1', 'no_match_capability')];
    mockMatchSubTasks.mockResolvedValue([
      {
        subtask_id: 't1',
        selected_agent: '',
        selected_skill: '',
        score: 0,
        credits: 0,
        alternatives: [],
      },
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(0);
    expect(team.unrouted).toHaveLength(1);
    expect(team.unrouted[0]!.id).toBe('t1');
  });

  it('team_id is a non-empty string (UUID format)', async () => {
    const team = await formTeam({
      subtasks: [],
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.team_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('unrouted[] only contains subtasks with no capability match, matched[] has the rest', async () => {
    const subtasks = [
      makeSubTask('s1', 'text_gen'),
      makeSubTask('s2', 'rare_skill'),
      makeSubTask('s3', 'tts'),
    ];

    mockMatchSubTasks
      .mockResolvedValueOnce([makeMatch('s1', 'agent-a', 0.8, 10)])
      .mockResolvedValueOnce([{ subtask_id: 's2', selected_agent: '', selected_skill: '', score: 0, credits: 0, alternatives: [] }])
      .mockResolvedValueOnce([makeMatch('s3', 'agent-c', 0.7, 5)]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(2);
    expect(team.unrouted).toHaveLength(1);
    expect(team.unrouted[0]!.id).toBe('s2');
    // capability_type matches required_capability for all matched members
    expect(team.matched.find((m) => m.subtask.id === 's1')?.capability_type).toBe('text_gen');
    expect(team.matched.find((m) => m.subtask.id === 's3')?.capability_type).toBe('tts');
  });
});
