/**
 * PipelineOrchestrator — DAG-based remote execution engine for the Conductor.
 *
 * Executes sub-tasks across remote agents via the Gateway client,
 * respecting dependency ordering (parallel waves for independent tasks),
 * output piping between steps, and retry with alternative agents on failure.
 *
 * Budget checking is NOT done here — the caller (ConductorMode) handles that.
 * This module is pure execution.
 */

import { requestCapability } from '../gateway/client.js';
import { interpolateObject } from '../utils/interpolation.js';
import type { RelayClient } from '../relay/websocket-client.js';
import type { SubTask, MatchResult, OrchestrationResult } from './types.js';
import type { Team, TeamMember } from './role-schema.js';

/**
 * Options for the orchestrate() function.
 */
export interface OrchestrateOptions {
  /** Ordered list of sub-tasks forming a dependency DAG. */
  subtasks: SubTask[];
  /** Match results keyed by subtask ID. */
  matches: Map<string, MatchResult>;
  /** Bearer token for authenticating with remote agents. */
  gatewayToken: string;
  /** Resolves an agent owner to their gateway URL and card ID. */
  resolveAgentUrl: (agentOwner: string) => { url: string; cardId: string };
  /** Per-task timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Maximum budget in credits. If set, aborts remaining tasks when exceeded. */
  maxBudget?: number;
  /** Optional relay client for executing tasks on remote agents (relay:// URLs). */
  relayClient?: RelayClient;
  /** Owner identifier of the requester agent. Used for relay requests. */
  requesterOwner?: string;
  /**
   * Optional pre-formed team from formTeam(). When provided, agent assignments
   * for matched team members override the MatchResult selected_agent.
   * Same-role subtasks in the same wave are routed to the same agent.
   */
  team?: Team;
}

/**
 * Computes execution waves from a DAG of subtasks.
 *
 * Each wave contains subtask IDs whose dependencies are all in earlier waves.
 * Tasks within the same wave can execute in parallel.
 *
 * @param subtasks - The full list of subtasks.
 * @returns Array of waves, each wave is an array of subtask IDs.
 */
function computeWaves(subtasks: SubTask[]): string[][] {
  const waves: string[][] = [];
  const completed = new Set<string>();
  const remaining = new Map(subtasks.map((s) => [s.id, s]));

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const [id, task] of remaining) {
      const depsResolved = task.depends_on.every((dep) => completed.has(dep));
      if (depsResolved) {
        wave.push(id);
      }
    }

    // Guard against cycles — if no tasks can be scheduled, break
    if (wave.length === 0) {
      break;
    }

    for (const id of wave) {
      remaining.delete(id);
      completed.add(id);
    }
    waves.push(wave);
  }

  return waves;
}

/**
 * Executes a DAG of sub-tasks across remote agents via Gateway.
 *
 * Execution flow:
 * 1. Computes execution waves from dependency graph
 * 2. For each wave, executes all tasks in parallel via Promise.allSettled
 * 3. Before each task, interpolates params against completed step outputs
 * 4. On failure, retries with the first alternative agent from MatchResult
 * 5. Tracks per-task spending and total credits
 * 6. Optionally enforces a maxBudget ceiling
 *
 * @param opts - Orchestration options.
 * @returns Aggregated orchestration result.
 */
