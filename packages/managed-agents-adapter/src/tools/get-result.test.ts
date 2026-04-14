import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { registerGetResultTool } from './get-result.js';
import type { AdapterConfig } from '../config.js';

/**
 * Capture the tool handler registered by registerGetResultTool.
 */
function captureHandler(config: AdapterConfig) {
  const toolSpy = vi.fn();
  const fakeServer = { tool: toolSpy } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  registerGetResultTool(fakeServer, config);
  expect(toolSpy).toHaveBeenCalledOnce();
  const handler = toolSpy.mock.calls[0][3] as (args: Record<string, unknown>) => Promise<unknown>;
  return handler;
}

const BASE_CONFIG: AdapterConfig = {
  registryUrl: 'https://registry.test',
  managedAgentsBetaHeader: 'managed-agents-2026-04-01',
  port: 7702,
  keystorePath: '/tmp/test',
  maxSessionCost: 5,
  serviceAccountOwner: 'test-owner',
};

describe('agentbnb_get_result', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return complete result for settled escrow', async () => {
    // Arrange
    const escrowData = {
      status: 'settled',
      result: { summary: 'Translation complete', output: 'Bonjour le monde' },
      amount: 10,
      settled_at: '2026-04-14T12:00:00Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => escrowData,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-123' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.escrow_id).toBe('esc-123');
    expect(body.status).toBe('complete');
    expect(body.escrow_status).toBe('settled');
    expect(body.result).toEqual(escrowData.result);
    expect(body.credits).toBe(10);
    expect(body.settled_at).toBe('2026-04-14T12:00:00Z');
  });

  it('should return in_progress for held escrow', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'held', amount: 5 }),
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-pending' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.status).toBe('in_progress');
    expect(body.escrow_status).toBe('held');
    expect(body.result).toBeUndefined();
    expect(body.credits).toBe(5);
  });

  it('should return in_progress for started and progressing statuses', async () => {
    for (const status of ['started', 'progressing']) {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status }),
      }) as Mock;

      const handler = captureHandler(BASE_CONFIG);

      // Act
      const response = await handler({ escrow_id: `esc-${status}` });

      // Assert
      const body = JSON.parse((response as any).content[0].text);
      expect(body.status).toBe('in_progress');
      expect(body.escrow_status).toBe(status);
    }
  });

  it('should return failed with error for released escrow', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'released', error: 'Provider timed out' }),
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-fail' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.status).toBe('failed');
    expect(body.error).toBe('Provider timed out');
  });

  it('should return expired for abandoned escrow', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'abandoned' }),
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-abandoned' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.status).toBe('expired');
    expect(body.error).toContain('timed out');
  });

  it('should return not_found error for 404 response', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-unknown' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.error).toBe('not_found');
    expect(body.escrow_id).toBe('esc-unknown');
    expect(body.message).toContain('not found');
  });

  it('should return error for non-404 non-OK response', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-500' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.error).toContain('Registry returned 500');
    expect(body.escrow_id).toBe('esc-500');
  });

  it('should return error when fetch throws (network failure)', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-net-err' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.error).toContain('Registry unreachable');
    expect(body.error).toContain('Connection refused');
    expect(body.escrow_id).toBe('esc-net-err');
  });

  it('should call the correct escrow API URL with encoded escrow_id', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'settled', result: {} }),
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    await handler({ escrow_id: 'esc/special chars' });

    // Assert
    const url = (globalThis.fetch as Mock).mock.calls[0][0] as string;
    expect(url).toBe('https://registry.test/api/credits/escrow/esc%2Fspecial%20chars');
  });

  it('should use default error message for released escrow without explicit error', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'released' }),
    }) as Mock;

    const handler = captureHandler(BASE_CONFIG);

    // Act
    const response = await handler({ escrow_id: 'esc-no-err' });

    // Assert
    const body = JSON.parse((response as any).content[0].text);
    expect(body.status).toBe('failed');
    expect(body.error).toContain('credits released');
  });
});
