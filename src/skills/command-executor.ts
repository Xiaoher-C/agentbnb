import { execFile, type ExecFileOptions } from 'child_process';
import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, CommandSkillConfig } from './skill-config.js';
// interpolate import removed — using safeInterpolateCommand with shell escaping instead

/**
 * Shell-escapes a string value to prevent injection.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Interpolates a command template, shell-escaping all substituted values
 * to prevent shell injection attacks.
 */
function safeInterpolateCommand(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    // Resolve the expression from context
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

/** Promisified execFile that returns string buffers. */
function execFileAsync(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
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

    // Step 2: Interpolate command string with shell-escaped params
    const interpolatedCommand = safeInterpolateCommand(cmdConfig.command, { params });

    // Step 3: Execute command via /bin/sh -c (execFile avoids double shell parsing)
    const timeout = cmdConfig.timeout_ms ?? 30000;
    const cwd = cmdConfig.working_dir ?? process.cwd();

    let stdout: string;

    try {
      const result = await execFileAsync('/bin/sh', ['-c', interpolatedCommand], {
        timeout,
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
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
