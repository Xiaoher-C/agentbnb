import { spawn, type ChildProcess } from 'child_process';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, CommandSkillConfig } from './skill-config.js';

/** Grace period (ms) between SIGTERM and SIGKILL on timeout. */
const KILL_GRACE_MS = 5000;

/**
 * Shell-escapes a string value to prevent injection.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Resolves a dotted expression (e.g. "params.ticker") from a context object.
 * Returns undefined if any part of the path is missing.
 */
function resolveExpression(expr: string, context: Record<string, unknown>): unknown {
  const parts = expr.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (bracketMatch) {
      current = (current as Record<string, unknown>)[bracketMatch[1]!];
      if (Array.isArray(current)) {
        current = current[parseInt(bracketMatch[2]!, 10)];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

/**
 * Interpolates a command template, shell-escaping all substituted values
 * to prevent shell injection attacks.
 *
 * When a placeholder resolves to undefined/null and is preceded by a CLI flag
 * (e.g. `--depth ${params.depth}`), the entire `--flag <placeholder>` pair is
 * stripped. This prevents absent optional parameters from polluting the
 * argument list — e.g. `--depth --style` where `--style` is misinterpreted
 * as the value of `--depth`.
 */
function safeInterpolateCommand(
  template: string,
  context: Record<string, unknown>,
): string {
  // Match optional preceding --flag (with separating whitespace) followed by ${expr}.
  // Group 1: the `--flag ` prefix (may be absent).
  // Group 2: the expression inside ${...}.
  const result = template.replace(
    /(--[\w-]+\s+)?\$\{([^}]+)\}/g,
    (_match, flagPrefix: string | undefined, expr: string) => {
      const value = resolveExpression(expr, context);
      if (value === undefined || value === null) {
        // Drop both the --flag prefix and the placeholder when value is absent
        return '';
      }
      return (flagPrefix ?? '') + shellEscape(String(value));
    },
  );

  // Collapse any leftover multi-spaces from removed flag+value pairs
  return result.replace(/  +/g, ' ').trim();
}

/**
 * Spawns a child process and collects stdout/stderr with timeout handling.
 * On timeout: sends SIGTERM, waits KILL_GRACE_MS, then SIGKILL.
 * The caller is responsible for adding/removing the child from the process registry.
 */
function spawnWithKill(
  command: string,
  options: { timeout: number; cwd: string; env: NodeJS.ProcessEnv; maxBuffer: number },
  registry: Set<ChildProcess>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // detached: true puts the child in its own process group so we can
    // kill the entire tree (sh + sleep/claude/etc) with -pid.
    const child = spawn('/bin/sh', ['-c', `${command} < /dev/null`], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    registry.add(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    child.stdout!.on('data', (chunk: Buffer) => {
      if (stdout.length < options.maxBuffer) {
        stdout += chunk.toString();
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < options.maxBuffer) {
        stderr += chunk.toString();
      }
    });

    /** Kill the entire process group (sh + children). */
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        // Negative PID kills the entire process group
        process.kill(-child.pid!, signal);
      } catch {
        // Process group already gone — fall back to direct kill
        try { child.kill(signal); } catch { /* already dead */ }
      }
    };

    // Timeout: SIGTERM → wait KILL_GRACE_MS → SIGKILL
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');

      killTimer = setTimeout(() => {
        if (!killed) {
          killGroup('SIGKILL');
        }
      }, KILL_GRACE_MS);
      // Don't let the SIGKILL timer keep the event loop alive
      killTimer.unref();
    }, options.timeout);

    child.on('close', (_code, _signal) => {
      killed = true;
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
      registry.delete(child);

      if (timedOut) {
        const err = new Error(`Command timed out after ${options.timeout}ms`);
        (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        reject(err);
      } else if (_code !== 0) {
        const err = new Error(stderr.trim() || `Process exited with code ${_code}`);
        Object.assign(err, { stderr: stderr.trim() });
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.on('error', (err) => {
      killed = true;
      clearTimeout(timeoutId);
      registry.delete(child);
      reject(err);
    });
  });
}

/**
 * Implements the Command Executor mode (Mode D) for the SkillExecutor.
 *
 * Wraps local shell commands as skills with:
 * - Parameter substitution via `${params.x}` interpolation
 * - Three output types: text (raw stdout), json (parsed), file (path from stdout)
 * - Security allowlist via `allowed_commands` (base command checked against list)
 * - Configurable timeout and working directory
 * - SIGTERM → SIGKILL escalation on timeout (prevents zombie processes)
 * - Process registry for graceful shutdown of all active children
 * - Per-skill concurrency enforcement via capacity.max_concurrent
 */
export class CommandExecutor implements ExecutorMode {
  /** Active child processes — killed on shutdown(). */
  private readonly activeProcesses = new Set<ChildProcess>();

  /** In-flight execution count per skill ID for concurrency limiting. */
  private readonly inflight = new Map<string, number>();

  /**
   * Execute a command skill with the provided parameters.
   *
   * Steps:
   * 1. Concurrency check: reject if at capacity.max_concurrent limit.
   * 2. Security check: base command must be in `allowed_commands` if set.
   * 3. Interpolate `config.command` using `{ params }` context.
   * 4. Run via spawn with SIGTERM→SIGKILL timeout handling.
   * 5. Parse stdout based on `output_type`: text | json | file.
   *
   * @param config - Validated CommandSkillConfig.
   * @param params - Input parameters passed by the caller.
   * @returns Partial ExecutionResult (without latency_ms).
   */
  async execute(
    config: SkillConfig,
    params: Record<string, unknown>,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>> {
    // Narrow to CommandSkillConfig
    const cmdConfig = config as CommandSkillConfig;

    // Step 1: Concurrency check
    const maxConcurrent = cmdConfig.capacity?.max_concurrent;
    if (maxConcurrent !== undefined) {
      const current = this.inflight.get(cmdConfig.id) ?? 0;
      if (current >= maxConcurrent) {
        return {
          success: false,
          error: `Skill "${cmdConfig.id}" at max concurrency (${maxConcurrent}). Try again later.`,
        };
      }
    }

    // Step 2: Security check — validate base command against allowlist
    // When claude_code is present, 'claude' is always implicitly allowed.
    const baseCommand = cmdConfig.command.trim().split(/\s+/)[0] ?? '';
    if (cmdConfig.allowed_commands && cmdConfig.allowed_commands.length > 0) {
      const effectiveAllowed = cmdConfig.claude_code
        ? [...new Set([...cmdConfig.allowed_commands, 'claude'])]
        : cmdConfig.allowed_commands;
      const commandToCheck = cmdConfig.claude_code ? 'claude' : baseCommand;
      if (!effectiveAllowed.includes(commandToCheck)) {
        return {
          success: false,
          error: `Command not allowed: "${commandToCheck}". Allowed: ${effectiveAllowed.join(', ')}`,
        };
      }
    }

    // Step 3: Interpolate command string with shell-escaped params
    // When claude_code config is present, build a `claude --print` command
    // using the command template as the prompt.
    let interpolatedCommand: string;

    if (cmdConfig.claude_code) {
      const parts: string[] = ['claude', '--print'];
      if (cmdConfig.claude_code.auto_mode) {
        parts.push('--dangerously-skip-permissions');
      }
      if (cmdConfig.claude_code.model) {
        parts.push('--model', cmdConfig.claude_code.model);
      }
      if (cmdConfig.claude_code.system_prompt) {
        parts.push('-p', shellEscape(cmdConfig.claude_code.system_prompt));
      }
      // The command template is the prompt — interpolate it with safe escaping
      const interpolatedPrompt = safeInterpolateCommand(cmdConfig.command, { params });
      interpolatedCommand = parts.join(' ') + ' ' + interpolatedPrompt;
    } else {
      interpolatedCommand = safeInterpolateCommand(cmdConfig.command, { params });
    }

    // Step 4: Execute command via spawn with SIGTERM→SIGKILL timeout
    const timeout = cmdConfig.timeout_ms ?? 30000;
    const cwd = cmdConfig.working_dir ?? process.cwd();

    // Unset CLAUDECODE so nested `claude --print` calls don't fail with
    // "Claude Code cannot be launched inside another Claude Code session"
    const env = { ...process.env };
    delete env['CLAUDECODE'];

    // Track inflight count
    this.inflight.set(cmdConfig.id, (this.inflight.get(cmdConfig.id) ?? 0) + 1);

    let stdout: string;

    try {
      const result = await spawnWithKill(interpolatedCommand, {
        timeout,
        cwd,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      }, this.activeProcesses);
      stdout = result.stdout;
    } catch (err) {
      this.decrementInflight(cmdConfig.id);

      if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ETIMEDOUT' || err.message.includes('timed out')) {
          return {
            success: false,
            error: `Command timed out after ${timeout}ms`,
          };
        }
        const stderrContent = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
        return {
          success: false,
          error: stderrContent.trim() || err.message,
        };
      }
      return {
        success: false,
        error: String(err),
      };
    }

    this.decrementInflight(cmdConfig.id);

    // Step 5: Parse output based on output_type
    const rawOutput = stdout.trim();

    switch (cmdConfig.output_type) {
      case 'text':
        return { success: true, result: rawOutput };

      case 'json': {
        try {
          const parsed: unknown = JSON.parse(rawOutput);
          return { success: true, result: parsed };
        } catch {
          return {
            success: false,
            error: `Failed to parse JSON output: ${rawOutput.slice(0, 100)}`,
          };
        }
      }

      case 'file':
        return { success: true, result: { file_path: rawOutput } };

      default:
        return {
          success: false,
          error: `Unknown output_type: ${String(cmdConfig.output_type)}`,
        };
    }
  }

  /**
   * Kill all active child processes. Called during service shutdown
   * to prevent zombie processes.
   */
  shutdown(): void {
    for (const child of this.activeProcesses) {
      // Kill entire process group (sh + children like claude/sleep)
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
      }

      // Escalate to SIGKILL after grace period (unref so it doesn't block exit)
      const pid = child.pid!;
      const timer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Process group already gone
        }
      }, KILL_GRACE_MS);
      timer.unref();
    }
    this.activeProcesses.clear();
  }

  /** Returns the number of currently active child processes. */
  get activeCount(): number {
    return this.activeProcesses.size;
  }

  /** Returns the in-flight count for a specific skill ID. */
  getInflight(skillId: string): number {
    return this.inflight.get(skillId) ?? 0;
  }

  /** Decrement the inflight counter for a skill ID. */
  private decrementInflight(skillId: string): void {
    const current = this.inflight.get(skillId) ?? 0;
    if (current <= 1) {
      this.inflight.delete(skillId);
    } else {
      this.inflight.set(skillId, current - 1);
    }
  }
}
