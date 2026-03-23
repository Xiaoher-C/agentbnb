/**
 * ConductorMode — ExecutorMode implementation for Conductor skills.
 *
 * Chains TaskDecomposer -> CapabilityMatcher -> BudgetController -> PipelineOrchestrator
 * to execute multi-agent orchestration pipelines via the SkillExecutor dispatch system.
 *
 * Supports two conductor skills:
 * - `orchestrate`: Full pipeline — decompose, match, budget check, execute, return results.
 * - `plan`: Planning only — decompose, match, budget check, return plan without executing.
 */

import type Database from 'better-sqlite3';
import type { SkillConfig } from '../skills/skill-config.js';
import type { ExecutionResult, ExecutorMode, ProgressCallback } from '../skills/executor.js';
import { decompose, validateAndNormalizeSubtasks } from './task-decomposer.js';
import { matchSubTasks } from './capability-matcher.js';
import { BudgetController } from './budget-controller.js';
import { BudgetManager } from '../credit/budget.js';
import { orchestrate } from './pipeline-orchestrator.js';
import { formTeam } from './team-formation.js';
import type { Team } from './role-schema.js';
import type { MatchResult, SubTask } from './types.js';
import { getCardsByCapabilityType } from '../registry/store.js';
import { requestCapability } from '../gateway/client.js';

/**
 * Configuration options for ConductorMode.
 */
export interface ConductorModeOptions {
  /** Registry database for card search (FTS5). */
  db: Database.Database;
  /** Credit database for budget checks. */
  creditDb: Database.Database;
  /** Owner ID of the conductor agent — used for self-exclusion in matching. */
  conductorOwner: string;
  /** Bearer token for authenticating with remote agents. */
  gatewayToken: string;
  /** Resolves an agent owner to their gateway URL and card ID. */
  resolveAgentUrl: (owner: string) => { url: string; cardId: string };
  /** Maximum budget in credits for orchestration runs. Default 100. */
  maxBudget?: number;
}

/**
 * ExecutorMode implementation for Conductor skills ('orchestrate' and 'plan').
 *
 * Dispatches through the full Conductor pipeline:
 * 1. TaskDecomposer breaks the task into SubTasks
 * 2. CapabilityMatcher finds agents for each sub-task
 * 3. BudgetController validates cost against limits
 * 4. PipelineOrchestrator executes the DAG (orchestrate only)
 */
export class ConductorMode implements ExecutorMode {
  private readonly db: Database.Database;
  private readonly creditDb: Database.Database;
  private readonly conductorOwner: string;
  private readonly gatewayToken: string;
  private readonly resolveAgentUrl: (owner: string) => { url: string; cardId: string };
  private readonly maxBudget: number;

  constructor(opts: ConductorModeOptions) {
    this.db = opts.db;
    this.creditDb = opts.creditDb;
    this.conductorOwner = opts.conductorOwner;
    this.gatewayToken = opts.gatewayToken;
    this.resolveAgentUrl = opts.resolveAgentUrl;
    this.maxBudget = opts.maxBudget ?? 100;
  }

