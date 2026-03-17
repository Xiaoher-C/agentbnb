import { describe, it, expect } from 'vitest';
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
  const executor = new CommandExecutor();

  it('runs echo command and returns trimmed stdout as text', async () => {
    const config = makeConfig({ command: 'echo ${params.text}', output_type: 'text' });
    const result = await executor.execute(config, { text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('hello');
  });

  it('parses stdout as JSON when output_type is json', async () => {
    const config = makeConfig({
      command: 'echo \'{"key":"val"}\'',
      output_type: 'json',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ key: 'val' });
  });

  it('returns file_path object when output_type is file', async () => {
    const config = makeConfig({ command: 'echo /tmp/output.mp3', output_type: 'file' });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ file_path: '/tmp/output.mp3' });
  });

  it('blocks command not in allowed_commands list', async () => {
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
    const config = makeConfig({
      command: 'sleep 10',
      timeout_ms: 100,
      output_type: 'text',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('uses working_dir as cwd for child process', async () => {
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
    const config = makeConfig({
      command: 'sh -c "echo error msg >&2; exit 1"',
      output_type: 'text',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('error msg');
  });

  it('returns error message on JSON parse failure', async () => {
    const config = makeConfig({
      command: 'echo not-valid-json',
      output_type: 'json',
    });
    const result = await executor.execute(config, {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('substitutes multiple params in command template', async () => {
    const config = makeConfig({
      command: 'echo ${params.a} ${params.b}',
      output_type: 'text',
    });
    const result = await executor.execute(config, { a: 'hello', b: 'world' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('hello world');
  });

  it('prevents shell injection via params', async () => {
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
});
