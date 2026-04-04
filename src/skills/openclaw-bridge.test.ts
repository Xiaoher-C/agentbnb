import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawBridge, parseOpenClawResponse } from './openclaw-bridge.js';
import type { OpenClawSkillConfig } from './skill-config.js';

// Mock node:child_process at module level so ESM can replace spawnSync
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import * as child_process from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<OpenClawSkillConfig> = {},
): OpenClawSkillConfig {
  return {
    id: 'test-skill',
    type: 'openclaw',
    name: 'Test Skill',
    agent_name: 'my-agent',
    channel: 'webhook',
    pricing: { credits_per_call: 5 },
    timeout_ms: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Webhook channel
// ---------------------------------------------------------------------------

describe('OpenClawBridge — webhook channel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to correct URL with task payload', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output: 'hello world' }),
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    const result = await bridge.execute(config, { text: 'hi' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/openclaw/my-agent/task');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.task).toBe('Test Skill');
    expect(body.params).toEqual({ text: 'hi' });
    expect(body.source).toBe('agentbnb');
    expect(body.skill_id).toBe('test-skill');
  });

  it('returns success:true with result from response body', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output: 'generated-text' }),
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ output: 'generated-text' });
  });

  it('returns error on non-200 response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/503/);
  });

  it('uses OPENCLAW_BASE_URL env var when set', async () => {
    const originalEnv = process.env['OPENCLAW_BASE_URL'];
    process.env['OPENCLAW_BASE_URL'] = 'http://myhost:9000';

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    await bridge.execute(config, {});

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/myhost:9000/);

    if (originalEnv === undefined) {
      delete process.env['OPENCLAW_BASE_URL'];
    } else {
      process.env['OPENCLAW_BASE_URL'] = originalEnv;
    }
  });

  it('returns error on fetch network failure', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

// ---------------------------------------------------------------------------
// Process channel
// ---------------------------------------------------------------------------

/** Helper to create a mock spawnSync return value with JSON on stderr (OpenClaw behavior). */
function mockSpawnResult(jsonData: unknown, opts?: { error?: Error; status?: number; useStdout?: boolean }) {
  const json = JSON.stringify(jsonData);
  return {
    stdout: Buffer.from(opts?.useStdout ? json : ''),
    stderr: Buffer.from(opts?.useStdout ? '' : json),
    status: opts?.status ?? 0,
    error: opts?.error ?? undefined,
    pid: 12345,
    signal: null,
    output: [],
  };
}

describe('OpenClawBridge — process channel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns openclaw agent command with a contextual rental request message', async () => {
    const spawnSyncSpy = vi
      .spyOn(child_process, 'spawnSync')
      .mockReturnValue(mockSpawnResult({ result: 'done' }) as ReturnType<typeof child_process.spawnSync>);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, { key: 'value' });

    expect(spawnSyncSpy).toHaveBeenCalledOnce();
    const args = spawnSyncSpy.mock.calls[0]![1] as string[];
    expect(spawnSyncSpy.mock.calls[0]![0]).toBe('openclaw');
    expect(args[0]).toBe('agent');
    expect(args[1]).toBe('--agent');
    expect(args[2]).toBe('my-agent');
    expect(args[3]).toBe('--message');
    expect(args[4]).toContain('[AgentBnB Rental Request]');
    expect(args[4]).toContain('skills/test-skill/SKILL.md');
    expect(args[4]).toContain('"key": "value"');
    expect(args[5]).toBe('--json');
    expect(args[6]).toBe('--local');

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ result: 'done' });
  });

  it('passes a contextual AgentBnB rental prompt in --message', async () => {
    vi.spyOn(child_process, 'spawnSync').mockImplementation((_cmd: unknown, args: unknown) => {
      const argArr = args as string[];
      const msgIdx = argArr.indexOf('--message');
      if (msgIdx === -1) throw new Error('No --message found in args');
      const message = argArr[msgIdx + 1]!;
      expect(message).toContain('[AgentBnB Rental Request]');
      expect(message).toContain('test-skill');
      expect(message).toContain('"prompt": "hello"');
      return mockSpawnResult({ output: 'ok' }) as ReturnType<typeof child_process.spawnSync>;
    });

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    await bridge.execute(config, { prompt: 'hello' });
  });

  it('returns error when command fails', async () => {
    vi.spyOn(child_process, 'spawnSync').mockReturnValue(
      mockSpawnResult({}, { error: new Error('Command not found: openclaw') }) as ReturnType<typeof child_process.spawnSync>,
    );

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Command not found/);
  });

  it('returns error when output is not valid JSON', async () => {
    vi.spyOn(child_process, 'spawnSync').mockReturnValue({
      stdout: Buffer.from(''),
      stderr: Buffer.from('not json at all'),
      status: 0,
      error: undefined,
      pid: 12345,
      signal: null,
      output: [],
    } as unknown as ReturnType<typeof child_process.spawnSync>);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid json/i);
  });

  it('reads JSON from stderr (OpenClaw default behavior)', async () => {
    vi.spyOn(child_process, 'spawnSync').mockReturnValue(
      mockSpawnResult({ payloads: [{ text: '{"ok": true}', mediaUrl: null }], meta: { durationMs: 100 } }) as ReturnType<typeof child_process.spawnSync>,
    );

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).ok).toBe(true);
  });

  it('falls back to stdout when stderr is empty', async () => {
    vi.spyOn(child_process, 'spawnSync').mockReturnValue(
      mockSpawnResult({ simple: 'result' }, { useStdout: true }) as ReturnType<typeof child_process.spawnSync>,
    );

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).simple).toBe('result');
  });

  it('returns error when both stdout and stderr are empty', async () => {
    vi.spyOn(child_process, 'spawnSync').mockReturnValue({
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 0,
      error: undefined,
      pid: 12345,
      signal: null,
      output: [],
    } as unknown as ReturnType<typeof child_process.spawnSync>);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty output/i);
  });
});

