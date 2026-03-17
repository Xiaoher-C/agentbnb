import { exec, type ExecOptions } from 'child_process';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, CommandSkillConfig } from './skill-config.js';
import { interpolate } from '../utils/interpolation.js';

/** Promisified exec that returns string buffers. */
function execAsync(
  command: string,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      const stdoutStr = typeof stdout === 'string' ? stdout : stdout.toString();
      const stderrStr = typeof stderr === 'string' ? stderr : stderr.toString();
      if (error) {
        const enriched = Object.assign(error, { stderr: stderrStr });
        reject(enriched);
      } else {
        resolve({ stdout: stdoutStr, stderr: stderrStr });
      }
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
 */
export class CommandExecutor implements ExecutorMode {
  /**
   * Execute a command skill with the provided parameters.
   *
   * Steps:
   * 1. Security check: base command must be in `allowed_commands` if set.
   * 2. Interpolate `config.command` using `{ params }` context.
   * 3. Run via `child_process.exec` with timeout and cwd.
   * 4. Parse stdout based on `output_type`: text | json | file.
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

    // Step 1: Security check — validate base command against allowlist
    const baseCommand = cmdConfig.command.trim().split(/\s+/)[0] ?? '';
    if (cmdConfig.allowed_commands && cmdConfig.allowed_commands.length > 0) {
      if (!cmdConfig.allowed_commands.includes(baseCommand)) {
        return {
          success: false,
          error: `Command not allowed: "${baseCommand}". Allowed: ${cmdConfig.allowed_commands.join(', ')}`,
        };
      }
    }

    // Step 2: Interpolate command string with params
    const interpolatedCommand = interpolate(cmdConfig.command, { params });

    // Step 3: Execute command
    const timeout = cmdConfig.timeout_ms ?? 30000;
    const cwd = cmdConfig.working_dir ?? process.cwd();

    let stdout: string;

    try {
      const result = await execAsync(interpolatedCommand, {
        timeout,
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        shell: '/bin/sh',
      });
      stdout = result.stdout;
    } catch (err) {
      // exec rejects on non-zero exit or timeout
      if (err instanceof Error) {
        // Check for timeout (ETIMEDOUT or 'timed out' message)
        const message = err.message;
        const stderrContent = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
        if (
          message.includes('timed out') ||
          message.includes('ETIMEDOUT') ||
          (err as NodeJS.ErrnoException).code === 'ETIMEDOUT'
        ) {
          return {
            success: false,
            error: `Command timed out after ${timeout}ms`,
          };
        }
        return {
          success: false,
          error: stderrContent.trim() || message,
        };
      }
      return {
        success: false,
        error: String(err),
      };
    }

    // Step 4: Parse output based on output_type
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
}
