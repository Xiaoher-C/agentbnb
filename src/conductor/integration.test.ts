/**
 * Integration test: 3-agent orchestration with mocked gateway.
 *
 * Tests the full Conductor pipeline: decompose -> match -> budget -> orchestrate
 * using real SQLite databases and real Conductor modules, with only
 * requestCapability mocked to avoid actual HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { decompose } from './task-decomposer.js';
import { matchSubTasks } from './capability-matcher.js';
import { BudgetController, ORCHESTRATION_FEE } from './budget-controller.js';
import { orchestrate } from './pipeline-orchestrator.js';
import { BudgetManager } from '../credit/budget.js';
import { registerConductorCard, CONDUCTOR_OWNER } from './card.js';
import type { MatchResult } from './types.js';

// Mock requestCapability to simulate remote agents
vi.mock('../gateway/client.js', () => ({
  requestCapability: vi.fn(),
}));

import { requestCapability } from '../gateway/client.js';
const mockRequestCapability = vi.mocked(requestCapability);

/**
 * Helper: insert a v2.0 card directly into the registry via SQL.
 */
function insertV2Card(
  db: Database.Database,
  cardId: string,
  owner: string,
  skills: Array<{
    id: string;
    name: string;
    description: string;
    level: number;
    inputs: Array<{ name: string; type: string; description: string }>;
    outputs: Array<{ name: string; type: string; description: string }>;
    pricing: { credits_per_call: number };
  }>,
): void {
  const v2Data = {
    spec_version: '2.0',
    id: cardId,
    owner,
    agent_name: owner,
    skills,
    availability: { online: true },
    metadata: { success_rate: 0.9 },
  };
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(cardId, owner, JSON.stringify(v2Data), now, now);
}

