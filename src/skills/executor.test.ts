import { describe, it, expect, vi } from 'vitest';
import { createSkillExecutor, SkillExecutor, ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig } from './skill-config.js';

/** Create a minimal mock ExecutorMode that returns success */
function makeMockMode(result: unknown = 'mock-result'): ExecutorMode {
  return {
    execute: vi.fn().mockResolvedValue({ success: true, result }),
  };
}

/** Create a failing mock ExecutorMode */
function makeFailingMode(error: string): ExecutorMode {
  return {
    execute: vi.fn().mockRejectedValue(new Error(error)),
  };
}

/** Create a mock ExecutorMode that returns success:false */
function makeErrorResultMode(error: string): ExecutorMode {
  return {
    execute: vi.fn().mockResolvedValue({ success: false, error }),
  };
}

const apiConfig: SkillConfig = {
  id: 'tts-skill',
  type: 'api',
  name: 'TTS Skill',
  endpoint: 'https://api.example.com/tts',
  method: 'POST',
  input_mapping: {},
  output_mapping: {},
  pricing: { credits_per_call: 5 },
  timeout_ms: 30000,
  retries: 0,
};

const commandConfig: SkillConfig = {
  id: 'cmd-skill',
  type: 'command',
  name: 'Shell Skill',
  command: 'echo hello',
  output_type: 'text',
  pricing: { credits_per_call: 1 },
  timeout_ms: 30000,
};

const pipelineConfig: SkillConfig = {
  id: 'pipeline-skill',
  type: 'pipeline',
  name: 'Pipeline Skill',
  steps: [{ skill_id: 'tts-skill', input_mapping: {} }],
  pricing: { credits_per_call: 10 },
};

const openclawConfig: SkillConfig = {
  id: 'oc-skill',
  type: 'openclaw',
  name: 'OpenClaw Skill',
  agent_name: 'my-agent',
  channel: 'telegram',
  pricing: { credits_per_call: 20 },
};

describe('createSkillExecutor', () => {
  it('returns a SkillExecutor instance', () => {
    const apiMode = makeMockMode();
    const modes = new Map<string, ExecutorMode>([['api', apiMode]]);
    const executor = createSkillExecutor([apiConfig], modes);
    expect(executor).toBeInstanceOf(SkillExecutor);
  });
});

describe('SkillExecutor.listSkills', () => {
  it('returns all registered skill IDs', () => {
    const modes = new Map<string, ExecutorMode>([
      ['api', makeMockMode()],
      ['command', makeMockMode()],
    ]);
    const executor = createSkillExecutor([apiConfig, commandConfig], modes);
    const skills = executor.listSkills();
    expect(skills).toContain('tts-skill');
    expect(skills).toContain('cmd-skill');
    expect(skills).toHaveLength(2);
  });

  it('returns empty array when no skills registered', () => {
    const executor = createSkillExecutor([], new Map());
    expect(executor.listSkills()).toEqual([]);
  });
});

describe('SkillExecutor.getSkillConfig', () => {
  it('returns config for known skill', () => {
    const modes = new Map<string, ExecutorMode>([['api', makeMockMode()]]);
    const executor = createSkillExecutor([apiConfig], modes);
    expect(executor.getSkillConfig('tts-skill')).toEqual(apiConfig);
  });

  it('returns undefined for unknown skill', () => {
    const executor = createSkillExecutor([], new Map());
    expect(executor.getSkillConfig('nonexistent')).toBeUndefined();
  });
});

