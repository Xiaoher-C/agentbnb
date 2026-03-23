import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubTask, MatchResult, ExecutionBudget, OrchestrationResult } from './types.js';
import { SkillConfigSchema } from '../skills/skill-config.js';

// Mock all upstream modules
vi.mock('./task-decomposer.js', () => ({
  decompose: vi.fn(),
}));
vi.mock('./capability-matcher.js', () => ({
  matchSubTasks: vi.fn(),
}));
vi.mock('./pipeline-orchestrator.js', () => ({
  orchestrate: vi.fn(),
}));
vi.mock('../credit/budget.js', () => ({
  BudgetManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('./budget-controller.js', () => {
  const mockCalcBudget = vi.fn();
  const mockCanExecute = vi.fn();
  return {
    BudgetController: vi.fn().mockImplementation(() => ({
      calculateBudget: mockCalcBudget,
      canExecute: mockCanExecute,
    })),
    ORCHESTRATION_FEE: 5,
    __mockCalcBudget: mockCalcBudget,
    __mockCanExecute: mockCanExecute,
  };
});
vi.mock('../registry/store.js', () => ({
  getCardsByCapabilityType: vi.fn(),
}));
vi.mock('../gateway/client.js', () => ({
  requestCapability: vi.fn(),
}));

import { ConductorMode } from './conductor-mode.js';
import { decompose } from './task-decomposer.js';
import { matchSubTasks } from './capability-matcher.js';
import { orchestrate } from './pipeline-orchestrator.js';
import { BudgetController } from './budget-controller.js';
import { getCardsByCapabilityType } from '../registry/store.js';
import { requestCapability } from '../gateway/client.js';

const mockedDecompose = vi.mocked(decompose);
const mockedMatch = vi.mocked(matchSubTasks);
const mockedOrchestrate = vi.mocked(orchestrate);
const mockedGetCardsByCapabilityType = vi.mocked(getCardsByCapabilityType);
const mockedRequestCapability = vi.mocked(requestCapability);

// Access mock methods from the BudgetController mock
function getMockBudgetMethods() {
  const instance = new (BudgetController as unknown as new () => {
    calculateBudget: ReturnType<typeof vi.fn>;
    canExecute: ReturnType<typeof vi.fn>;
  })();
  return { calcBudget: instance.calculateBudget, canExecute: instance.canExecute };
}

/** Helper subtask */
function sub(id: string): SubTask {
  return {
    id,
    description: `do ${id}`,
    required_capability: 'text_gen',
    params: {},
    depends_on: [],
    estimated_credits: 5,
  };
}

/** Helper match result */
function matchRes(subtaskId: string): MatchResult {
  return {
    subtask_id: subtaskId,
    selected_agent: 'alice',
    selected_skill: 'text_gen',
    score: 0.9,
    credits: 5,
    alternatives: [],
  };
}

/** Helper budget */
function budget(total = 10, requires = false): ExecutionBudget {
  return {
    estimated_total: total,
    max_budget: 100,
    orchestration_fee: 5,
    per_task_spending: new Map([['A', 5]]),
    requires_approval: requires,
  };
}

const mockDb = {} as import('better-sqlite3').Database;

function createMode() {
  return new ConductorMode({
    db: mockDb,
    creditDb: mockDb,
    conductorOwner: 'conductor-owner',
    gatewayToken: 'tok',
    resolveAgentUrl: (owner: string) => ({ url: `http://${owner}:7700`, cardId: `card-${owner}` }),
    maxBudget: 100,
  });
}

describe('ConductorMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no capability_type providers found (no network routing)
    mockedGetCardsByCapabilityType.mockReturnValue([]);
  });

  it('Test 1: execute() with orchestrate skill chains decompose->match->budget->orchestrate', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);

    const orchResult: OrchestrationResult = {
      success: true,
      results: new Map([['A', { data: 'hello' }]]),
      total_credits: 10,
      latency_ms: 50,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const config = { id: 'orchestrate', type: 'conductor' as const, name: 'Orchestrate', conductor_skill: 'orchestrate' as const, pricing: { credits_per_call: 5 } };
    const result = await mode.execute(config as any, { task: 'write a blog post' });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    const res = result.result as Record<string, unknown>;
    // Results map should be converted to plain object
    expect(res.execution).toEqual({ A: { data: 'hello' } });
    expect(res.total_credits).toBe(10);
    expect(mockedDecompose).toHaveBeenCalledWith('write a blog post');
    expect(mockedMatch).toHaveBeenCalled();
    expect(mockedOrchestrate).toHaveBeenCalled();
  });

  it('Test 2: execute() with plan skill returns execution plan without executing', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);

    const mode = createMode();
    const config = { id: 'plan', type: 'conductor' as const, name: 'Plan', conductor_skill: 'plan' as const, pricing: { credits_per_call: 1 } };
    const result = await mode.execute(config as any, { task: 'write a blog post' });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    const res = result.result as Record<string, unknown>;
    expect(res.subtasks).toEqual(subtasks);
    expect(res.budget).toEqual(b);
    // orchestrate should NOT have been called
    expect(mockedOrchestrate).not.toHaveBeenCalled();
  });

  it('Test 3: Budget check failure returns error', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget(200, true);

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(false);

    const mode = createMode();
    const config = { id: 'orchestrate', type: 'conductor' as const, name: 'Orchestrate', conductor_skill: 'orchestrate' as const, pricing: { credits_per_call: 5 } };
    const result = await mode.execute(config as any, { task: 'make a video' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Budget exceeded');
    expect(mockedOrchestrate).not.toHaveBeenCalled();
  });

  it('Test 4: Decompose returns empty subtasks returns descriptive error', async () => {
    mockedDecompose.mockReturnValue([]);

    const mode = createMode();
    const config = { id: 'orchestrate', type: 'conductor' as const, name: 'Orchestrate', conductor_skill: 'orchestrate' as const, pricing: { credits_per_call: 5 } };
    const result = await mode.execute(config as any, { task: 'something random xyz' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No template matches task');
  });

  it('Test 5: Unknown skill ID returns error', async () => {
    const mode = createMode();
    const config = { id: 'unknown-skill', type: 'conductor' as const, name: 'Unknown', conductor_skill: 'unknown' as const, pricing: { credits_per_call: 5 } };
    const result = await mode.execute(config as any, { task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('Test 7: emits progress through orchestration stages (orchestrate)', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);

    const orchResult: OrchestrationResult = {
      success: true,
      results: new Map([['A', { data: 'hello' }]]),
      total_credits: 10,
      latency_ms: 50,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const config = { id: 'orchestrate', type: 'conductor' as const, name: 'Orchestrate', conductor_skill: 'orchestrate' as const, pricing: { credits_per_call: 5 } };
    const onProgress = vi.fn();
    const result = await mode.execute(config as any, { task: 'write a blog post' }, onProgress);

    expect(result.success).toBe(true);
    // Should emit at decompose, match, budget, and after orchestration (steps 1-4)
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ step: 1, total: 5 }));
    expect(onProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ step: 2, total: 5 }));
    expect(onProgress).toHaveBeenNthCalledWith(3, expect.objectContaining({ step: 3, total: 5 }));
    expect(onProgress).toHaveBeenNthCalledWith(4, expect.objectContaining({ step: 4, total: 5 }));
  });

  it('Test 8: works without onProgress callback (backward compatibility)', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);

    const orchResult: OrchestrationResult = {
      success: true,
      results: new Map([['A', { data: 'result' }]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const config = { id: 'orchestrate', type: 'conductor' as const, name: 'Orchestrate', conductor_skill: 'orchestrate' as const, pricing: { credits_per_call: 5 } };
    // Should not throw when no callback provided
    const result = await mode.execute(config as any, { task: 'write a blog post' });
    expect(result.success).toBe(true);
  });

  it('Test 9: plan mode emits exactly 3 progress steps', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();

    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);

    const mode = createMode();
    const config = { id: 'plan', type: 'conductor' as const, name: 'Plan', conductor_skill: 'plan' as const, pricing: { credits_per_call: 1 } };
    const onProgress = vi.fn();
    const result = await mode.execute(config as any, { task: 'write a blog post' }, onProgress);

    expect(result.success).toBe(true);
    // plan mode emits decompose, match, budget (3 steps — no execution step 4)
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ step: 1, total: 5 }));
    expect(onProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ step: 2, total: 5 }));
    expect(onProgress).toHaveBeenNthCalledWith(3, expect.objectContaining({ step: 3, total: 5 }));
    expect(mockedOrchestrate).not.toHaveBeenCalled();
  });

  it('Test 6: SkillConfigSchema.parse validates conductor type', () => {
    const config = {
      id: 'orchestrate',
      type: 'conductor',
      name: 'Orchestrate',
      conductor_skill: 'orchestrate',
      pricing: { credits_per_call: 5 },
    };

    const parsed = SkillConfigSchema.parse(config);
    expect(parsed.type).toBe('conductor');
    expect((parsed as any).conductor_skill).toBe('orchestrate');
  });
});

