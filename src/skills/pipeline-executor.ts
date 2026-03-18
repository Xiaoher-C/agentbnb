import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutorMode, ExecutionResult, ProgressCallback } from './executor.js';
import { SkillExecutor } from './executor.js';
import type { SkillConfig } from './skill-config.js';
import type { PipelineSkillConfig } from './skill-config.js';
import { interpolateObject } from '../utils/interpolation.js';

const execFileAsync = promisify(execFile);

/**
 * Shell-escapes a string value to prevent injection.
 */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Interpolates a command template with shell-escaped substitutions.
 */
function safeInterpolateCommand(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const parts = expr.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current === null || typeof current !== 'object') return '';
      const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (bracketMatch) {
        current = (current as Record<string, unknown>)[bracketMatch[1]!];
        if (Array.isArray(current)) {
          current = current[parseInt(bracketMatch[2]!, 10)];
        } else {
          return '';
        }
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }
    if (current === undefined || current === null) return '';
    return shellEscape(String(current));
  });
}

/**
 * Runtime context accumulated as pipeline steps execute.
 * Each completed step's result is stored in `steps[i]` and `prev`.
 */
interface PipelineContext {
  /** Input params passed to the pipeline invocation. */
  params: Record<string, unknown>;
  /** Results accumulated per step index. */
  steps: Array<{ result: unknown }>;
  /** The most recently completed step's output (shorthand for steps[N-1]). */
  prev: { result: unknown };
}

/**
 * Executor mode for pipeline-type skills (Mode B).
 *
 * Chains multiple skill invocations or shell commands sequentially.
 * Each step can reference previous step outputs via `${prev.result.*}` or
 * `${steps[N].result.*}` in its `input_mapping` values.
 *
 * Usage:
 * ```ts
 * const pipelineExecutor = new PipelineExecutor(skillExecutor);
 * modes.set('pipeline', pipelineExecutor);
 * ```
 */
export class PipelineExecutor implements ExecutorMode {
  /**
   * @param skillExecutor - The parent SkillExecutor used to dispatch sub-skill calls.
   */
  constructor(private readonly skillExecutor: SkillExecutor) {}

  /**
   * Execute a pipeline skill config sequentially.
   *
   * Algorithm:
   * 1. Initialise context: { params, steps: [], prev: { result: null } }
   * 2. For each step:
   *    a. Resolve input_mapping keys against current context via interpolateObject.
   *    b. If step has `skill_id`: dispatch via skillExecutor.execute(). On failure → stop.
   *    c. If step has `command`: interpolate command string, run via exec(). On non-zero exit → stop.
   *    d. Store step result in context.steps[i] and context.prev.
   * 3. Return success with final step result (or null for empty pipeline).
   *
   * @param config - The PipelineSkillConfig for this skill.
   * @param params - Input parameters from the caller.
   * @returns Partial ExecutionResult (without latency_ms — added by SkillExecutor wrapper).
   */
  async execute(
    config: SkillConfig,
    params: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>> {
    const pipelineConfig = config as PipelineSkillConfig;
    const steps = pipelineConfig.steps ?? [];

    if (steps.length === 0) {
      return { success: true, result: null };
    }

    const context: PipelineContext = {
      params,
      steps: [],
      prev: { result: null },
    };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // TypeScript does not narrow `step` inside for-index loops — guard explicitly
      if (step === undefined) {
        return {
          success: false,
          error: `Step ${i} failed: step definition is undefined`,
        };
      }

      // Resolve the input_mapping values using the current context
      const resolvedInputs = interpolateObject(
        step.input_mapping as Record<string, unknown>,
        context as unknown as Record<string, unknown>,
      );

      let stepResult: unknown;

      if ('skill_id' in step && step.skill_id) {
        // Sub-skill dispatch
        const subResult = await this.skillExecutor.execute(
          step.skill_id,
          resolvedInputs as Record<string, unknown>,
        );
        if (!subResult.success) {
          return {
            success: false,
            error: `Step ${i} failed: ${subResult.error ?? 'unknown error'}`,
          };
        }
        stepResult = subResult.result;
      } else if ('command' in step && step.command) {
        // Shell command execution — interpolate with shell escaping to prevent injection
        const interpolatedCommand = safeInterpolateCommand(
          step.command,
          context as unknown as Record<string, unknown>,
        );

        try {
          const { stdout } = await execFileAsync('/bin/sh', ['-c', interpolatedCommand], { timeout: 30000 });
          stepResult = stdout.trim();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `Step ${i} failed: ${message}`,
          };
        }
      } else {
        return {
          success: false,
          error: `Step ${i} failed: step must have either "skill_id" or "command"`,
        };
      }

      // Update context for subsequent steps
      context.steps.push({ result: stepResult });
      context.prev = { result: stepResult };

      // Emit progress between steps (not after the final step)
      if (onProgress && i < steps.length - 1) {
        onProgress({
          step: i + 1,
          total: steps.length,
          message: `Completed step ${i + 1}/${steps.length}`,
        });
      }
    }

    // Return the last step's result as the pipeline output
    // context.steps is guaranteed non-empty since steps.length > 0 was checked above
    const lastStep = context.steps[context.steps.length - 1];
    return {
      success: true,
      result: lastStep !== undefined ? lastStep.result : null,
    };
  }
}
