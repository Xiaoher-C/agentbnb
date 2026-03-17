import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawBridge } from './openclaw-bridge.js';
import type { OpenClawSkillConfig } from './skill-config.js';

// Mock node:child_process at module level so ESM can replace execFileSync
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
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

describe('OpenClawBridge — process channel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns openclaw run command with JSON input', async () => {
    const execFileSyncSpy = vi
      .spyOn(child_process, 'execFileSync')
      .mockReturnValue(Buffer.from(JSON.stringify({ result: 'done' })));

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, { key: 'value' });

    expect(execFileSyncSpy).toHaveBeenCalledOnce();
    const args = execFileSyncSpy.mock.calls[0]![1] as string[];
    expect(execFileSyncSpy.mock.calls[0]![0]).toBe('openclaw');
    expect(args[0]).toBe('run');
    expect(args[1]).toBe('my-agent');
    expect(args[2]).toBe('--input');

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ result: 'done' });
  });

  it('passes task payload as JSON in --input flag', async () => {
    vi.spyOn(child_process, 'execFileSync').mockImplementation((cmd: unknown) => {
      const cmdStr = cmd as string;
      const match = cmdStr.match(/--input '(.+)'$/);
      if (!match) throw new Error('No --input found in: ' + cmdStr);
      const payload = JSON.parse(match[1]!) as Record<string, unknown>;
      expect(payload.task).toBe('Test Skill');
      expect(payload.source).toBe('agentbnb');
      return Buffer.from(JSON.stringify({ output: 'ok' }));
    });

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    await bridge.execute(config, { prompt: 'hello' });
  });

  it('returns error when command fails', async () => {
    vi.spyOn(child_process, 'execFileSync').mockImplementation(() => {
      throw new Error('Command not found: openclaw');
    });

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Command not found/);
  });

  it('returns error when stdout is invalid JSON', async () => {
    vi.spyOn(child_process, 'execFileSync').mockReturnValue(Buffer.from('not json'));

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process' });
    const result = await bridge.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
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

  it('process: timeout option is passed to execFileSync', async () => {
    const execFileSyncSpy = vi
      .spyOn(child_process, 'execFileSync')
      .mockReturnValue(Buffer.from(JSON.stringify({ ok: true })));

    const bridge = new OpenClawBridge();
    const config = makeConfig({ channel: 'process', timeout_ms: 3000 });
    await bridge.execute(config, {});

    expect(execFileSyncSpy).toHaveBeenCalledOnce();
    // execFileSync('openclaw', [...args], { timeout })
    const opts = execFileSyncSpy.mock.calls[0]![2] as { timeout?: number };
    expect(opts?.timeout).toBe(3000);
  });
});