describe('SkillExecutor.execute', () => {
  it('dispatches to correct ExecutorMode by type (api)', async () => {
    const apiMode = makeMockMode('tts-result');
    const modes = new Map<string, ExecutorMode>([['api', apiMode]]);
    const executor = createSkillExecutor([apiConfig], modes);

    const result = await executor.execute('tts-skill', { text: 'hello' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('tts-result');
    expect(apiMode.execute).toHaveBeenCalledWith(apiConfig, { text: 'hello' });
  });

  it('dispatches to correct ExecutorMode by type (command)', async () => {
    const cmdMode = makeMockMode('cmd-output');
    const modes = new Map<string, ExecutorMode>([['command', cmdMode]]);
    const executor = createSkillExecutor([commandConfig], modes);

    const result = await executor.execute('cmd-skill', {});

    expect(result.success).toBe(true);
    expect(result.result).toBe('cmd-output');
    expect(cmdMode.execute).toHaveBeenCalledWith(commandConfig, {});
  });

  it('dispatches to correct ExecutorMode by type (pipeline)', async () => {
    const pipeMode = makeMockMode('pipeline-output');
    const modes = new Map<string, ExecutorMode>([['pipeline', pipeMode]]);
    const executor = createSkillExecutor([pipelineConfig], modes);

    const result = await executor.execute('pipeline-skill', { topic: 'test' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('pipeline-output');
  });

  it('dispatches to correct ExecutorMode by type (openclaw)', async () => {
    const ocMode = makeMockMode('oc-output');
    const modes = new Map<string, ExecutorMode>([['openclaw', ocMode]]);
    const executor = createSkillExecutor([openclawConfig], modes);

    const result = await executor.execute('oc-skill', { input: 'data' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('oc-output');
  });

  it('returns success:false with "Skill not found" for unknown skill ID', async () => {
    const executor = createSkillExecutor([], new Map());
    const result = await executor.execute('nonexistent-skill', {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Skill not found/);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns success:false with "executor not registered" when mode is missing', async () => {
    // Has config but no mode for its type
    const executor = createSkillExecutor([apiConfig], new Map());
    const result = await executor.execute('tts-skill', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('always includes latency_ms > 0 (or >= 0)', async () => {
    const apiMode = makeMockMode();
    const modes = new Map<string, ExecutorMode>([['api', apiMode]]);
    const executor = createSkillExecutor([apiConfig], modes);

    const result = await executor.execute('tts-skill', {});

    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('catches executor errors and returns ExecutionResult with success:false', async () => {
    const failingMode = makeFailingMode('API call failed');
    const modes = new Map<string, ExecutorMode>([['api', failingMode]]);
    const executor = createSkillExecutor([apiConfig], modes);

    const result = await executor.execute('tts-skill', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('API call failed');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('propagates success:false result from mode executor', async () => {
    const errorMode = makeErrorResultMode('validation failed');
    const modes = new Map<string, ExecutorMode>([['api', errorMode]]);
    const executor = createSkillExecutor([apiConfig], modes);

    const result = await executor.execute('tts-skill', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation failed');
  });

  it('handles multiple skills registered with different modes', async () => {
    const apiMode = makeMockMode('api-out');
    const cmdMode = makeMockMode('cmd-out');
    const modes = new Map<string, ExecutorMode>([
      ['api', apiMode],
      ['command', cmdMode],
    ]);
    const executor = createSkillExecutor([apiConfig, commandConfig], modes);

    const apiResult = await executor.execute('tts-skill', {});
    const cmdResult = await executor.execute('cmd-skill', {});

    expect(apiResult.success).toBe(true);
    expect(apiResult.result).toBe('api-out');
    expect(cmdResult.success).toBe(true);
    expect(cmdResult.result).toBe('cmd-out');
  });
});

describe('ExecutionResult shape', () => {
  it('successful result has success, result, and latency_ms', async () => {
    const apiMode = makeMockMode({ data: 'value' });
    const modes = new Map<string, ExecutorMode>([['api', apiMode]]);
    const executor = createSkillExecutor([apiConfig], modes);

    const result = await executor.execute('tts-skill', {});

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('result');
    expect(result).toHaveProperty('latency_ms');
    expect(result.error).toBeUndefined();
  });

  it('error result has success:false, error string, and latency_ms', async () => {
    const executor = createSkillExecutor([], new Map());
    const result = await executor.execute('missing', {});

    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('latency_ms');
  });
});
