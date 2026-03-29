import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all conductor dependencies
vi.mock('../conductor/task-decomposer.js', () => ({
  decompose: vi.fn(),
}));

vi.mock('../conductor/capability-matcher.js', () => ({
  matchSubTasks: vi.fn(),
}));

vi.mock('../conductor/pipeline-orchestrator.js', () => ({
  orchestrate: vi.fn(),
}));

vi.mock('../conductor/budget-controller.js', () => ({
  ORCHESTRATION_FEE: 5,
  BudgetController: vi.fn().mockImplementation(() => ({
    calculateBudget: vi.fn().mockReturnValue({
      estimated_total: 18,
      max_budget: 100,
      orchestration_fee: 5,
      per_task_spending: new Map(),
      requires_approval: false,
    }),
    canExecute: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock('./peers.js', () => ({
  loadPeers: vi.fn(() => [
    { name: 'agent-alice', url: 'http://alice:7700', token: 'tok-a', added_at: '2026-01-01' },
  ]),
}));

vi.mock('../credit/budget.js', () => ({
  BudgetManager: vi.fn().mockImplementation(() => ({
    canSpend: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock('../registry/store.js', () => ({
  openDatabase: vi.fn(() => ({
    pragma: vi.fn(),
    prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) }),
    close: vi.fn(),
  })),
  listCards: vi.fn(() => []),
}));

vi.mock('../credit/ledger.js', () => ({
  openCreditDb: vi.fn(() => ({
    pragma: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(() => ({
    owner: 'test-owner',
    db_path: ':memory:',
    credit_db_path: ':memory:',
    token: 'test-token',
  })),
  getConfigDir: vi.fn(() => '/tmp/agentbnb-test'),
}));

import { decompose } from '../conductor/task-decomposer.js';
import { matchSubTasks } from '../conductor/capability-matcher.js';
import { orchestrate } from '../conductor/pipeline-orchestrator.js';
import { listCards } from '../registry/store.js';
import { conductAction } from './conduct.js';

const mockDecompose = vi.mocked(decompose);
const mockMatchSubTasks = vi.mocked(matchSubTasks);
const mockOrchestrate = vi.mocked(orchestrate);
const mockListCards = vi.mocked(listCards);

describe('CLI conduct command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCards.mockReturnValue([]);
  });

  it('calls decompose, matchSubTasks, and orchestrate for execution', async () => {
    const subtasks = [
      { id: 'st-1', description: 'Research data', required_capability: 'web_search', params: {}, depends_on: [], estimated_credits: 2 },
      { id: 'st-2', description: 'Analyze data', required_capability: 'text_gen', params: {}, depends_on: ['st-1'], estimated_credits: 3 },
    ];

    mockDecompose.mockReturnValue(subtasks);
    mockMatchSubTasks.mockReturnValue([
      { subtask_id: 'st-1', selected_agent: 'agent-alice', selected_skill: 'web_search', score: 0.9, credits: 2, alternatives: [] },
      { subtask_id: 'st-2', selected_agent: 'agent-alice', selected_skill: 'text_gen', score: 0.8, credits: 3, alternatives: [] },
    ]);
    mockOrchestrate.mockResolvedValue({
      success: true,
      results: new Map([['st-1', { data: 'researched' }], ['st-2', { text: 'analyzed' }]]),
      total_credits: 10,
      latency_ms: 500,
    });

    const output = await conductAction('Analyze AI trends', { maxBudget: '100', json: true });

    expect(mockDecompose).toHaveBeenCalledWith('Analyze AI trends');
    expect(mockMatchSubTasks).toHaveBeenCalled();
    expect(mockOrchestrate).toHaveBeenCalled();
    expect(output.success).toBe(true);
  });

  it('does NOT call orchestrate when --plan-only is set', async () => {
    const subtasks = [
      { id: 'st-1', description: 'Research data', required_capability: 'web_search', params: {}, depends_on: [], estimated_credits: 2 },
    ];

    mockDecompose.mockReturnValue(subtasks);
    mockMatchSubTasks.mockReturnValue([
      { subtask_id: 'st-1', selected_agent: 'agent-alice', selected_skill: 'web_search', score: 0.9, credits: 2, alternatives: [] },
    ]);

    const output = await conductAction('Analyze AI trends', { planOnly: true, maxBudget: '100', json: true });

    expect(mockDecompose).toHaveBeenCalled();
    expect(mockMatchSubTasks).toHaveBeenCalled();
    expect(mockOrchestrate).not.toHaveBeenCalled();
    expect(output.plan).toBeDefined();
  });

  it('returns error when no matching template found', async () => {
    mockDecompose.mockReturnValue([]);

    const output = await conductAction('something unknown', { maxBudget: '100', json: true });

    expect(output.success).toBe(false);
    expect(output.error).toContain('No matching template');
  });

  it('outputs JSON format when --json flag is set', async () => {
    const subtasks = [
      { id: 'st-1', description: 'Research data', required_capability: 'web_search', params: {}, depends_on: [], estimated_credits: 2 },
    ];

    mockDecompose.mockReturnValue(subtasks);
    mockMatchSubTasks.mockReturnValue([
      { subtask_id: 'st-1', selected_agent: 'agent-alice', selected_skill: 'web_search', score: 0.9, credits: 2, alternatives: [] },
    ]);
    mockOrchestrate.mockResolvedValue({
      success: true,
      results: new Map([['st-1', { data: 'researched' }]]),
      total_credits: 7,
      latency_ms: 200,
    });

    const output = await conductAction('Analyze AI trends', { maxBudget: '100', json: true });

    // Output should be a plain object suitable for JSON serialization
    expect(typeof output).toBe('object');
    expect(output.success).toBe(true);
    expect(output.total_credits).toBeDefined();
  });

  it('resolveAgentUrl passed to orchestrate accepts canonical agent_id aliases', async () => {
    const subtasks = [
      { id: 'st-1', description: 'Research data', required_capability: 'web_search', params: {}, depends_on: [], estimated_credits: 2 },
    ];

    mockDecompose.mockReturnValue(subtasks);
    mockMatchSubTasks.mockReturnValue([
      { subtask_id: 'st-1', selected_agent: 'eeeeeeeeeeeeeeee', selected_skill: 'web_search', score: 0.9, credits: 2, alternatives: [] },
    ]);
    mockListCards.mockReturnValue([
      { id: 'card-agent-alice', owner: 'agent-alice', agent_id: 'eeeeeeeeeeeeeeee', availability: { online: true } } as never,
    ]);
    mockOrchestrate.mockResolvedValue({
      success: true,
      results: new Map([['st-1', { data: 'researched' }]]),
      total_credits: 7,
      latency_ms: 200,
    });

    await conductAction('Analyze AI trends', { maxBudget: '100', json: true });

    const orchestrateArgs = mockOrchestrate.mock.calls[0]?.[0];
    expect(orchestrateArgs).toBeDefined();
    expect(orchestrateArgs?.resolveAgentUrl('eeeeeeeeeeeeeeee')).toEqual({
      url: 'http://alice:7700',
      cardId: 'card-agent-alice',
    });
  });
});