describe('ConductorMode — depth guards and network routing', () => {
  const orchestrateConfig = {
    id: 'orchestrate',
    type: 'conductor' as const,
    name: 'Orchestrate',
    conductor_skill: 'orchestrate' as const,
    pricing: { credits_per_call: 5 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no capability_type providers found
    mockedGetCardsByCapabilityType.mockReturnValue([]);
  });

  it('Depth guard: orchestration_depth >= 2 returns error immediately without decomposing', async () => {
    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, {
      task: 'write a blog post',
      orchestration_depth: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('orchestration_depth limit exceeded');
    expect(mockedDecompose).not.toHaveBeenCalled();
    expect(mockedGetCardsByCapabilityType).not.toHaveBeenCalled();
  });

  it('Depth guard: decomposition_depth >= 1 skips external provider and calls decompose() directly', async () => {
    const subtasks = [sub('A')];
    const matches = [matchRes('A')];
    const b = budget();
    mockedDecompose.mockReturnValue(subtasks);
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);
    const orchResult = {
      success: true,
      results: new Map([['A', {}]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, {
      task: 'write a blog post',
      decomposition_depth: 1,
    });

    // Should succeed and use Rule Engine (decompose called, requestCapability NOT called)
    expect(result.success).toBe(true);
    expect(mockedDecompose).toHaveBeenCalledWith('write a blog post');
    expect(mockedGetCardsByCapabilityType).not.toHaveBeenCalled();
    expect(mockedRequestCapability).not.toHaveBeenCalled();
  });

  it('Network routing: when external decomposer found, calls requestCapability with depth params', async () => {
    const decomposerCard = {
      spec_version: '2.0' as const,
      id: 'ext-card-id',
      owner: 'external-agent',
      agent_name: 'external-decomposer',
      capability_type: 'task_decomposition',
      skills: [],
      availability: { online: true },
    };
    mockedGetCardsByCapabilityType.mockReturnValue([decomposerCard]);

    const externalSubtasks = [sub('ext-A')];
    mockedRequestCapability.mockResolvedValue(externalSubtasks);

    const matches = [matchRes('ext-A')];
    const b = budget();
    mockedMatch.mockReturnValue(matches);
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);
    const orchResult = {
      success: true,
      results: new Map([['ext-A', {}]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, {
      task: 'make a video',
      orchestration_depth: 0,
    });

    expect(result.success).toBe(true);
    expect(mockedRequestCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: 'ext-card-id',
        params: expect.objectContaining({
          task: 'make a video',
          decomposition_depth: 1,
          orchestration_depth: 1,
        }),
      })
    );
    // decompose should NOT have been called (external succeeded)
    expect(mockedDecompose).not.toHaveBeenCalled();
  });

  it('Self-exclusion: conductor-owner card is excluded from decomposer candidates', async () => {
    const selfCard = {
      spec_version: '2.0' as const,
      id: 'self-card-id',
      owner: 'conductor-owner',  // same as conductorOwner in createMode()
      agent_name: 'self-decomposer',
      capability_type: 'task_decomposition',
      skills: [],
      availability: { online: true },
    };
    mockedGetCardsByCapabilityType.mockReturnValue([selfCard]);

    const subtasks = [sub('A')];
    mockedDecompose.mockReturnValue(subtasks);
    const matches = [matchRes('A')];
    mockedMatch.mockReturnValue(matches);
    const b = budget();
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);
    const orchResult = {
      success: true,
      results: new Map([['A', {}]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, { task: 'write a blog post' });

    // Self card excluded → falls back to decompose()
    expect(result.success).toBe(true);
    expect(mockedRequestCapability).not.toHaveBeenCalled();
    expect(mockedDecompose).toHaveBeenCalled();
  });

  it('Fallback: external HTTP call fails, falls through to decompose()', async () => {
    const decomposerCard = {
      spec_version: '2.0' as const,
      id: 'ext-card-id',
      owner: 'external-agent',
      agent_name: 'external-decomposer',
      capability_type: 'task_decomposition',
      skills: [],
      availability: { online: true },
    };
    mockedGetCardsByCapabilityType.mockReturnValue([decomposerCard]);
    mockedRequestCapability.mockRejectedValue(new Error('Network timeout'));

    const subtasks = [sub('A')];
    mockedDecompose.mockReturnValue(subtasks);
    const matches = [matchRes('A')];
    mockedMatch.mockReturnValue(matches);
    const b = budget();
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);
    const orchResult = {
      success: true,
      results: new Map([['A', {}]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, { task: 'write a blog post' });

    expect(result.success).toBe(true);
    expect(mockedDecompose).toHaveBeenCalled();  // fell back to Rule Engine
  });

  it('Fallback: external returns non-array, falls through to decompose()', async () => {
    const decomposerCard = {
      spec_version: '2.0' as const,
      id: 'ext-card-id',
      owner: 'external-agent',
      agent_name: 'external-decomposer',
      capability_type: 'task_decomposition',
      skills: [],
      availability: { online: true },
    };
    mockedGetCardsByCapabilityType.mockReturnValue([decomposerCard]);
    mockedRequestCapability.mockResolvedValue({ error: 'bad response' }); // not an array

    const subtasks = [sub('A')];
    mockedDecompose.mockReturnValue(subtasks);
    const matches = [matchRes('A')];
    mockedMatch.mockReturnValue(matches);
    const b = budget();
    const { calcBudget, canExecute } = getMockBudgetMethods();
    calcBudget.mockReturnValue(b);
    canExecute.mockReturnValue(true);
    const orchResult = {
      success: true,
      results: new Map([['A', {}]]),
      total_credits: 5,
      latency_ms: 10,
    };
    mockedOrchestrate.mockResolvedValue(orchResult);

    const mode = createMode();
    const result = await mode.execute(orchestrateConfig as any, { task: 'write a blog post' });

    expect(result.success).toBe(true);
    expect(mockedDecompose).toHaveBeenCalled();  // fell back to Rule Engine
  });
});