export async function orchestrate(opts: OrchestrateOptions): Promise<OrchestrationResult> {
  const { subtasks, matches, gatewayToken, resolveAgentUrl, timeoutMs = 300_000, maxBudget, relayClient, requesterOwner } = opts;
  const startTime = Date.now();

  // Build role-aware agent override map from team (if provided)
  // Key: subtask_id → TeamMember (for agent override)
  const teamMemberMap = new Map<string, TeamMember>();
  if (opts.team) {
    for (const member of opts.team.matched) {
      teamMemberMap.set(member.subtask.id, member);
    }
  }

  // Edge case: empty subtask list
  if (subtasks.length === 0) {
    return {
      success: true,
      results: new Map(),
      total_credits: 0,
      latency_ms: Date.now() - startTime,
    };
  }

  const results = new Map<string, unknown>();
  const errors: string[] = [];
  let totalCredits = 0;
  const traceContext = new Map<string, { team_id: string | null; role: string | null }>();

  const waves = computeWaves(subtasks);
  const subtaskMap = new Map(subtasks.map((s) => [s.id, s]));

  for (const wave of waves) {
    // Budget check before wave: if maxBudget set and already exceeded, abort
    if (maxBudget !== undefined && totalCredits >= maxBudget) {
      errors.push(`Budget exceeded: spent ${totalCredits} cr, max ${maxBudget} cr`);
      break;
    }

    // Check each task in this wave against remaining budget
    const executableIds: string[] = [];
    for (const taskId of wave) {
      const m = matches.get(taskId);
      if (maxBudget !== undefined && m && totalCredits + m.credits > maxBudget) {
        errors.push(`Skipping task ${taskId}: would exceed budget (${totalCredits} + ${m.credits} > ${maxBudget})`);
        continue;
      }
      executableIds.push(taskId);
    }

    // Execute all tasks in this wave in parallel
    const waveResults = await Promise.allSettled(
      executableIds.map(async (taskId) => {
        const subtask = subtaskMap.get(taskId)!;
        const m = matches.get(taskId);
        if (!m) {
          throw new Error(`No match found for subtask ${taskId}`);
        }

        // Build interpolation context from completed step outputs
        const stepsContext: Record<string, unknown> = {};
        for (const [id, val] of results) {
          stepsContext[id] = val;
        }
        const interpContext = { steps: stepsContext, prev: undefined as unknown };
        // Set prev to the result of the last dependency (if any)
        if (subtask.depends_on.length > 0) {
          const lastDep = subtask.depends_on[subtask.depends_on.length - 1]!;
          interpContext.prev = results.get(lastDep);
        }

        // Interpolate params
        const interpolatedParams = interpolateObject(
          subtask.params,
          interpContext as unknown as Record<string, unknown>,
        );

        // Capture team traceability context for the caller's log entry
        const teamMember = teamMemberMap.get(taskId);
        const teamId = opts.team?.team_id ?? null;
        const taskRole = teamMember?.role ?? null;

        // Try primary agent
        // Use team member agent assignment if available (role-aware routing)
        const agentOwner = teamMember?.agent ?? m.selected_agent;
        const primary = resolveAgentUrl(agentOwner);
        try {
          let res: unknown;
          if (primary.url.startsWith('relay://') && relayClient) {
            const targetOwner = primary.url.replace('relay://', '');
            res = await relayClient.request({
              targetOwner,
              cardId: primary.cardId,
              params: interpolatedParams,
              requester: requesterOwner,
              timeoutMs,
            });
          } else {
            res = await requestCapability({
              gatewayUrl: primary.url,
              token: gatewayToken,
              cardId: primary.cardId,
              params: { ...interpolatedParams, requester: requesterOwner },
              timeoutMs,
            });
          }
          return { taskId, result: res, credits: m.credits, team_id: teamId, role: taskRole };
        } catch (primaryErr) {
          // Retry with first alternative if available
          if (m.alternatives.length > 0) {
            const alt = m.alternatives[0]!;
            const altAgent = resolveAgentUrl(alt.agent);
            try {
              let altRes: unknown;
              if (altAgent.url.startsWith('relay://') && relayClient) {
                const targetOwner = altAgent.url.replace('relay://', '');
                altRes = await relayClient.request({
                  targetOwner,
                  cardId: altAgent.cardId,
                  params: interpolatedParams,
                  requester: requesterOwner,
                  timeoutMs,
                });
              } else {
                altRes = await requestCapability({
                  gatewayUrl: altAgent.url,
                  token: gatewayToken,
                  cardId: altAgent.cardId,
                  params: { ...interpolatedParams, requester: requesterOwner },
                  timeoutMs,
                });
              }
              return { taskId, result: altRes, credits: alt.credits, team_id: teamId, role: taskRole };
            } catch (altErr) {
              throw new Error(
                `Task ${taskId}: primary (${m.selected_agent}) failed: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}; ` +
                `alternative (${alt.agent}) failed: ${altErr instanceof Error ? altErr.message : String(altErr)}`,
              );
            }
          }
          throw new Error(
            `Task ${taskId}: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`,
          );
        }
      }),
    );

    // Collect results
    for (const settlement of waveResults) {
      if (settlement.status === 'fulfilled') {
        const { taskId, result, credits, team_id, role } = settlement.value;
        results.set(taskId, result);
        totalCredits += credits;
        traceContext.set(taskId, { team_id: team_id ?? null, role: role ?? null });
      } else {
        errors.push(settlement.reason instanceof Error ? settlement.reason.message : String(settlement.reason));
      }
    }
  }

  return {
    success: errors.length === 0,
    results,
    total_credits: totalCredits,
    latency_ms: Date.now() - startTime,
    errors: errors.length > 0 ? errors : undefined,
    trace: traceContext.size > 0 ? traceContext : undefined,
  };
}
