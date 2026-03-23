/**
 * Unit tests for team-formation.ts — formTeam() function.
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
function makeSubTask(id: string, role?: 'researcher' | 'executor' | 'validator' | 'coordinator'): SubTask {
  return {
    id,
    description: `Task ${id}`,
    required_capability: 'text_gen',
    params: {},
    depends_on: [],
    estimated_credits: 5,
    role,
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

  it('places all role-less subtasks into unrouted without calling matchSubTasks', async () => {
    const subtasks = [makeSubTask('t1'), makeSubTask('t2')];

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(0);
    expect(team.unrouted).toHaveLength(2);
    expect(mockMatchSubTasks).not.toHaveBeenCalled();
  });

  it('routes 2 role-hinted subtasks to matched and 1 role-less to unrouted', async () => {
    const subtasks = [
      makeSubTask('t1', 'researcher'),
      makeSubTask('t2', 'executor'),
      makeSubTask('t3'), // no role
    ];

    mockMatchSubTasks.mockResolvedValue([
      makeMatch('t1', 'agent-a', 0.8, 10),
      makeMatch('t2', 'agent-b', 0.7, 8),
    ]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched).toHaveLength(2);
    expect(team.unrouted).toHaveLength(1);
    expect(team.unrouted[0]!.id).toBe('t3');
    expect(mockMatchSubTasks).toHaveBeenCalledOnce();
  });

  it('balanced strategy selects first match result (scorePeers composite order)', async () => {
    const subtasks = [makeSubTask('t1', 'executor')];
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
    const subtasks = [makeSubTask('t1', 'executor')];
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
    const subtasks = [makeSubTask('t1', 'executor')];
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
    const subtasks = [makeSubTask('t1', 'researcher')];
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

  it('places role-hinted subtask into unrouted when no agent matched (empty selected_agent)', async () => {
    const subtasks = [makeSubTask('t1', 'validator')];
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

  it('includes correct role on matched TeamMember', async () => {
    const subtasks = [makeSubTask('t1', 'coordinator')];
    mockMatchSubTasks.mockResolvedValue([makeMatch('t1', 'agent-a', 0.8, 10)]);

    const team = await formTeam({
      subtasks,
      strategy: 'balanced',
      db: stubDb,
      conductorOwner: 'self',
    });

    expect(team.matched[0]!.role).toBe('coordinator');
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
});
