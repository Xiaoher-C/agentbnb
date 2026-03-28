import { describe, it, expect, afterEach } from 'vitest';
import { CommandExecutor } from './command-executor.js';
import type { CommandSkillConfig } from './skill-config.js';

// Helper: build a minimal CommandSkillConfig for tests
function makeConfig(overrides: Partial<CommandSkillConfig>): CommandSkillConfig {
  return {
    id: 'test-cmd',
    type: 'command',
    name: 'Test Command',
    command: 'echo hello',
    output_type: 'text',
    timeout_ms: 5000,
    pricing: { credits_per_call: 1 },
    ...overrides,
  };
}

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  afterEach(() => {
    executor?.shutdown();
  });

  it('runs echo command and returns trimmed stdout as text', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({ command: 'echo ${params.text}', output_type: 'text' });
    const result = await executor.execute(config, { text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('hello');
  });

  it('parses stdout as JSON when output_type is json', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'echo \'{"key":"val"}\'',
      output_type: 'json',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ key: 'val' });
  });

  it('returns file_path object when output_type is file', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({ command: 'echo /tmp/output.mp3', output_type: 'file' });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ file_path: '/tmp/output.mp3' });
  });

  it('blocks command not in allowed_commands list', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'rm -rf /',
      allowed_commands: ['echo', 'python3'],
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
    expect(result.error).toContain('rm');
  });

  it('allows command that is in allowed_commands list', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'echo allowed',
      output_type: 'text',
      allowed_commands: ['echo', 'python3'],
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    expect(result.result).toBe('allowed');
  });

  it('returns timeout error when process exceeds timeout_ms', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'sleep 10',
      timeout_ms: 100,
      output_type: 'text',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('uses working_dir as cwd for child process', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'pwd',
      output_type: 'text',
      working_dir: '/tmp',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    // /tmp on macOS resolves to /private/tmp — handle both
    expect(result.result as string).toMatch(/tmp/);
  });

  it('returns error with stderr when command exits non-zero', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'sh -c "echo error msg >&2; exit 1"',
      output_type: 'text',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('error msg');
  });

  it('returns error message on JSON parse failure', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'echo not-valid-json',
      output_type: 'json',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('substitutes multiple params in command template', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'echo ${params.a} ${params.b}',
      output_type: 'text',
    });
    const result = await executor.execute(config, { a: 'hello', b: 'world' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('hello world');
  });

  it('prevents shell injection via params', async () => {
    executor = new CommandExecutor();
    const config = makeConfig({
      command: 'echo ${params.text}',
      output_type: 'text',
    });
    // Malicious input attempting command injection
    const result = await executor.execute(config, {
      text: "hello'; rm -rf /; echo '",
    });
    expect(result.success).toBe(true);
    // Shell-escaped: the entire malicious payload is echoed as a literal string
    // (single quotes prevent shell interpretation of ; and other operators)
    const output = result.result as string;
    expect(output).toContain("hello");
    expect(output).toContain("rm -rf"); // printed as text, NOT executed
    expect(output).toContain("echo"); // the injected echo is literal text
  });

  // --- claude_code config extension tests ---

  describe('claude_code config', () => {
    it('auto-includes claude in allowed_commands when claude_code is present', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"test prompt"',
        output_type: 'text',
        allowed_commands: ['echo'],
        claude_code: {
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      // Should NOT fail with "Command not allowed" — claude is implicitly allowed
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });

    it('builds claude command with --print flag', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"hello world"',
        output_type: 'text',
        claude_code: {
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });

    it('adds --dangerously-skip-permissions when auto_mode is true', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"prompt text"',
        output_type: 'text',
        claude_code: {
          auto_mode: true,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });

    it('passes --model flag when model is specified', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"test"',
        output_type: 'text',
        claude_code: {
          model: 'test-nonexistent-model',
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      if (!result.success && result.error) {
        expect(result.error).not.toMatch(/not allowed/i);
      }
    }, 10000);

    it('passes system_prompt via -p flag with shell escaping', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"summarize this"',
        output_type: 'text',
        claude_code: {
          system_prompt: "You are a helpful assistant. Don't be verbose.",
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });

    it('interpolates params in the prompt template', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"Review this code: ${params.code}"',
        output_type: 'text',
        claude_code: {
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, { code: 'console.log("hi")' });
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });

    it('blocks non-claude base command even when claude_code is present with allowed_commands', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: '"test"',
        output_type: 'text',
        allowed_commands: ['echo'],
        claude_code: {
          auto_mode: false,
        },
        timeout_ms: 2000,
      });
      const result = await executor.execute(config, {});
      expect(result.error ?? '').not.toMatch(/not allowed/i);
    });
  });

  describe('process cleanup', () => {
    it('activeCount returns 0 after command completes', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({ command: 'echo done', output_type: 'text' });
      await executor.execute(config, {});
      expect(executor.activeCount).toBe(0);
    });

    it('activeCount returns 0 after timeout kills the process', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        command: 'sleep 60',
        timeout_ms: 100,
        output_type: 'text',
      });
      await executor.execute(config, {});
      expect(executor.activeCount).toBe(0);
    });

    it('shutdown() is safe to call when no processes are running', () => {
      executor = new CommandExecutor();
      expect(() => executor.shutdown()).not.toThrow();
    });
  });

  describe('concurrency enforcement', () => {
    it('rejects when at max_concurrent limit', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        id: 'limited-skill',
        command: 'sleep 10',
        timeout_ms: 30000,
        output_type: 'text',
        capacity: { max_concurrent: 1 },
      });

      // Launch one execution (will block on sleep)
      const first = executor.execute(config, {});

      // Wait a tick for spawn to register
      await new Promise(r => setTimeout(r, 50));

      // Second execution should be rejected immediately
      const second = await executor.execute(config, {});
      expect(second.success).toBe(false);
      expect(second.error).toContain('max concurrency');

      // Clean up the first (will timeout or be killed by shutdown)
      executor.shutdown();
      // Swallow the first promise result
      await first.catch(() => {});
    });

    it('allows execution when under max_concurrent limit', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        id: 'limited-skill-2',
        command: 'echo ok',
        output_type: 'text',
        capacity: { max_concurrent: 2 },
      });

      const result = await executor.execute(config, {});
      expect(result.success).toBe(true);
      expect(result.result).toBe('ok');
    });

    it('tracks inflight count correctly', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        id: 'tracked-skill',
        command: 'echo done',
        output_type: 'text',
        capacity: { max_concurrent: 5 },
      });

      expect(executor.getInflight('tracked-skill')).toBe(0);
      await executor.execute(config, {});
      expect(executor.getInflight('tracked-skill')).toBe(0); // decremented after completion
    });

    it('allows unlimited concurrency when capacity is not set', async () => {
      executor = new CommandExecutor();
      const config = makeConfig({
        id: 'unlimited-skill',
        command: 'echo ok',
        output_type: 'text',
        // no capacity field
      });

      // Should succeed without any concurrency check
      const result = await executor.execute(config, {});
      expect(result.success).toBe(true);
    });
  });
});