// ---------------------------------------------------------------------------
// Telegram channel (fire-and-forget MVP)
// ---------------------------------------------------------------------------

describe('OpenClawBridge — telegram channel', () => {
  beforeEach(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-bot-token';
    process.env['TELEGRAM_CHAT_ID'] = '12345';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];
    vi.unstubAllGlobals();
  });

  it('POSTs to Telegram sendMessage API', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'telegram' });
    const result = await bridge.execute(config, { text: 'hello' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.telegram.org/bottest-bot-token/sendMessage');

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>)['sent']).toBe(true);
    expect((result.result as Record<string, unknown>)['channel']).toBe('telegram');
  });

  it('includes task info in telegram message text', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'telegram' });
    await bridge.execute(config, { key: 'val' });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body['chat_id']).toBe('12345');
    expect(String(body['text'])).toContain('Test Skill');
  });

  it('returns error when TELEGRAM_BOT_TOKEN is not set', async () => {
    delete process.env['TELEGRAM_BOT_TOKEN'];

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'telegram' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TELEGRAM_BOT_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// parseOpenClawResponse
// ---------------------------------------------------------------------------

describe('parseOpenClawResponse', () => {
  it('extracts structured JSON from the last payload text', () => {
    const raw = {
      payloads: [
        { text: 'Thinking about the query...', mediaUrl: null },
        { text: 'Searching knowledge base...', mediaUrl: null },
        { text: '{"results": [{"text": "found it", "score": 0.9}], "total_results": 1}', mediaUrl: null },
      ],
      meta: {
        durationMs: 15000,
        agentMeta: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      },
    };

    const result = parseOpenClawResponse(raw) as Record<string, unknown>;
    expect(result.results).toEqual([{ text: 'found it', score: 0.9 }]);
    expect(result.total_results).toBe(1);
    expect((result._openclaw_meta as Record<string, unknown>).duration_ms).toBe(15000);
    expect((result._openclaw_meta as Record<string, unknown>).model).toBe('claude-sonnet-4-20250514');
  });

  it('falls back to concatenated text when last payload is not JSON', () => {
    const raw = {
      payloads: [
        { text: 'Here is the answer:', mediaUrl: null },
        { text: 'AgentBnB is a P2P agent capability sharing protocol.', mediaUrl: null },
      ],
      meta: { durationMs: 8000 },
    };

    const result = parseOpenClawResponse(raw) as Record<string, unknown>;
    expect(result.text).toContain('Here is the answer:');
    expect(result.text).toContain('P2P agent capability sharing');
    expect(result._openclaw_meta).toBeDefined();
  });

  it('collects media_urls from payloads', () => {
    const raw = {
      payloads: [
        { text: 'Generated audio', mediaUrl: 'https://example.com/audio.mp3' },
        { text: '{"status": "ok"}', mediaUrl: null },
      ],
      meta: { durationMs: 5000 },
    };

    const result = parseOpenClawResponse(raw) as Record<string, unknown>;
    // Structured JSON from last payload, but mediaUrl should not be lost
    expect(result.status).toBe('ok');
  });

  it('handles payloads with only media URLs and no text', () => {
    const raw = {
      payloads: [
        { text: null, mediaUrl: 'https://example.com/file.pdf' },
      ],
      meta: { durationMs: 3000 },
    };

    const result = parseOpenClawResponse(raw) as Record<string, unknown>;
    expect(result.text).toBe('');
    expect(result.media_urls).toEqual(['https://example.com/file.pdf']);
  });

  it('passes through non-OpenClaw format unchanged', () => {
    const raw = { result: 'done', latency: 100 };
    expect(parseOpenClawResponse(raw)).toEqual(raw);
  });

  it('passes through primitive values unchanged', () => {
    expect(parseOpenClawResponse('hello')).toBe('hello');
    expect(parseOpenClawResponse(42)).toBe(42);
    expect(parseOpenClawResponse(null)).toBe(null);
  });

  it('handles empty payloads array', () => {
    const raw = {
      payloads: [],
      meta: { durationMs: 1000 },
    };

    const result = parseOpenClawResponse(raw) as Record<string, unknown>;
    expect(result.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Process channel — OpenClaw response parsing integration
// ---------------------------------------------------------------------------

describe('OpenClawBridge — process channel with OpenClaw response format', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts structured result from OpenClaw { payloads, meta } envelope on stderr', async () => {
    const openclawResponse = {
      payloads: [
        { text: 'Searching...', mediaUrl: null },
        { text: '{"results": [{"text": "match", "score": 0.85}], "query": "test"}', mediaUrl: null },
      ],
      meta: { durationMs: 12000, agentMeta: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' } },
    };

    vi.spyOn(child_process, 'spawnSync').mockReturnValue(
      mockSpawnResult(openclawResponse) as ReturnType<typeof child_process.spawnSync>,
    );

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, { query: 'test' });

    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.results).toEqual([{ text: 'match', score: 0.85 }]);
    expect(data.query).toBe('test');
    expect((data._openclaw_meta as Record<string, unknown>).model).toBe('claude-sonnet-4-20250514');
  });

  it('returns text fallback when agent does not return JSON', async () => {
    const openclawResponse = {
      payloads: [
        { text: 'I could not find the skill definition.', mediaUrl: null },
      ],
      meta: { durationMs: 5000 },
    };

    vi.spyOn(child_process, 'spawnSync').mockReturnValue(
      mockSpawnResult(openclawResponse) as ReturnType<typeof child_process.spawnSync>,
    );

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.text).toContain('could not find');
  });

  it('extracts JSON from stderr with preceding log lines', async () => {
    const openclawResponse = {
      payloads: [{ text: '{"found": true}', mediaUrl: null }],
      meta: { durationMs: 3000 },
    };
    const stderrWithLogs = `[plugins] memory loaded\n[agent] starting\n${JSON.stringify(openclawResponse)}`;

    vi.spyOn(child_process, 'spawnSync').mockReturnValue({
      stdout: Buffer.from(''),
      stderr: Buffer.from(stderrWithLogs),
      status: 0,
      error: undefined,
      pid: 12345,
      signal: null,
      output: [],
    } as unknown as ReturnType<typeof child_process.spawnSync>);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid channel
// ---------------------------------------------------------------------------

describe('OpenClawBridge — invalid channel', () => {
  it('returns error for unknown channel type', async () => {
    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook' });
    // Force an invalid channel by casting
    const badConfig = { ...config, channel: 'fax' } as unknown as OpenClawSkillConfig;
    const result = await bridge.execute(badConfig, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fax/);
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe('OpenClawBridge — timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('webhook: AbortError is returned as error, not thrown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    ));

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'webhook', timeout_ms: 100 });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out|aborted/i);
  });

  it('process: timeout option is passed to spawnSync', async () => {
    const spawnSyncSpy = vi
      .spyOn(child_process, 'spawnSync')
      .mockReturnValue(mockSpawnResult({ ok: true }) as ReturnType<typeof child_process.spawnSync>);

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process', timeout_ms: 3000 });
    await bridge.execute(config, {});

    expect(spawnSyncSpy).toHaveBeenCalledOnce();
    const opts = spawnSyncSpy.mock.calls[0]![2] as { timeout?: number };
    expect(opts?.timeout).toBe(3000);
  });
});
