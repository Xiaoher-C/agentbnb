import { describe, it, expect, vi } from 'vitest';
import { createSkillExecutor, SkillExecutor, ExecutorMode, ExecutionResult, ConcurrencyGuard } from './executor.js';
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
    expect(apiMode.execute).toHaveBeenCalledWith(apiConfig, { text: 'hello' }, undefined);
  });

  it('dispatches to correct ExecutorMode by type (command)', async () => {
    const cmdMode = makeMockMode('cmd-output');
    const modes = new Map<string, ExecutorMode>([['command', cmdMode]]);
    const executor = createSkillExecutor([commandConfig], modes);

    const result = await executor.execute('cmd-skill', {});

    expect(result.success).toBe(true);
    expect(result.result).toBe('cmd-output');
    expect(cmdMode.execute).toHaveBeenCalledWith(commandConfig, {}, undefined);
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

  it('enforces timeout_ms for all skill types via SkillExecutor wrapper', async () => {
    const slowPipelineMode: ExecutorMode = {
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ success: true, result: 'late' }), 100)),
    };
    const timedPipelineConfig: SkillConfig = {
      ...pipelineConfig,
      id: 'pipeline-timeout',
      timeout_ms: 10,
    };
    const modes = new Map<string, ExecutorMode>([['pipeline', slowPipelineMode]]);
    const executor = createSkillExecutor([timedPipelineConfig], modes);

    const result = await executor.execute('pipeline-timeout', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
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

describe('ConcurrencyGuard', () => {
  it('getCurrentLoad returns 0 for unknown skill', () => {
    const guard = new ConcurrencyGuard();
    expect(guard.getCurrentLoad('unknown')).toBe(0);
  });

  it('acquire increments and release decrements load', () => {
    const guard = new ConcurrencyGuard();
    guard.acquire('s1');
    expect(guard.getCurrentLoad('s1')).toBe(1);
    guard.acquire('s1');
    expect(guard.getCurrentLoad('s1')).toBe(2);
    guard.release('s1');
    expect(guard.getCurrentLoad('s1')).toBe(1);
    guard.release('s1');
    expect(guard.getCurrentLoad('s1')).toBe(0);
  });

  it('release never goes below 0', () => {
    const guard = new ConcurrencyGuard();
    guard.release('s1');
    expect(guard.getCurrentLoad('s1')).toBe(0);
  });

  it('canAccept returns false when at max', () => {
    const guard = new ConcurrencyGuard();
    guard.acquire('s1');
    expect(guard.canAccept('s1', 1)).toBe(false);
    expect(guard.canAccept('s1', 2)).toBe(true);
  });

  it('rejects with failure_reason overload when at max_concurrent', async () => {
    const guard = new ConcurrencyGuard();
    // A slow mode that takes 100ms
    const slowMode: ExecutorMode = {
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ success: true, result: 'done' }), 100)),
    };
    const skillWithCapacity: SkillConfig = {
      ...commandConfig,
      id: 'limited-skill',
      capacity: { max_concurrent: 1 },
    };
    const modes = new Map<string, ExecutorMode>([['command', slowMode]]);
    const executor = createSkillExecutor([skillWithCapacity], modes, guard);

    // Start first execution (will hold the slot for 100ms)
    const first = executor.execute('limited-skill', {});

    // Immediately try second — should be rejected
    const second = await executor.execute('limited-skill', {});

    expect(second.success).toBe(false);
    expect(second.failure_reason).toBe('overload');
    expect(second.error).toMatch(/at capacity/);

    // First should still succeed
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
  });

  it('accepts next request after slot frees up', async () => {
    const guard = new ConcurrencyGuard();
    const fastMode: ExecutorMode = {
      execute: vi.fn().mockResolvedValue({ success: true, result: 'ok' }),
    };
    const skillWithCapacity: SkillConfig = {
      ...commandConfig,
      id: 'limited-skill-2',
      capacity: { max_concurrent: 1 },
    };
    const modes = new Map<string, ExecutorMode>([['command', fastMode]]);
    const executor = createSkillExecutor([skillWithCapacity], modes, guard);

    // First completes immediately
    const first = await executor.execute('limited-skill-2', {});
    expect(first.success).toBe(true);
    expect(guard.getCurrentLoad('limited-skill-2')).toBe(0);

    // Second should also succeed since first already freed
    const second = await executor.execute('limited-skill-2', {});
    expect(second.success).toBe(true);
  });

  it('no limit when max_concurrent is not set (default Infinity)', async () => {
    const guard = new ConcurrencyGuard();
    const slowMode: ExecutorMode = {
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ success: true, result: 'done' }), 50)),
    };
    // commandConfig has no capacity field
    const modes = new Map<string, ExecutorMode>([['command', slowMode]]);
    const executor = createSkillExecutor([commandConfig], modes, guard);

    // Run multiple in parallel — all should succeed
    const results = await Promise.all([
      executor.execute('cmd-skill', {}),
      executor.execute('cmd-skill', {}),
      executor.execute('cmd-skill', {}),
    ]);

    results.forEach((r) => expect(r.success).toBe(true));
  });

  it('releases slot even when executor throws', async () => {
    const guard = new ConcurrencyGuard();
    const throwingMode: ExecutorMode = {
      execute: () => Promise.reject(new Error('boom')),
    };
    const skillWithCapacity: SkillConfig = {
      ...commandConfig,
      id: 'throwing-skill',
      capacity: { max_concurrent: 1 },
    };
    const modes = new Map<string, ExecutorMode>([['command', throwingMode]]);
    const executor = createSkillExecutor([skillWithCapacity], modes, guard);

    const result = await executor.execute('throwing-skill', {});
    expect(result.success).toBe(false);
    // Slot should be released despite the error
    expect(guard.getCurrentLoad('throwing-skill')).toBe(0);
  });
});
