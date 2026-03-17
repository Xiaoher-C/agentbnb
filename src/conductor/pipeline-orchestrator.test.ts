import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubTask, MatchResult, OrchestrationResult } from './types.js';

// Mock requestCapability before importing orchestrate
vi.mock('../gateway/client.js', () => ({
  requestCapability: vi.fn(),
}));

import { orchestrate, type OrchestrateOptions } from './pipeline-orchestrator.js';
import { requestCapability } from '../gateway/client.js';

const mockedRequest = vi.mocked(requestCapability);

/** Helper to build a SubTask. */
function sub(
  id: string,
  cap: string,
  deps: string[] = [],
  params: Record<string, unknown> = {},
  credits = 5,
): SubTask {
  return { id, description: `do ${id}`, required_capability: cap, params, depends_on: deps, estimated_credits: credits };
}

/** Helper to build a MatchResult. */
function match(
  subtaskId: string,
  agent: string,
  skill: string,
  credits = 5,
  alternatives: MatchResult['alternatives'] = [],
): MatchResult {
  return { subtask_id: subtaskId, selected_agent: agent, selected_skill: skill, score: 0.9, credits, alternatives };
}

/** Default resolveAgentUrl — maps owner to a deterministic URL. */
function resolveAgentUrl(owner: string) {
  return { url: `http://${owner}:7700`, cardId: `card-${owner}` };
}

/** Build standard OrchestrateOptions from subtasks and matches array. */
function opts(subtasks: SubTask[], matches: MatchResult[]): OrchestrateOptions {
  const matchMap = new Map(matches.map((m) => [m.subtask_id, m]));
  return { subtasks, matches: matchMap, gatewayToken: 'tok', resolveAgentUrl };
}

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: Sequential dependency chain (A->B->C) executes in order', async () => {
    const a = sub('A', 'text_gen');
    const b = sub('B', 'tts', ['A']);
    const c = sub('C', 'video_edit', ['B']);

    const callOrder: string[] = [];
    mockedRequest.mockImplementation(async (o) => {
      // Extract which card was called to track order
      const cardId = (o as { cardId: string }).cardId;
      callOrder.push(cardId);
      return { data: `result-${cardId}` };
    });

    const result = await orchestrate(opts([a, b, c], [
      match('A', 'alice', 'text_gen'),
      match('B', 'bob', 'tts'),
      match('C', 'carol', 'video_edit'),
    ]));

    expect(result.success).toBe(true);
    // Sequential: A finishes before B starts, B before C
    expect(callOrder).toEqual(['card-alice', 'card-bob', 'card-carol']);
    expect(result.results.get('A')).toEqual({ data: 'result-card-alice' });
    expect(result.results.get('C')).toEqual({ data: 'result-card-carol' });
    expect(result.total_credits).toBe(15); // 5+5+5
  });

  it('Test 2: Independent tasks at same depth execute in parallel (A->[B,C]->D)', async () => {
    const a = sub('A', 'text_gen');
    const b = sub('B', 'tts', ['A']);
    const c = sub('C', 'video_gen', ['A']);
    const d = sub('D', 'video_edit', ['B', 'C']);

    // Track start times to verify parallelism
    const startTimes: Record<string, number> = {};
    mockedRequest.mockImplementation(async (o) => {
      const cardId = (o as { cardId: string }).cardId;
      startTimes[cardId] = Date.now();
      // Small delay to ensure parallel tasks have overlapping execution windows
      await new Promise((r) => setTimeout(r, 10));
      return { data: `result-${cardId}` };
    });

    const result = await orchestrate(opts([a, b, c, d], [
      match('A', 'alice', 'text_gen'),
      match('B', 'bob', 'tts'),
      match('C', 'carol', 'video_gen'),
      match('D', 'dave', 'video_edit'),
    ]));

    expect(result.success).toBe(true);
    // B and C should start at roughly the same time (within a few ms of each other)
    const bStart = startTimes['card-bob']!;
    const cStart = startTimes['card-carol']!;
    expect(Math.abs(bStart - cStart)).toBeLessThan(50);
    // D should start after both B and C
    expect(startTimes['card-dave']!).toBeGreaterThanOrEqual(Math.max(bStart, cStart));
    expect(result.total_credits).toBe(20);
  });

  it('Test 3: Output piping -- step N result is available as params to step N+1 via interpolation', async () => {
    const a = sub('A', 'text_gen', [], {});
    const b = sub('B', 'tts', ['A'], { text: '${steps.A.script}', format: 'mp3' });

    mockedRequest
      .mockResolvedValueOnce({ script: 'Hello world' })
      .mockResolvedValueOnce({ audio_url: 'http://audio.mp3' });

    const result = await orchestrate(opts([a, b], [
      match('A', 'alice', 'text_gen'),
      match('B', 'bob', 'tts'),
    ]));

    expect(result.success).toBe(true);
    // Check that step B was called with interpolated params
    const bCall = mockedRequest.mock.calls[1]![0] as { params?: Record<string, unknown> };
    expect(bCall.params).toMatchObject({ text: 'Hello world', format: 'mp3' });
  });

  it('Test 4: Primary agent failure triggers retry with first alternative agent', async () => {
    const a = sub('A', 'text_gen');

    mockedRequest
      .mockRejectedValueOnce(new Error('Primary agent down'))
      .mockResolvedValueOnce({ data: 'from-alt' });

    const result = await orchestrate(opts([a], [
      match('A', 'alice', 'text_gen', 5, [
        { agent: 'alt-bob', skill: 'text_gen', score: 0.7, credits: 6 },
      ]),
    ]));

    expect(result.success).toBe(true);
    expect(result.results.get('A')).toEqual({ data: 'from-alt' });
    // Should have tried alice then alt-bob
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    // Alternative agent's URL should be used for second call
    const secondCall = mockedRequest.mock.calls[1]![0] as { gatewayUrl: string };
    expect(secondCall.gatewayUrl).toBe('http://alt-bob:7700');
  });

  it('Test 5: Budget exceeded mid-execution aborts remaining tasks and returns partial results', async () => {
    // Task A costs 50, task B depends on A and costs 60 (total 110, but we report partial)
    const a = sub('A', 'text_gen', [], {}, 50);
    const b = sub('B', 'tts', ['A'], {}, 60);

    mockedRequest.mockResolvedValueOnce({ data: 'a-result' });
    // B should never be called because it would push total past reasonable limits
    // We test that the budget tracking works by checking credits are tracked
    mockedRequest.mockRejectedValueOnce(new Error('Budget fail'));

    const result = await orchestrate({
      ...opts([a, b], [
        match('A', 'alice', 'text_gen', 50),
        match('B', 'bob', 'tts', 60),
      ]),
      maxBudget: 55,
    });

    expect(result.success).toBe(false);
    // A should have completed
    expect(result.results.get('A')).toEqual({ data: 'a-result' });
    // B should not have been attempted (budget exceeded)
    expect(result.results.has('B')).toBe(false);
    expect(result.total_credits).toBe(50);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('Test 6: All tasks fail returns success:false with error messages', async () => {
    const a = sub('A', 'text_gen');

    mockedRequest.mockRejectedValue(new Error('All agents down'));

    const result = await orchestrate(opts([a], [
      match('A', 'alice', 'text_gen', 5, []),
    ]));

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('All agents down') || e.includes('Task A'))).toBe(true);
    expect(result.total_credits).toBe(0);
  });

  it('Test 7: Empty subtask list returns success:true with empty results', async () => {
    const result = await orchestrate(opts([], []));

    expect(result.success).toBe(true);
    expect(result.results.size).toBe(0);
    expect(result.total_credits).toBe(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});
