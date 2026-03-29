import type { SkillConfig } from './skill-config.js';

/**
 * Builds a timeout error message for a skill execution.
 */
function buildTimeoutError(skillId: string, timeoutMs: number): string {
  return `Skill "${skillId}" timed out after ${timeoutMs}ms`;
}

/**
 * Progress callback for long-running skill executions.
 * Called between steps/sub-tasks to indicate forward progress.
 */
export type ProgressCallback = (info: { step: number; total: number; message: string }) => void;

/**
 * Result returned by SkillExecutor.execute() for every invocation.
 * Always includes timing data regardless of success or failure.
 */
export interface ExecutionResult {
  /** Whether the skill executed successfully. */
  success: boolean;
  /** The output produced by the skill on success. */
  result?: unknown;
  /** Error message if success is false. */
  error?: string;
  /** Wall-clock execution time in milliseconds. */
  latency_ms: number;
  /** Structured failure reason (e.g. 'overload' when at max_concurrent capacity). */
  failure_reason?: string;
}

/**
 * Tracks in-flight concurrent executions per skill ID.
 * Used by SkillExecutor to enforce `capacity.max_concurrent` limits.
 *
 * Thread-safe within a single Node.js event loop (no true parallelism).
 * acquire/release must always be paired (use try/finally).
 */
export class ConcurrencyGuard {
  private active: Map<string, number> = new Map();

  /**
   * Check whether the skill can accept another concurrent execution.
   *
   * @param skillId - The skill ID to check.
   * @param maxConcurrent - The maximum allowed concurrent executions.
   * @returns true if current load is below the limit.
   */
  canAccept(skillId: string, maxConcurrent: number): boolean {
    return (this.active.get(skillId) ?? 0) < maxConcurrent;
  }

  /**
   * Increment the in-flight counter for a skill. Call before execution starts.
   *
   * @param skillId - The skill ID to acquire a slot for.
   */
  acquire(skillId: string): void {
    this.active.set(skillId, (this.active.get(skillId) ?? 0) + 1);
  }

  /**
   * Decrement the in-flight counter for a skill. Call after execution completes (in finally block).
   *
   * @param skillId - The skill ID to release a slot for.
   */
  release(skillId: string): void {
    this.active.set(skillId, Math.max(0, (this.active.get(skillId) ?? 0) - 1));
  }

  /**
   * Returns the current number of in-flight executions for a skill.
   *
   * @param skillId - The skill ID to check.
   * @returns Current in-flight count (0 if no executions tracked).
   */
  getCurrentLoad(skillId: string): number {
    return this.active.get(skillId) ?? 0;
  }
}

/**
 * Interface that all executor mode implementations must satisfy.
 * Each mode handles one skill type: 'api' | 'pipeline' | 'openclaw' | 'command'.
 */
export interface ExecutorMode {
  /**
   * Execute a skill with the given config and input parameters.
   *
   * @param config - The validated SkillConfig for this skill.
   * @param params - The input parameters passed by the caller.
   * @returns A partial ExecutionResult without latency_ms (added by SkillExecutor).
   */
  execute(
    config: SkillConfig,
    params: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>>;
}

/**
 * Central dispatcher that routes skill execution requests to the appropriate
 * executor mode based on the skill's `type` field.
 *
 * Usage:
 * ```ts
 * const executor = createSkillExecutor(configs, modes);
 * const result = await executor.execute('tts-skill', { text: 'hello' });
 * ```
 */
export class SkillExecutor {
  private readonly skillMap: Map<string, SkillConfig>;
  private readonly modeMap: Map<string, ExecutorMode>;
  private readonly concurrencyGuard?: ConcurrencyGuard;