  /**
   * Execute a conductor skill with the given config and params.
   *
   * @param config - SkillConfig with type 'conductor' and conductor_skill field.
   * @param params - Must include `task` string.
   * @returns Execution result without latency_ms (added by SkillExecutor).
   */
  async execute(
    config: SkillConfig,
    params: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>> {
    // Extract conductor_skill from config
    const conductorSkill = (config as { conductor_skill?: string }).conductor_skill;

    if (conductorSkill !== 'orchestrate' && conductorSkill !== 'plan') {
      return {
        success: false,
        error: `Unknown conductor skill: "${conductorSkill}"`,
      };
    }

    const task = params.task;
    if (typeof task !== 'string' || task.length === 0) {
      return {
        success: false,
        error: 'Missing or empty "task" parameter',
      };
    }

    // --- Depth limits ---
    const orchestrationDepth =
      typeof params.orchestration_depth === 'number' ? params.orchestration_depth : 0;
    const decompositionDepth =
      typeof params.decomposition_depth === 'number' ? params.decomposition_depth : 0;

    if (orchestrationDepth >= 2) {
      return {
        success: false,
        error: 'orchestration_depth limit exceeded: max 1 nested orchestration',
      };
    }

    // --- Decomposition: network provider first, Rule Engine fallback ---
    let subtasks: SubTask[] = [];

    if (decompositionDepth === 0) {
      // Try to find a network task_decomposition provider
      const allDecomposers = getCardsByCapabilityType(this.db, 'task_decomposition');
      // Self-exclusion: never use ourselves as decomposer
      const externalDecomposers = allDecomposers.filter((c) => c.owner !== this.conductorOwner);

      if (externalDecomposers.length > 0) {
        const provider = externalDecomposers[0]!;
        try {
          const providerUrl = this.resolveAgentUrl(provider.owner);
          const response = await requestCapability({
            gatewayUrl: providerUrl.url,
            token: this.gatewayToken,
            cardId: provider.id,
            params: {
              task,
              decomposition_depth: decompositionDepth + 1,
              orchestration_depth: orchestrationDepth + 1,
            },
            timeoutMs: 30_000,
          });
          // Validate and normalize external decomposition output (Plan 50-02).
          // If validation fails, fall through to Rule Engine.
          if (Array.isArray(response)) {
            const validation = validateAndNormalizeSubtasks(response, {
              available_roles: ['researcher', 'executor', 'validator', 'coordinator'],
              max_credits: this.maxBudget,
            });
            if (validation.errors.length === 0) {
              subtasks = validation.valid;
            }
          }
        } catch {
          // Fall through to Rule Engine
        }
      }
    }

    // Rule Engine fallback (always used when decompositionDepth >= 1, or no provider, or provider failed)
    if (subtasks.length === 0) {
      subtasks = decompose(task);
    }

    // Step 1: Decompose task into subtasks (complete)
    if (subtasks.length === 0) {
      return {
        success: false,
        error: 'No template matches task',
      };
    }
    onProgress?.({ step: 1, total: 5, message: `Decomposed into ${subtasks.length} sub-tasks` });

    // Step 2: Match subtasks to agents
    const matchResults = await matchSubTasks({
      db: this.db,
      subtasks,
      conductorOwner: this.conductorOwner,
    });
    onProgress?.({ step: 2, total: 5, message: `Matched ${matchResults.length} sub-tasks to agents` });

    // Step 2b: Form team when subtasks have role hints (orchestrate skill only)
    let team: Team | undefined;
    if (conductorSkill === 'orchestrate') {
      const hasRoleHints = subtasks.some((s) => s.role !== undefined);
      if (hasRoleHints) {
        const strategy = typeof params.formation_strategy === 'string'
          && ['cost_optimized', 'quality_optimized', 'balanced'].includes(params.formation_strategy)
          ? (params.formation_strategy as 'cost_optimized' | 'quality_optimized' | 'balanced')
          : 'balanced';
        team = await formTeam({
          subtasks,
          strategy,
          db: this.db,
          conductorOwner: this.conductorOwner,
        });
        onProgress?.({ step: 2, total: 5, message: `Formed team: ${team.matched.length} members, ${team.unrouted.length} unrouted` });
      }
    }

    // Step 3: Budget check
    const budgetManager = new BudgetManager(this.creditDb, this.conductorOwner);
    const budgetController = new BudgetController(budgetManager, this.maxBudget);
    const executionBudget = budgetController.calculateBudget(matchResults);

    if (!budgetController.canExecute(executionBudget)) {
      return {
        success: false,
        error: `Budget exceeded: estimated ${executionBudget.estimated_total} cr, max ${this.maxBudget} cr`,
      };
    }
    onProgress?.({ step: 3, total: 5, message: `Budget approved: ${executionBudget.estimated_total} cr` });

    // Step 4: Plan-only mode — return plan without executing
    if (conductorSkill === 'plan') {
      return {
        success: true,
        result: {
          subtasks,
          matches: matchResults,
          budget: executionBudget,
          team,  // undefined when no role hints
        },
      };
    }

    // Step 5: Build matches map and execute
    const matchMap = new Map<string, MatchResult>(
      matchResults.map((m) => [m.subtask_id, m]),
    );

    const orchResult = await orchestrate({
      subtasks,
      matches: matchMap,
      gatewayToken: this.gatewayToken,
      resolveAgentUrl: this.resolveAgentUrl,
      maxBudget: this.maxBudget,
      team,
    });
    onProgress?.({ step: 4, total: 5, message: 'Pipeline execution complete' });

    // Convert Map to plain object for JSON serialization
    const resultObj: Record<string, unknown> = {};
    for (const [key, value] of orchResult.results) {
      resultObj[key] = value;
    }

    return {
      success: orchResult.success,
      result: {
        plan: subtasks,
        execution: resultObj,
        total_credits: orchResult.total_credits,
        latency_ms: orchResult.latency_ms,
        errors: orchResult.errors,
      },
      error: orchResult.success ? undefined : orchResult.errors?.join('; '),
    };
  }
}
