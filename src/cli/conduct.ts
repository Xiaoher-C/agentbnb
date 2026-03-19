/**
 * Conduct command — orchestrates complex tasks across the AgentBnB network.
 *
 * Chains TaskDecomposer -> CapabilityMatcher -> BudgetController -> PipelineOrchestrator
 * to decompose a natural-language task, find matching agents, and execute the plan.
 */

import { decompose } from '../conductor/task-decomposer.js';
import { matchSubTasks } from '../conductor/capability-matcher.js';
import { BudgetController, ORCHESTRATION_FEE } from '../conductor/budget-controller.js';
import { orchestrate } from '../conductor/pipeline-orchestrator.js';
import { BudgetManager } from '../credit/budget.js';
import { loadPeers } from './peers.js';
import { loadConfig } from './config.js';
import { openDatabase } from '../registry/store.js';
import { openCreditDb } from '../credit/ledger.js';
import type { MatchResult } from '../conductor/types.js';

/**
 * Options for the conduct action.
 */
export interface ConductOptions {
  planOnly?: boolean;
  maxBudget?: string;
  json?: boolean;
}

/**
 * Result returned by conductAction for structured output.
 */
export interface ConductResult {
  success: boolean;
  error?: string;
  plan?: unknown;
  execution?: Record<string, unknown>;
  total_credits?: number;
  latency_ms?: number;
  errors?: string[];
}

/**
 * Core conduct action — testable without Commander dependency.
 *
 * Decomposes a task, matches subtasks to agents, optionally executes via orchestrator.
 *
 * @param task - Natural language task description.
 * @param opts - Conduct options (planOnly, maxBudget, json).
 * @returns Structured result for JSON output or display.
 */
export async function conductAction(
  task: string,
  opts: ConductOptions,
): Promise<ConductResult> {
  const config = loadConfig();
  if (!config) {
    return { success: false, error: 'Not initialized. Run `agentbnb init` first.' };
  }

  const maxBudget = parseInt(opts.maxBudget ?? '100', 10);

  // Step 1: Decompose task
  const subtasks = decompose(task);
  if (subtasks.length === 0) {
    return { success: false, error: 'No matching template for this task' };
  }

  // Step 2: Match subtasks to agents
  const db = openDatabase(config.db_path);
  let matchResults: MatchResult[];
  try {
    matchResults = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: config.owner,
    });
  } finally {
    db.close();
  }

  // Step 3: Budget calculation
  const creditDb = openCreditDb(config.credit_db_path);
  let budget;
  try {
    const budgetManager = new BudgetManager(creditDb, config.owner);
    const budgetController = new BudgetController(budgetManager, maxBudget);
    budget = budgetController.calculateBudget(matchResults);
  } finally {
    creditDb.close();
  }

  // Build plan display
  const plan = subtasks.map((st, i) => {
    const match = matchResults.find(m => m.subtask_id === st.id);
    return {
      step: i + 1,
      description: st.description,
      capability: st.required_capability,
      agent: match?.selected_agent || '(unmatched)',
      credits: match?.credits ?? st.estimated_credits,
      depends_on: st.depends_on,
    };
  });

  const planOutput = {
    steps: plan,
    orchestration_fee: ORCHESTRATION_FEE,
    estimated_total: budget.estimated_total,
    max_budget: maxBudget,
  };

  // Step 4: Plan-only mode
  if (opts.planOnly) {
    return { success: true, plan: planOutput };
  }

  // Step 5: Execute via orchestrator
  const peers = loadPeers();
  const resolveAgentUrl = (owner: string): { url: string; cardId: string } => {
    const peer = peers.find(p => p.name.toLowerCase() === owner.toLowerCase());
    if (!peer) {
      throw new Error(
        `Unknown peer "${owner}". Add with: agentbnb peers add ${owner} <url> <token>`,
      );
    }
    const execDb = openDatabase(config.db_path);
    try {
      const stmt = execDb.prepare('SELECT id FROM capability_cards WHERE owner = ? LIMIT 1');
      const row = stmt.get(owner) as { id: string } | undefined;
      return { url: peer.url, cardId: row?.id ?? owner };
    } finally {
      execDb.close();
    }
  };

  const matchMap = new Map<string, MatchResult>(
    matchResults.map(m => [m.subtask_id, m]),
  );

  const orchResult = await orchestrate({
    subtasks,
    matches: matchMap,
    gatewayToken: config.token ?? '',
    resolveAgentUrl,
    timeoutMs: 300_000,
    maxBudget,
  });

  // Convert Map to plain object for JSON serialization
  const resultObj: Record<string, unknown> = {};
  for (const [key, value] of orchResult.results) {
    resultObj[key] = value;
  }

  return {
    success: orchResult.success,
    plan: planOutput,
    execution: resultObj,
    total_credits: orchResult.total_credits,
    latency_ms: orchResult.latency_ms,
    errors: orchResult.errors,
  };
}
