import Fastify from 'fastify';
import cors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadAdapterConfig } from './config.js';
import { ensureServiceAccount } from './auth/service-account.js';
import { registerSearchSkillsTool } from './tools/search-skills.js';
import { registerRentSkillTool } from './tools/rent-skill.js';
import { registerGetResultTool } from './tools/get-result.js';

const VERSION = '0.1.0';

/**
 * Create and configure the Fastify server with MCP transport.
 */
export async function buildServer() {
  const config = loadAdapterConfig();
  const app = Fastify({ logger: true });

  // Initialize service-account identity (generates Ed25519 keypair on first boot)
  const serviceAccount = ensureServiceAccount(config.keystorePath, config.serviceAccountOwner);
  app.log.info(`Service account: ${serviceAccount.did} (agent_id: ${serviceAccount.agentId})`);

  await app.register(cors);

  // --- Health endpoint ---
  app.get('/health', async () => {
    return {
      status: 'ok',
      version: VERSION,
      uptime: process.uptime(),
      service_account: { did: serviceAccount.did, agent_id: serviceAccount.agentId },
    };
  });

  // --- MCP server setup ---
  const mcpServer = new McpServer(
    { name: 'agentbnb-managed-agents-adapter', version: VERSION },
    { capabilities: { tools: {} } },
  );

  registerSearchSkillsTool(mcpServer, config);
  registerRentSkillTool(mcpServer, config);
  registerGetResultTool(mcpServer, config);

  // Session tracking for billing guardrail
  const sessions = new Map<string, { costAccumulated: number }>();

  // --- MCP transport routes ---
  app.post('/mcp', async (request, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { costAccumulated: 0 });
      },
    });

    await mcpServer.connect(transport);

    // Delegate to the transport, which writes directly to the raw response
    await transport.handleRequest(request.raw, reply.raw, request.body);

    // Mark reply as sent since transport wrote directly
    reply.hijack();
  });

  app.get('/mcp', async (request, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw);
    reply.hijack();
  });

  app.delete('/mcp', async (request, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw);
    reply.hijack();
  });

  return { app, config, mcpServer, sessions };
}

/**
 * Start the adapter server.
 */
async function main() {
  const { app, config } = await buildServer();

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down adapter...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`AgentBnB Managed Agents Adapter running on port ${config.port}`);
}

// Only start the server when run directly (not when imported by tests)
const isDirectRun =
  process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');

if (isDirectRun) {
  main().catch((err) => {
    console.error('Failed to start adapter:', err);
    process.exit(1);
  });
}
