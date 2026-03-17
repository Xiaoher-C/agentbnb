import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiExecutor } from './api-executor.js';
import type { ApiSkillConfig } from './skill-config.js';

/** Helper to create a minimal ApiSkillConfig */
function makeConfig(overrides: Partial<ApiSkillConfig> = {}): ApiSkillConfig {
  return {
    id: 'test-skill',
    type: 'api',
    name: 'Test Skill',
    endpoint: 'https://api.example.com/v1/action',
    method: 'POST',
    input_mapping: {},
    output_mapping: {},
    pricing: { credits_per_call: 1 },
    timeout_ms: 5000,
    retries: 0,
    ...overrides,
  };
}

/** Helper to create a mock fetch Response */
function mockResponse(
  body: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('ApiExecutor', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Input mapping: body ------------------------------------------------

  it('POST with body mapping sends correct JSON body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ output: 'done' }));

    const config = makeConfig({
      method: 'POST',
      input_mapping: {
        text: 'body.text',
        voice: 'body.voice_id',
      },
      output_mapping: { audio: 'response.output' },
    });

    const executor = new ApiExecutor();
    await executor.execute(config, { text: 'hello', voice: 'en-US' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/action');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ text: 'hello', voice_id: 'en-US' });
  });

  // ---- Input mapping: query -----------------------------------------------

  it('GET with query mapping sends correct query string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }));

    const config = makeConfig({
      method: 'GET',
      endpoint: 'https://api.example.com/v1/search',
      input_mapping: {
        q: 'query.q',
        limit: 'query.limit',
      },
      output_mapping: {},
    });

    const executor = new ApiExecutor();
    await executor.execute(config, { q: 'cats', limit: 10 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('cats');
    expect(parsed.searchParams.get('limit')).toBe('10');
  });

  // ---- Input mapping: path ------------------------------------------------

  it('path param replacement substitutes {param} in endpoint URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '42' }));

    const config = makeConfig({
      method: 'GET',
      endpoint: 'https://api.example.com/v1/items/{item_id}',
      input_mapping: {
        id: 'path.item_id',
      },
      output_mapping: {},
    });

    const executor = new ApiExecutor();
    await executor.execute(config, { id: '42' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/items/42');
    expect(url).not.toContain('{item_id}');
  });

  // ---- Auth: bearer -------------------------------------------------------

  it('bearer token auth sends Authorization: Bearer header', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = makeConfig({
      auth: { type: 'bearer', token: 'my-secret-token' },
    });

    const executor = new ApiExecutor();
    await executor.execute(config, {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-token');
  });

  // ---- Auth: apikey -------------------------------------------------------

  it('apikey auth sends configured header with key value', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = makeConfig({
      auth: { type: 'apikey', header: 'X-ElevenLabs-Api-Key', key: 'lab-key-123' },
    });

    const executor = new ApiExecutor();
    await executor.execute(config, {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-ElevenLabs-Api-Key']).toBe('lab-key-123');
  });

  // ---- Auth: basic --------------------------------------------------------

  it('basic auth sends Authorization: Basic base64(user:pass)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = makeConfig({
      auth: { type: 'basic', username: 'user', password: 'pass' },
    });

    const executor = new ApiExecutor();
    await executor.execute(config, {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
    expect(headers['Authorization']).toBe(expected);
  });

  // ---- Output mapping -----------------------------------------------------

  it('output mapping extracts nested field via dot notation', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ data: { audio: 'base64abc' } }));

    const config = makeConfig({
      output_mapping: { audio_out: 'response.data.audio' },
    });

    const executor = new ApiExecutor();
    const result = await executor.execute(config, {});

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>)['audio_out']).toBe('base64abc');
  });

  // ---- Retry on transient error -------------------------------------------

  it('retries on 503 and succeeds on second attempt', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ error: 'Service Unavailable' }, 503))
      .mockResolvedValueOnce(mockResponse({ result: 'ok' }));

    const config = makeConfig({
      retries: 1,
      output_mapping: { out: 'response.result' },
    });

    const executor = new ApiExecutor();
    const result = await executor.execute(config, {});

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>)['out']).toBe('ok');
  });

  // ---- Non-2xx after retries exhausted ------------------------------------

  it('returns error with status code when non-2xx after retries exhausted', async () => {
    mockFetch.mockResolvedValue(mockResponse({ error: 'Gone' }, 410));

    const config = makeConfig({ retries: 0 });

    const executor = new ApiExecutor();
    const result = await executor.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('410');
  });

  // ---- Timeout ------------------------------------------------------------

  it('timeout returns error when request exceeds timeout_ms', async () => {
    // Simulate abort by rejecting with an AbortError
    mockFetch.mockImplementationOnce((_url: unknown, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        // Simulate the signal aborting immediately
        const signal = init.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
          // Trigger the abort by not resolving — let the controller timeout handle it
        }
        // Force timeout by using a very short timeout config
        setTimeout(() => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, 10);
      });
    });

    const config = makeConfig({ timeout_ms: 1 });

    const executor = new ApiExecutor();
    const result = await executor.execute(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout|aborted|abort/i);
  });

  // ---- Header input mapping -----------------------------------------------

  it('header input mapping sends param as request header', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));

    const config = makeConfig({
      input_mapping: { session_id: 'header.X-Session-Id' },
    });

    const executor = new ApiExecutor();
    await executor.execute(config, { session_id: 'sess-abc' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Session-Id']).toBe('sess-abc');
  });

  // ---- Empty output mapping (returns full response body) ------------------

  it('returns full response body when output_mapping is empty', async () => {
    const responseBody = { foo: 'bar', baz: 42 };
    mockFetch.mockResolvedValueOnce(mockResponse(responseBody));

    const config = makeConfig({ output_mapping: {} });

    const executor = new ApiExecutor();
    const result = await executor.execute(config, {});

    expect(result.success).toBe(true);
    expect(result.result).toEqual(responseBody);
  });
});
