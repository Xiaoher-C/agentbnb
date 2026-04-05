/**
 * AgentBnB MCP Server
 *
 * Exposes AgentBnB as 6 MCP tools over stdio transport.
 * Enables Claude Code, Cursor, Windsurf, and Cline to interact with the
 * AgentBnB network natively.
 *
 * IMPORTANT: All logging goes to stderr. stdout is reserved for MCP JSON-RPC protocol.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, getConfigDir } from '../cli/config.js';
import { ensureIdentity } from '../identity/identity.js';
import type { AgentBnBConfig } from '../cli/config.js';
import type { AgentIdentity } from '../identity/identity.js';
import type { RelayClient } from '../relay/websocket-client.js';

import { registerDiscoverTool } from './tools/discover.js';
import { registerStatusTool } from './tools/status.js';
import { registerPublishTool } from './tools/publish.js';

/** Package version — injected at build time, falls back for dev mode. */
const VERSION =
  typeof AGENTBNB_VERSION !== 'undefined' ? AGENTBNB_VERSION : '0.0.0-dev';

/**
 * Shared context passed to all MCP tool handlers.
 * Holds config, identity, and configDir for lazy resource access.
 */
export interface McpServerContext {
  /** Path to the ~/.agentbnb/ config directory. */
  configDir: string;
  /** Loaded agent configuration. */
  config: AgentBnBConfig;
  /** Agent identity (auto-created if not present). */
  identity: AgentIdentity;
  /** Active relay client for serve_skill tool (set at runtime). */
  relayClient?: RelayClient;
}

/**
 * Starts the AgentBnB MCP server over stdio transport.
 * Loads config, ensures identity, registers all 6 tools, and connects.
 *
 * @returns Promise that resolves when the server is connected and ready.
 */
export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    process.stderr.write('Error: AgentBnB not initialized. Run `agentbnb init` first.\n');
    process.exit(1);
  }

  const configDir = getConfigDir();
  const identity = ensureIdentity(configDir, config.owner);

  const server = new McpServer({
    name: 'agentbnb',
    version: VERSION,
  });

  const ctx: McpServerContext = {
    configDir,
    config,
    identity,
  };

  // Register all 6 tools
  registerDiscoverTool(server, ctx);
  registerStatusTool(server, ctx);
  registerPublishTool(server, ctx);

  // Action tools imported dynamically to avoid circular deps at module load
  const { registerRequestTool } = await import('./tools/request.js');
  const { registerConductTool } = await import('./tools/conduct.js');
  const { registerServeSkillTool } = await import('./tools/serve-skill.js');

  registerRequestTool(server, ctx);
  registerConductTool(server, ctx);
  registerServeSkillTool(server, ctx);

  // Session tools (agent-to-agent interactive sessions)
  const { registerSessionOpenTool, registerSessionSendTool, registerSessionEndTool } = await import('./tools/session.js');
  registerSessionOpenTool(server, ctx);
  registerSessionSendTool(server, ctx);
  registerSessionEndTool(server, ctx);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`AgentBnB MCP server started (owner: ${identity.owner})\n`);

  // Graceful shutdown
  const shutdown = (): void => {
    ctx.relayClient?.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