  /**
   * @param configs - Parsed SkillConfig array (from parseSkillsFile).
   * @param modes - Map from skill type string to its executor implementation.
   * @param concurrencyGuard - Optional ConcurrencyGuard to enforce max_concurrent limits.
   */
  constructor(configs: SkillConfig[], modes: Map<string, ExecutorMode>, concurrencyGuard?: ConcurrencyGuard) {
    this.skillMap = new Map(configs.map((c) => [c.id, c]));
    this.modeMap = modes;
    this.concurrencyGuard = concurrencyGuard;
  }

  /**
   * Execute a skill by ID with the given input parameters.
   *
   * Dispatch order:
   * 1. Look up skill config by skillId.
   * 2. Find executor mode by config.type.
   * 3. Invoke mode.execute(), wrap with latency timing.
   * 4. Catch any thrown errors and return as ExecutionResult with success:false.
   *
   * @param skillId - The ID of the skill to execute.
   * @param params - Input parameters for the skill.
   * @returns ExecutionResult including success, result/error, and latency_ms.
   */
  async execute(
    skillId: string,
    params: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    const config = this.skillMap.get(skillId);
    if (!config) {
      return {
        success: false,
        error: `Skill not found: "${skillId}"`,
        latency_ms: Date.now() - startTime,
      };
    }

    const mode = this.modeMap.get(config.type);
    if (!mode) {
      return {
        success: false,
        error: `No executor registered for skill type "${config.type}" (skill: "${skillId}")`,
        latency_ms: Date.now() - startTime,
      };
    }

    // Concurrency guard: reject if at capacity
    const maxConcurrent = config.capacity?.max_concurrent ?? Infinity;
    if (this.concurrencyGuard && maxConcurrent !== Infinity) {
      if (!this.concurrencyGuard.canAccept(skillId, maxConcurrent)) {
        return {
          success: false,
          error: `Skill ${skillId} at capacity (${maxConcurrent} concurrent max)`,
          latency_ms: Date.now() - startTime,
          failure_reason: 'overload',
        };
      }
      this.concurrencyGuard.acquire(skillId);
    }

    try {
      const configuredTimeoutMs = typeof config.timeout_ms === 'number' ? config.timeout_ms : undefined;

      const modeExecution = mode.execute(config, params, onProgress);
      const modeResult = configuredTimeoutMs === undefined
        ? await modeExecution
        : await new Promise<Omit<ExecutionResult, 'latency_ms'>>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(buildTimeoutError(skillId, configuredTimeoutMs)));
          }, configuredTimeoutMs);

          modeExecution
            .then((value) => {
              clearTimeout(timeout);
              resolve(value);
            })
            .catch((err: unknown) => {
              clearTimeout(timeout);
              reject(err);
            });
        });

      return {
        ...modeResult,
        latency_ms: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        latency_ms: Date.now() - startTime,
      };
    } finally {
      if (this.concurrencyGuard && maxConcurrent !== Infinity) {
        this.concurrencyGuard.release(skillId);
      }
    }
  }

  /**
   * Returns the IDs of all registered skills.
   *
   * @returns Array of skill ID strings.
   */
  listSkills(): string[] {
    return Array.from(this.skillMap.keys());
  }

  /**
   * Returns the SkillConfig for a given skill ID, or undefined if not found.
   *
   * @param skillId - The skill ID to look up.
   * @returns The SkillConfig or undefined.
   */
  getSkillConfig(skillId: string): SkillConfig | undefined {
    return this.skillMap.get(skillId);
  }
}

/**
 * Factory function to create a SkillExecutor with the given configs and mode implementations.
 *
 * @param configs - Array of parsed SkillConfig objects.
 * @param modes - Map from type key to ExecutorMode implementation.
 * @param concurrencyGuard - Optional ConcurrencyGuard to enforce max_concurrent limits.
 * @returns A configured SkillExecutor instance.
 */
export function createSkillExecutor(
  configs: SkillConfig[],
  modes: Map<string, ExecutorMode>,
  concurrencyGuard?: ConcurrencyGuard,
): SkillExecutor {
  return new SkillExecutor(configs, modes, concurrencyGuard);
}
