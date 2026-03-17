import type { ExecutorMode, ExecutionResult } from './executor.js';
import type { SkillConfig, ApiSkillConfig } from './skill-config.js';

/**
 * Parsed representation of a single input_mapping entry.
 * e.g. `{ target: 'body', key: 'text' }` from `"body.text"`
 */
interface MappingTarget {
  target: 'body' | 'query' | 'path' | 'header';
  key: string;
}

/**
 * Parses a mapping value like "body.text" or "query.q" into a MappingTarget.
 *
 * @param mapping - The mapping string (e.g. "body.text").
 * @returns The parsed MappingTarget.
 * @throws Error if the mapping format is invalid.
 */
function parseMappingTarget(mapping: string): MappingTarget {
  const dotIndex = mapping.indexOf('.');
  if (dotIndex < 0) {
    throw new Error(`Invalid input_mapping format: "${mapping}" (expected "target.key")`);
  }
  const target = mapping.slice(0, dotIndex) as MappingTarget['target'];
  const key = mapping.slice(dotIndex + 1);

  if (!['body', 'query', 'path', 'header'].includes(target)) {
    throw new Error(
      `Invalid mapping target "${target}" in "${mapping}" (must be body|query|path|header)`,
    );
  }

  return { target, key };
}

/**
 * Extracts a nested value from an object using dot-notation path.
 * e.g. `extractByPath({ data: { audio: 'abc' } }, 'data.audio')` returns `'abc'`
 *
 * When path starts with "response.", the "response" prefix is stripped
 * (the mapping convention uses "response.xxx" but the actual response body
 * is the root object passed in).
 *
 * @param obj - The object to traverse.
 * @param dotPath - Dot-separated property path.
 * @returns The value at the path, or `undefined` if any step is missing.
 */
export function extractByPath(obj: unknown, dotPath: string): unknown {
  // Strip leading "response." prefix — convention in output_mapping
  const normalizedPath = dotPath.startsWith('response.')
    ? dotPath.slice('response.'.length)
    : dotPath;

  const parts = normalizedPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Builds the Authorization / API-key headers for the configured auth type.
 *
 * @param auth - The auth config from ApiSkillConfig.
 * @returns A plain object of header name → value entries.
 */
export function buildAuthHeaders(
  auth: ApiSkillConfig['auth'],
): Record<string, string> {
  if (!auth) return {};

  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };

    case 'apikey':
      return { [auth.header]: auth.key };

    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
  }
}

/**
 * Routes a set of input parameters to their respective destination buckets
 * (body, query, path, header) based on the `input_mapping` config.
 *
 * @param params - The input parameters passed to execute().
 * @param mapping - The `input_mapping` record from ApiSkillConfig.
 * @returns Four buckets: body, query, pathParams, headers.
 */
export function applyInputMapping(
  params: Record<string, unknown>,
  mapping: Record<string, string>,
): {
  body: Record<string, unknown>;
  query: Record<string, string>;
  pathParams: Record<string, string>;
  headers: Record<string, string>;
} {
  const body: Record<string, unknown> = {};
  const query: Record<string, string> = {};
  const pathParams: Record<string, string> = {};
  const headers: Record<string, string> = {};

  for (const [paramName, mappingValue] of Object.entries(mapping)) {
    const value = params[paramName];
    if (value === undefined) continue; // Skip unmapped params

    const { target, key } = parseMappingTarget(mappingValue);

    switch (target) {
      case 'body':
        body[key] = value;
        break;
      case 'query':
        query[key] = String(value);
        break;
      case 'path':
        pathParams[key] = String(value);
        break;
      case 'header':
        headers[key] = String(value);
        break;
    }
  }

  return { body, query, pathParams, headers };
}

/**
 * Sleeps for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP status codes that should be retried. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

/**
 * API Executor (Mode A) — config-driven REST API calls.
 *
 * Supports:
 * - All 4 HTTP methods: GET, POST, PUT, DELETE
 * - Input mapping to body, query string, path params, or request headers
 * - Auth: bearer token, API key header, HTTP Basic
 * - Output mapping via dot-notation extraction from JSON response
 * - Retry with exponential backoff on 429/500/503
 * - Timeout via AbortController
 *
 * Implements {@link ExecutorMode} — registered under the `"api"` type key.
 */
export class ApiExecutor implements ExecutorMode {
  /**
   * Execute an API call described by the given skill config.
   *
   * @param config - The validated SkillConfig (must be ApiSkillConfig).
   * @param params - Input parameters to map to the HTTP request.
   * @returns Partial ExecutionResult (without latency_ms — added by SkillExecutor).
   */
  async execute(
    config: SkillConfig,
    params: Record<string, unknown>,
  ): Promise<Omit<ExecutionResult, 'latency_ms'>> {
    // Safe cast — SkillExecutor guarantees the type matches the registered mode
    const apiConfig = config as ApiSkillConfig;

    const { body, query, pathParams, headers: mappedHeaders } = applyInputMapping(
      params,
      apiConfig.input_mapping,
    );

    // 1. Build URL: replace path params then append query string
    let url = apiConfig.endpoint;
    for (const [key, value] of Object.entries(pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    }

    if (Object.keys(query).length > 0) {
      const qs = new URLSearchParams(query).toString();
      url = `${url}?${qs}`;
    }

    // 2. Build request headers (auth + mapped headers)
    const authHeaders = buildAuthHeaders(apiConfig.auth);
    const requestHeaders: Record<string, string> = {
      ...authHeaders,
      ...mappedHeaders,
    };

    // Add Content-Type for requests with a body
    const hasBody = ['POST', 'PUT'].includes(apiConfig.method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    // 3. Execute with retry loop
    const maxAttempts = (apiConfig.retries ?? 0) + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Exponential backoff (skip on first attempt)
      if (attempt > 0) {
        await sleep(100 * Math.pow(2, attempt - 1));
      }

      // AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        apiConfig.timeout_ms ?? 30000,
      );

      let response: Response;
      try {
        response = await fetch(url, {
          method: apiConfig.method,
          headers: requestHeaders,
          body: hasBody ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        const message = err instanceof Error ? err.message : String(err);
        const isAbort =
          (err instanceof Error && err.name === 'AbortError') ||
          message.toLowerCase().includes('abort');

        if (isAbort) {
          return { success: false, error: `Request timeout after ${apiConfig.timeout_ms}ms` };
        }
        return { success: false, error: message };
      } finally {
        clearTimeout(timeoutId);
      }

      // If retryable and we have attempts left, retry
      if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts - 1) {
        continue;
      }

      // Non-2xx after retries exhausted
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status} from ${apiConfig.endpoint}`,
        };
      }

      // 4. Parse JSON response
      const responseBody = await response.json() as unknown;

      // 5. Apply output mapping
      const outputMapping = apiConfig.output_mapping;
      if (Object.keys(outputMapping).length === 0) {
        // No mapping — return full response body
        return { success: true, result: responseBody };
      }

      const mappedOutput: Record<string, unknown> = {};
      for (const [outputKey, path] of Object.entries(outputMapping)) {
        mappedOutput[outputKey] = extractByPath(responseBody, path);
      }

      return { success: true, result: mappedOutput };
    }

    // Should not reach here, but TypeScript needs a return
    return { success: false, error: 'Unexpected: retry loop exhausted' };
  }
}
