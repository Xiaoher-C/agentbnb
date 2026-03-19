/**
 * Tests for the AgentBnB MCP server and tool handlers.
 *
 * Tests tool handler logic directly (without starting MCP transport)
 * to verify correct behavior of each tool.
 */

import { describe, it, expect } from 'vitest';
import type { McpServerContext } from './server.js';
import type { AgentBnBConfig } from '../cli/config.js';
import type { AgentIdentity } from '../identity/identity.js';

// ---------------------------------------------------------------------------
// Shared mock context
// ---------------------------------------------------------------------------

function createMockContext(overrides?: Partial<AgentBnBConfig>): McpServerContext {
  const config: AgentBnBConfig = {
    owner: 'test-agent',
    gateway_url: 'http://localhost:7700',
    gateway_port: 7700,
    db_path: ':memory:',
    credit_db_path: ':memory:',
    token: 'test-token',
    registry: 'http://localhost:7701',
    ...overrides,
  };

  const identity: AgentIdentity = {
    agent_id: 'abc123def456',
    owner: 'test-agent',
    public_key: 'deadbeef'.repeat(8),
    created_at: new Date().toISOString(),
  };

  return {
    configDir: '/tmp/test-agentbnb',
    config,
    identity,
  };
}

// ---------------------------------------------------------------------------
// Module existence tests
// ---------------------------------------------------------------------------

describe('MCP server exports', () => {
  it('startMcpServer is a function', async () => {
    const mod = await import('./server.js');
    expect(typeof mod.startMcpServer).toBe('function');
  });

  it('barrel export re-exports startMcpServer', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.startMcpServer).toBe('function');
  });
});

describe('MCP tool registration functions', () => {
  it('registerDiscoverTool is a function', async () => {
    const mod = await import('./tools/discover.js');
    expect(typeof mod.registerDiscoverTool).toBe('function');
    expect(typeof mod.handleDiscover).toBe('function');
  });

  it('registerStatusTool is a function', async () => {
    const mod = await import('./tools/status.js');
    expect(typeof mod.registerStatusTool).toBe('function');
    expect(typeof mod.handleStatus).toBe('function');
  });

  it('registerPublishTool is a function', async () => {
    const mod = await import('./tools/publish.js');
    expect(typeof mod.registerPublishTool).toBe('function');
    expect(typeof mod.handlePublish).toBe('function');
  });

  it('registerRequestTool is a function', async () => {
    const mod = await import('./tools/request.js');
    expect(typeof mod.registerRequestTool).toBe('function');
    expect(typeof mod.handleRequest).toBe('function');
  });

  it('registerConductTool is a function', async () => {
    const mod = await import('./tools/conduct.js');
    expect(typeof mod.registerConductTool).toBe('function');
    expect(typeof mod.handleConduct).toBe('function');
  });

  it('registerServeSkillTool is a function', async () => {
    const mod = await import('./tools/serve-skill.js');
    expect(typeof mod.registerServeSkillTool).toBe('function');
    expect(typeof mod.handleServeSkill).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Discover tool handler tests
// ---------------------------------------------------------------------------

describe('agentbnb_discover handler', () => {
  it('returns JSON content with results array', async () => {
    const { handleDiscover } = await import('./tools/discover.js');
    const ctx = createMockContext({ registry: undefined });

    // With :memory: DB, searchCards will work on empty DB
    const result = await handleDiscover({ query: 'test' }, ctx);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text) as { results?: unknown[]; count?: number; success?: boolean; error?: string };
    // Either returns results (possibly empty) or error
    if (parsed.results !== undefined) {
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    } else {
      // :memory: DB won't have FTS tables, may error
      expect(parsed.success).toBe(false);
    }
  });

  it('never throws — returns error as JSON content', async () => {
    const { handleDiscover } = await import('./tools/discover.js');
    // Invalid db_path will cause error
    const ctx = createMockContext({ db_path: '/nonexistent/path/db.sqlite' });

    const result = await handleDiscover({ query: 'test' }, ctx);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean };
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status tool handler tests — uses local fallback
// ---------------------------------------------------------------------------

describe('agentbnb_status handler', () => {
  it('returns identity info in output', async () => {
    const { handleStatus } = await import('./tools/status.js');
    // No registry — will use local credit DB
    const ctx = createMockContext({ registry: undefined });

    const result = await handleStatus(ctx);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed['agent_id']).toBe('abc123def456');
    expect(parsed['owner']).toBe('test-agent');
    expect(parsed['registry_url']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Publish tool handler tests
// ---------------------------------------------------------------------------

describe('agentbnb_publish handler', () => {
  it('rejects invalid JSON', async () => {
    const { handlePublish } = await import('./tools/publish.js');
    const ctx = createMockContext();

    const result = await handlePublish({ card_json: 'not-json' }, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Invalid JSON');
  });

  it('rejects card that fails validation', async () => {
    const { handlePublish } = await import('./tools/publish.js');
    const ctx = createMockContext();

    const result = await handlePublish({ card_json: '{"foo":"bar"}' }, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Card validation failed');
  });
});

// ---------------------------------------------------------------------------
// Conduct tool handler tests
// ---------------------------------------------------------------------------

describe('agentbnb_conduct handler', () => {
  it('handles "no matching template" gracefully', async () => {
    const { handleConduct } = await import('./tools/conduct.js');
    const ctx = createMockContext();

    // conductAction returns { success: false, error: 'No matching template...' } for unknown tasks
    const result = await handleConduct({ task: 'xyzzy-unknown-task-12345' }, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean };

    // Should return a result (not throw)
    expect(result.content).toHaveLength(1);
    expect(typeof parsed.success).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Request tool handler tests
// ---------------------------------------------------------------------------

describe('agentbnb_request handler', () => {
  it('returns error when neither query nor card_id provided', async () => {
    const { handleRequest } = await import('./tools/request.js');
    const ctx = createMockContext();

    const result = await handleRequest({}, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean; error: string };

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Provide either query or card_id');
  });

  it('returns error for card_id not found locally without registry', async () => {
    const { handleRequest } = await import('./tools/request.js');
    const ctx = createMockContext({ registry: undefined });

    const result = await handleRequest({ card_id: 'nonexistent-card' }, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean; error: string };

    expect(parsed.success).toBe(false);
    // Either "card not found" or DB error — both are error responses
    expect(typeof parsed.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Serve-skill tool handler tests
// ---------------------------------------------------------------------------

describe('agentbnb_serve_skill handler', () => {
  it('returns error when no registry is configured', async () => {
    const { handleServeSkill } = await import('./tools/serve-skill.js');
    const ctx = createMockContext({ registry: undefined });

    const result = await handleServeSkill({}, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as { success: boolean; error: string };

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('No remote registry configured');
  });
});
