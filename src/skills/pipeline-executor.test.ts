import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from './pipeline-executor.js';
import { SkillExecutor } from './executor.js';
import type { PipelineSkillConfig } from './skill-config.js';

// Helper to create a mock SkillExecutor
function makeMockExecutor(
  responses: Record<string, { success: boolean; result?: unknown; error?: string }>,
): SkillExecutor {
  const executor = {
    execute: vi.fn(async (skillId: string, _params: Record<string, unknown>) => {
      const resp = responses[skillId] ?? { success: false, error: `Unknown skill: ${skillId}` };
      return { ...resp, latency_ms: 5 };
    }),
    listSkills: vi.fn(() => Object.keys(responses)),
    getSkillConfig: vi.fn(() => undefined),
  } as unknown as SkillExecutor;
  return executor;
}

// Minimal pipeline config factory
function makePipeline(steps: PipelineSkillConfig['steps']): PipelineSkillConfig {
  return {
    id: 'test-pipeline',
    type: 'pipeline',
    name: 'Test Pipeline',
    steps,
    pricing: { credits_per_call: 1 },
  };
}

describe('PipelineExecutor', () => {
  let executor: SkillExecutor;
  let pipeline: PipelineExecutor;

  beforeEach(() => {
    executor = makeMockExecutor({
      'skill-a': { success: true, result: { text: 'hello from A' } },
      'skill-b': { success: true, result: { audio: 'voice.mp3' } },
      'skill-c': { success: true, result: 'final' },
      'skill-fail': { success: false, error: 'service unavailable' },
    });
    pipeline = new PipelineExecutor(executor);
  });

  describe('empty pipeline', () => {
    it('returns success with null result when steps array is empty', async () => {
      // Empty pipeline (edge case — schema requires min(1) but executor should handle gracefully)
      const config = {
        id: 'empty-pipeline',
        type: 'pipeline' as const,
        name: 'Empty Pipeline',
        steps: [],
        pricing: { credits_per_call: 0 },
      };
      const result = await pipeline.execute(config as unknown as PipelineSkillConfig, {});
      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });
  });

  describe('single step', () => {
    it('executes one skill step and returns its result', async () => {
      const config = makePipeline([{ skill_id: 'skill-a', input_mapping: {} }]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ text: 'hello from A' });
    });

    it('passes params from pipeline invocation via input_mapping', async () => {
      const config = makePipeline([
        { skill_id: 'skill-a', input_mapping: { name: '${params.name}' } },
      ]);
      await pipeline.execute(config, { name: 'world' });
      expect(executor.execute).toHaveBeenCalledWith('skill-a', { name: 'world' });
    });
  });

  describe('two-step pipeline with ${prev.result} piping', () => {
    it('step 2 receives step 1 result via ${prev.result.text}', async () => {
      const config = makePipeline([
        { skill_id: 'skill-a', input_mapping: {} },
        { skill_id: 'skill-b', input_mapping: { script: '${prev.result.text}' } },
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(true);
      // Verify step-b received skill-a's output
      expect(executor.execute).toHaveBeenNthCalledWith(2, 'skill-b', {
        script: 'hello from A',
      });
      expect(result.result).toEqual({ audio: 'voice.mp3' });
    });
  });

  describe('three-step pipeline with ${steps[N].result} reference', () => {
    it('step 2 can reference step 0 result via ${steps[0].result.text}', async () => {
      const config = makePipeline([
        { skill_id: 'skill-a', input_mapping: {} },
        { skill_id: 'skill-b', input_mapping: {} },
        {
          skill_id: 'skill-c',
          input_mapping: {
            original: '${steps[0].result.text}',
            processed: '${prev.result.audio}',
          },
        },
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(true);
      expect(executor.execute).toHaveBeenNthCalledWith(3, 'skill-c', {
        original: 'hello from A',
        processed: 'voice.mp3',
      });
    });
  });

  describe('step failure stops pipeline', () => {
    it('returns error with "Step N failed: {message}" and stops', async () => {
      const config = makePipeline([
        { skill_id: 'skill-fail', input_mapping: {} },
        { skill_id: 'skill-a', input_mapping: {} }, // Should not be called
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Step 0 failed/);
      expect(result.error).toContain('service unavailable');
      // skill-a should never be called since step 0 failed
      expect(executor.execute).toHaveBeenCalledTimes(1);
    });

    it('reports correct step index when middle step fails', async () => {
      const config = makePipeline([
        { skill_id: 'skill-a', input_mapping: {} },
        { skill_id: 'skill-fail', input_mapping: {} },
        { skill_id: 'skill-b', input_mapping: {} },
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Step 1 failed/);
      expect(executor.execute).toHaveBeenCalledTimes(2); // a + fail, not b
    });
  });

  describe('command steps', () => {
    it('executes echo command and captures stdout', async () => {
      const config = makePipeline([
        { command: 'echo hello', input_mapping: {} },
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(true);
      expect(result.result).toBe('hello');
    });

    it('interpolates input_mapping into command via ${params.*}', async () => {
      const config = makePipeline([
        { command: 'echo ${params.msg}', input_mapping: { msg: '${params.msg}' } },
      ]);
      const result = await pipeline.execute(config, { msg: 'greetings' });
      expect(result.success).toBe(true);
      expect(result.result).toBe('greetings');
    });

    it('command failure stops pipeline with error', async () => {
      const config = makePipeline([
        { command: 'exit 1', input_mapping: {} },
        { skill_id: 'skill-a', input_mapping: {} },
      ]);
      const result = await pipeline.execute(config, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Step 0 failed/);
    });
  });
});