describe('Conductor 3-agent integration', () => {
  let conductorDb: Database.Database;
  let conductorCreditDb: Database.Database;

  const resolveAgentUrl = (owner: string): { url: string; cardId: string } => {
    const mapping: Record<string, { url: string; cardId: string }> = {
      'provider-a': { url: 'http://mock-provider-a:7700', cardId: 'card-a' },
      'provider-b': { url: 'http://mock-provider-b:7700', cardId: 'card-b' },
    };
    const entry = mapping[owner.toLowerCase()];
    if (!entry) throw new Error(`Unknown agent: ${owner}`);
    return entry;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up Conductor's databases
    conductorDb = openDatabase(':memory:');
    conductorCreditDb = openCreditDb(':memory:');
    bootstrapAgent(conductorCreditDb, CONDUCTOR_OWNER, 100);

    // Register Conductor card
    registerConductorCard(conductorDb);

    // Register Provider A: web_search (2 cr), text_gen (3 cr)
    // NOTE: skill names/descriptions must be FTS5-searchable by the template's
    // required_capability strings (e.g., 'web_search', 'text_gen')
    insertV2Card(conductorDb, 'card-a', 'provider-a', [
      {
        id: 'web_search',
        name: 'web_search',
        description: 'web_search web search research data gathering',
        level: 1,
        inputs: [{ name: 'query', type: 'text', description: 'Search query' }],
        outputs: [{ name: 'data', type: 'json', description: 'Search results' }],
        pricing: { credits_per_call: 2 },
      },
      {
        id: 'text_gen',
        name: 'text_gen',
        description: 'text_gen text generation analysis writing',
        level: 1,
        inputs: [{ name: 'prompt', type: 'text', description: 'Input prompt' }],
        outputs: [{ name: 'text', type: 'text', description: 'Generated text' }],
        pricing: { credits_per_call: 3 },
      },
    ]);

    // Register Provider B: text_gen (2 cr)
    insertV2Card(conductorDb, 'card-b', 'provider-b', [
      {
        id: 'text_gen',
        name: 'text_gen',
        description: 'text_gen text generation analysis writing alternative',
        level: 1,
        inputs: [{ name: 'prompt', type: 'text', description: 'Input prompt' }],
        outputs: [{ name: 'text', type: 'text', description: 'Generated text' }],
        pricing: { credits_per_call: 2 },
      },
    ]);

    // Set up mock requestCapability responses
    mockRequestCapability.mockImplementation(async (opts) => {
      const url = opts.gatewayUrl;
      const cardId = opts.cardId;

      if (url === 'http://mock-provider-a:7700') {
        // Provider A: web_search or text_gen
        if (cardId === 'card-a') {
          // Check params to determine which skill
          // For simplicity, return based on call order
          return { data: 'researched data about topic', text: 'analyzed findings from provider A' };
        }
      }
      if (url === 'http://mock-provider-b:7700') {
        return { text: 'alternative analysis from provider B' };
      }
      throw new Error(`Unknown mock agent: ${url}`);
    });
  });

  afterEach(() => {
    try { conductorDb.close(); } catch { /* ignore */ }
    try { conductorCreditDb.close(); } catch { /* ignore */ }
  });

  it('decomposes task, matches to 2 providers, orchestrates, and returns aggregated result', async () => {
    // Step 1: Decompose "Analyze recent AI trends" — matches 'deep-analysis' template (4 steps)
    const subtasks = decompose('Analyze recent AI trends');
    expect(subtasks.length).toBe(4);
    expect(subtasks[0]!.required_capability).toBe('web_search');
    expect(subtasks[1]!.required_capability).toBe('text_gen');

    // Step 2: Match subtasks to providers
    const matchResults = await matchSubTasks({
      db: conductorDb,
      subtasks,
      conductorOwner: CONDUCTOR_OWNER,
    });

    expect(matchResults.length).toBe(4);
    // At least one match should be provider-a (web_search)
    const webSearchMatch = matchResults.find(m => m.subtask_id === subtasks[0]!.id);
    expect(webSearchMatch).toBeDefined();
    expect(webSearchMatch!.selected_agent).toBeTruthy(); // Has a selected agent

    // Step 3: Orchestrate with mocked gateway
    const matchMap = new Map<string, MatchResult>(
      matchResults.map(m => [m.subtask_id, m]),
    );

    const result = await orchestrate({
      subtasks,
      matches: matchMap,
      gatewayToken: 'test-token',
      resolveAgentUrl,
      timeoutMs: 5000,
    });

    // Step 4: Verify results
    expect(result.success).toBe(true);
    expect(result.results.size).toBe(4);
    expect(result.total_credits).toBeGreaterThan(0);
    expect(result.errors).toBeUndefined();
  });

  it('plan-only mode returns execution plan without calling requestCapability', async () => {
    // Decompose
    const subtasks = decompose('Analyze recent AI trends');
    expect(subtasks.length).toBe(4);

    // Match
    const matchResults = await matchSubTasks({
      db: conductorDb,
      subtasks,
      conductorOwner: CONDUCTOR_OWNER,
    });

    // Budget check
    const budgetManager = new BudgetManager(conductorCreditDb, CONDUCTOR_OWNER);
    const budgetController = new BudgetController(budgetManager, 100);
    const budget = budgetController.calculateBudget(matchResults);

    // Verify plan structure
    expect(budget.estimated_total).toBeGreaterThan(0);
    expect(budget.orchestration_fee).toBe(ORCHESTRATION_FEE);
    expect(budget.per_task_spending.size).toBe(4);

    // Verify requestCapability was NOT called
    expect(mockRequestCapability).not.toHaveBeenCalled();
  });

  it('retries with alternative provider on primary failure', async () => {
    // Decompose a simple task to get a text_gen subtask
    const subtasks = decompose('Analyze AI trends');
    expect(subtasks.length).toBe(4);

    // Match — both provider-a and provider-b have text_gen
    const matchResults = await matchSubTasks({
      db: conductorDb,
      subtasks,
      conductorOwner: CONDUCTOR_OWNER,
    });

    // Find a text_gen match and manually set up alternatives for the test
    const textGenMatches = matchResults.filter(m => {
      const st = subtasks.find(s => s.id === m.subtask_id);
      return st?.required_capability === 'text_gen';
    });

    // For the first text_gen subtask, ensure alternatives exist
    // (matching may have already populated alternatives since both providers have text_gen)
    expect(textGenMatches.length).toBeGreaterThan(0);

    // Set up mock: first call to provider-a's text_gen fails, but provider-b succeeds
    let callCount = 0;
    mockRequestCapability.mockImplementation(async (opts) => {
      callCount++;
      const url = opts.gatewayUrl;

      // First few calls succeed (web_search step)
      if (url === 'http://mock-provider-a:7700') {
        // Fail on text_gen attempts from provider-a (after the first web_search call)
        if (callCount > 1) {
          throw new Error('Provider A text_gen temporarily unavailable');
        }
        return { data: 'researched data about AI trends' };
      }
      if (url === 'http://mock-provider-b:7700') {
        return { text: 'analysis from provider B (fallback)' };
      }
      throw new Error(`Unknown mock agent: ${url}`);
    });

    const matchMap = new Map<string, MatchResult>(
      matchResults.map(m => [m.subtask_id, m]),
    );

    // Manually ensure alternatives are populated for text_gen steps
    // so the orchestrator can retry with provider-b
    for (const m of matchResults) {
      const st = subtasks.find(s => s.id === m.subtask_id);
      if (st?.required_capability === 'text_gen' && m.alternatives.length === 0) {
        m.alternatives.push({
          agent: 'provider-b',
          skill: 'text_gen',
          score: 0.7,
          credits: 2,
        });
      }
    }

    const result = await orchestrate({
      subtasks,
      matches: matchMap,
      gatewayToken: 'test-token',
      resolveAgentUrl,
      timeoutMs: 5000,
    });

    // Some tasks should have succeeded via alternatives
    expect(result.results.size).toBeGreaterThan(0);
    // requestCapability should have been called more than once (retries happened)
    expect(mockRequestCapability.mock.calls.length).toBeGreaterThan(1);
  });
});
