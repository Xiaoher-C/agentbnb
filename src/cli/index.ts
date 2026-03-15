#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

import { createInterface } from 'node:readline';

import { loadConfig, saveConfig, getConfigDir } from './config.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../autonomy/tiers.js';
import { fetchRemoteCards, mergeResults } from './remote-registry.js';
import type { TaggedCard } from './remote-registry.js';
import { loadPeers, savePeer, removePeer, findPeer } from './peers.js';
import { detectApiKeys, detectOpenPorts, buildDraftCard, KNOWN_API_KEYS } from './onboarding.js';
import { CapabilityCardSchema } from '../types/index.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { searchCards, filterCards } from '../registry/matcher.js';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from '../credit/ledger.js';
import { AgentRuntime } from '../runtime/agent-runtime.js';
import { requestCapability } from '../gateway/client.js';
import { createGatewayServer } from '../gateway/server.js';
import { createRegistryServer } from '../registry/server.js';
import { announceGateway, discoverLocalAgents, stopAnnouncement } from '../discovery/mdns.js';
import type { CapabilityCard } from '../types/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

/**
 * Interactive confirm prompt using readline.
 * Returns true if user answers 'y' or 'Y', false otherwise.
 */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<boolean>((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  } finally {
    rl.close();
  }
}

/**
 * Detect the LAN (non-loopback) IPv4 address of this machine.
 * Falls back to 'localhost' if no external interface is found.
 */
function getLanIp(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const program = new Command();

program
  .name('agentbnb')
  .description('P2P Agent Capability Sharing Protocol — Airbnb for AI agent pipelines')
  .version(pkg.version);

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

program
  .command('init')
  .description('Initialize AgentBnB config and create agent identity')
  .option('--owner <name>', 'Agent owner name')
  .option('--port <port>', 'Gateway port', '7700')
  .option('--host <ip>', 'Override gateway host IP (default: auto-detected LAN IP)')
  .option('--yes', 'Auto-confirm all draft cards (non-interactive)')
  .option('--no-detect', 'Skip API key detection')
  .option('--json', 'Output as JSON')
  .action(async (opts: { owner?: string; port: string; host?: string; yes?: boolean; detect?: boolean; json?: boolean }) => {
    const owner = opts.owner ?? `agent-${randomBytes(4).toString('hex')}`;
    const token = randomBytes(32).toString('hex');
    const configDir = getConfigDir();
    const dbPath = join(configDir, 'registry.db');
    const creditDbPath = join(configDir, 'credit.db');
    const port = parseInt(opts.port, 10);
    const ip = opts.host ?? getLanIp();

    // Load existing config to preserve api_key on re-init (don't overwrite)
    const existingConfig = loadConfig();
    const api_key = existingConfig?.api_key ?? randomBytes(32).toString('hex');

    const config = {
      owner,
      gateway_url: `http://${ip}:${port}`,
      gateway_port: port,
      db_path: dbPath,
      credit_db_path: creditDbPath,
      token,
      api_key,
    };

    saveConfig(config);

    // Bootstrap credit ledger with 100 credits
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, owner, 100);
    creditDb.close();

    // --- Onboarding detection flow ---
    // Commander negates --no-detect into opts.detect (false when --no-detect is passed)
    const skipDetect = opts.detect === false;
    let detectedKeys: string[] = [];
    let detectedPorts: number[] = [];
    const publishedCards: Array<{ id: string; name: string }> = [];

    if (!skipDetect) {
      detectedKeys = detectApiKeys(KNOWN_API_KEYS);
      detectedPorts = await detectOpenPorts([7700, 7701, 8080, 3000, 8000, 11434]);

      if (detectedKeys.length > 0) {
        if (!opts.json) {
          console.log(`\nDetected ${detectedKeys.length} API key${detectedKeys.length > 1 ? 's' : ''}: ${detectedKeys.join(', ')}`);
        }

        if (detectedPorts.length > 0 && !opts.json) {
          console.log(`Found services on ports: ${detectedPorts.join(', ')}`);
        }

        // Build draft cards
        const drafts = detectedKeys
          .map((key) => buildDraftCard(key, owner))
          .filter((card): card is CapabilityCard => card !== null);

        if (opts.yes) {
          // Auto-publish all draft cards
          const db = openDatabase(dbPath);
          try {
            for (const card of drafts) {
              insertCard(db, card);
              publishedCards.push({ id: card.id, name: card.name });
              if (!opts.json) {
                console.log(`Published: ${card.name} (${card.id})`);
              }
            }
          } finally {
            db.close();
          }
        } else if (process.stdout.isTTY) {
          // Interactive confirmation for each draft card
          const db = openDatabase(dbPath);
          try {
            for (const card of drafts) {
              const yes = await confirm(`Publish "${card.name}"? [y/N] `);
              if (yes) {
                insertCard(db, card);
                publishedCards.push({ id: card.id, name: card.name });
                console.log(`Published: ${card.name} (${card.id})`);
              } else {
                console.log(`Skipped: ${card.name}`);
              }
            }
          } finally {
            db.close();
          }
        } else {
          // Non-TTY without --yes: skip publishing with notice
          if (!opts.json) {
            console.log('Non-interactive environment detected. Re-run with --yes to auto-publish draft cards.');
          }
        }
      } else {
        if (!opts.json) {
          console.log('\nNo API keys detected. You can manually publish cards with `agentbnb publish`.');
        }
      }
    }

    if (opts.json) {
      const jsonOutput: Record<string, unknown> = {
        success: true,
        owner,
        config_dir: configDir,
        token,
        gateway_url: config.gateway_url,
      };
      if (!skipDetect) {
        jsonOutput.detected_keys = detectedKeys;
        jsonOutput.published_cards = publishedCards;
      }
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      console.log(`AgentBnB initialized.`);
      console.log(`  Owner:   ${owner}`);
      console.log(`  Token:   ${token}`);
      console.log(`  Config:  ${configDir}/config.json`);
      console.log(`  Credits: 100 (starter grant)`);
      console.log(`  Gateway: http://${ip}:${port}`);
    }
  });

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

program
  .command('publish <card.json>')
  .description('Publish a Capability Card to the registry')
  .option('--json', 'Output as JSON')
  .action(async (cardPath: string, opts: { json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    let raw: string;
    try {
      raw = readFileSync(cardPath, 'utf-8');
    } catch {
      console.error(`Error: cannot read file: ${cardPath}`);
      process.exit(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('Error: invalid JSON in card file.');
      process.exit(1);
    }

    const result = CapabilityCardSchema.safeParse(parsed);
    if (!result.success) {
      if (opts.json) {
        console.log(JSON.stringify({ success: false, errors: result.error.issues }, null, 2));
      } else {
        console.error('Error: card validation failed:');
        for (const issue of result.error.issues) {
          console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        }
      }
      process.exit(1);
    }

    const db = openDatabase(config.db_path);
    try {
      insertCard(db, result.data);
    } finally {
      db.close();
    }

    if (opts.json) {
      console.log(JSON.stringify({ success: true, id: result.data.id, name: result.data.name }, null, 2));
    } else {
      console.log(`Published: ${result.data.name} (${result.data.id})`);
    }
  });

// ---------------------------------------------------------------------------
// discover
// ---------------------------------------------------------------------------

program
  .command('discover [query]')
  .description('Search available capabilities in the registry')
  .option('--level <level>', 'Filter by level (1, 2, or 3)')
  .option('--online', 'Only show online capabilities')
  .option('--local', 'Browse for agents on the local network via mDNS')
  .option('--registry <url>', 'Remote registry URL to query (e.g., http://host:7701)')
  .option('--tag <tag>', 'Filter by metadata tag')
  .option('--json', 'Output as JSON')
  .action(async (query: string | undefined, opts: { level?: string; online?: boolean; local?: boolean; registry?: string; tag?: string; json?: boolean }) => {
    // --local: browse mDNS instead of querying local registry
    if (opts.local) {
      const discovered: Array<{ name: string; url: string; owner: string }> = [];

      const browser = discoverLocalAgents((agent) => {
        discovered.push(agent);
      });

      // Wait 3 seconds for mDNS responses
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      browser.stop();

      if (opts.json) {
        console.log(JSON.stringify(discovered, null, 2));
        return;
      }

      if (discovered.length === 0) {
        console.log('No agents found on local network.');
        return;
      }

      const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
      console.log(col('Name', 24) + '  ' + col('URL', 32) + '  ' + col('Owner', 20));
      console.log('-'.repeat(80));
      for (const agent of discovered) {
        console.log(col(agent.name, 24) + '  ' + col(agent.url, 32) + '  ' + col(agent.owner, 20));
      }
      console.log(`\n${discovered.length} agent(s) found on local network`);
      return;
    }

    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const db = openDatabase(config.db_path);

    let localCards: CapabilityCard[];
    try {
      const level = opts.level ? (parseInt(opts.level, 10) as 1 | 2 | 3) : undefined;
      const filters = { level, online: opts.online };

      if (query && query.trim().length > 0) {
        localCards = searchCards(db, query, filters);
      } else {
        localCards = filterCards(db, filters);
      }
    } finally {
      db.close();
    }

    // Apply --tag client-side for local cards (local registry has no tag query param)
    if (opts.tag) {
      localCards = localCards.filter((c) => c.metadata?.tags?.includes(opts.tag!));
    }

    // Strip _internal from all local cards before output — private metadata must not be transmitted
    localCards = localCards.map(({ _internal: _, ...rest }) => rest as CapabilityCard);

    // Determine remote registry URL
    const registryUrl = opts.registry ?? config.registry ?? undefined;
    const isExplicitRegistry = Boolean(opts.registry);

    let outputCards: TaggedCard[] | CapabilityCard[];
    let hasRemote = false;

    if (registryUrl) {
      // Fetch remote cards and merge
      try {
        let remoteCards = await fetchRemoteCards(registryUrl, {
          q: query,
          level: opts.level ? parseInt(opts.level, 10) : undefined,
          online: opts.online,
          tag: opts.tag,
        });
        // Strip _internal from remote cards as well
        remoteCards = remoteCards.map(({ _internal: _, ...rest }) => rest as CapabilityCard);
        hasRemote = true;
        outputCards = mergeResults(localCards, remoteCards, Boolean(query && query.trim().length > 0));
      } catch (err) {
        if (isExplicitRegistry) {
          // Explicit --registry failure: print error and exit 1
          const msg = err instanceof Error ? err.message : String(err);
          console.error(msg);
          process.exit(1);
          return; // unreachable, satisfies TS definite assignment
        } else {
          // Config default failure: warn and degrade gracefully to local results
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Warning: ${msg}`);
          // Tag local cards as local and continue
          outputCards = localCards.map((c) => ({ ...c, source: 'local' as const }));
        }
      }
    } else {
      // No registry: local only
      outputCards = localCards;
    }

    if (opts.json) {
      console.log(JSON.stringify(outputCards, null, 2));
      return;
    }

    if (outputCards.length === 0) {
      console.log('No capabilities found.');
      return;
    }

    // Table output
    const col = (s: string, w: number) => s.slice(0, w).padEnd(w);

    if (hasRemote) {
      // Extended table with Source column
      console.log(
        col('ID', 16) + '  ' +
        col('Name', 28) + '  ' +
        col('Lvl', 3) + '  ' +
        col('Credits', 7) + '  ' +
        col('Online', 6) + '  ' +
        col('Source', 8)
      );
      console.log('-'.repeat(80));
      for (const card of outputCards as TaggedCard[]) {
        const shortId = card.id.slice(0, 8) + '...';
        const source = 'source' in card ? (card as TaggedCard).source : 'local';
        const sourceTag = source === 'remote' ? '[remote]' : '[local]';
        console.log(
          col(shortId, 16) + '  ' +
          col(card.name, 28) + '  ' +
          col(String(card.level), 3) + '  ' +
          col(String(card.pricing.credits_per_call), 7) + '  ' +
          col(card.availability.online ? 'yes' : 'no', 6) + '  ' +
          col(sourceTag, 8)
        );
      }
    } else {
      // Standard local-only table (preserved format)
      console.log(
        col('ID', 16) + '  ' +
        col('Name', 32) + '  ' +
        col('Lvl', 3) + '  ' +
        col('Credits', 7) + '  ' +
        col('Online', 6)
      );
      console.log('-'.repeat(72));
      for (const card of outputCards) {
        const shortId = card.id.slice(0, 8) + '...';
        console.log(
          col(shortId, 16) + '  ' +
          col(card.name, 32) + '  ' +
          col(String(card.level), 3) + '  ' +
          col(String(card.pricing.credits_per_call), 7) + '  ' +
          col(card.availability.online ? 'yes' : 'no', 6)
        );
      }
    }

    console.log(`\n${outputCards.length} result(s)`);
  });

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

program
  .command('request <card-id>')
  .description('Request a capability from another agent via the gateway')
  .option('--params <json>', 'Input parameters as JSON string', '{}')
  .option('--peer <name>', 'Peer name to send request to (resolves URL+token from peer registry)')
  .option('--json', 'Output as JSON')
  .action(async (cardId: string, opts: { params: string; peer?: string; json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(opts.params) as Record<string, unknown>;
    } catch {
      console.error('Error: --params must be valid JSON.');
      process.exit(1);
    }

    // Resolve gateway URL and token: use --peer if provided, otherwise use config
    let gatewayUrl: string;
    let token: string;

    if (opts.peer) {
      const peer = findPeer(opts.peer);
      if (!peer) {
        console.error(`Error: Peer not found: ${opts.peer}. Run \`agentbnb peers\` to see registered peers.`);
        process.exit(1);
      }
      gatewayUrl = peer.url;
      token = peer.token;
    } else {
      gatewayUrl = config.gateway_url;
      token = config.token;
    }

    try {
      const result = await requestCapability({
        gatewayUrl,
        token,
        cardId,
        params,
      });

      if (opts.json) {
        console.log(JSON.stringify({ success: true, result }, null, 2));
      } else {
        console.log('Result:');
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ success: false, error: msg }, null, 2));
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Show credit balance and recent transactions')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const creditDb = openCreditDb(config.credit_db_path);
    let balance: number;
    let transactions: ReturnType<typeof getTransactions>;
    let heldEscrows: Array<{ id: string; amount: number; card_id: string; created_at: string }>;

    try {
      balance = getBalance(creditDb, config.owner);
      transactions = getTransactions(creditDb, config.owner, 5);
      heldEscrows = creditDb
        .prepare('SELECT id, amount, card_id, created_at FROM credit_escrow WHERE owner = ? AND status = ?')
        .all(config.owner, 'held') as Array<{ id: string; amount: number; card_id: string; created_at: string }>;
    } finally {
      creditDb.close();
    }

    if (opts.json) {
      console.log(JSON.stringify({ owner: config.owner, balance, held_escrows: heldEscrows, recent_transactions: transactions }, null, 2));
      return;
    }

    console.log(`Owner:   ${config.owner}`);
    console.log(`Balance: ${balance} credits`);

    if (heldEscrows.length > 0) {
      console.log(`\nActive Escrows (${heldEscrows.length}):`);
      for (const e of heldEscrows) {
        console.log(`  ${e.id.slice(0, 8)}...  ${e.amount} credits  card=${e.card_id.slice(0, 8)}...`);
      }
    } else {
      console.log('Active Escrows: none');
    }

    if (transactions.length > 0) {
      console.log('\nRecent Transactions:');
      for (const tx of transactions) {
        const sign = tx.amount > 0 ? '+' : '';
        console.log(`  ${tx.created_at.slice(0, 19)}  ${sign}${tx.amount}  ${tx.reason}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

program
  .command('serve')
  .description('Start the AgentBnB gateway server')
  .option('--port <port>', 'Port to listen on (overrides config)')
  .option('--handler-url <url>', 'Local capability handler URL', 'http://localhost:8080')
  .option('--registry-port <port>', 'Public registry API port (0 to disable)', '7701')
  .option('--announce', 'Announce this gateway on the local network via mDNS')
  .action(async (opts: { port?: string; handlerUrl: string; registryPort: string; announce?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const port = opts.port ? parseInt(opts.port, 10) : config.gateway_port;
    const registryPort = parseInt(opts.registryPort, 10);

    const runtime = new AgentRuntime({
      registryDbPath: config.db_path,
      creditDbPath: config.credit_db_path,
      owner: config.owner,
    });
    await runtime.start();

    const server = createGatewayServer({
      port,
      registryDb: runtime.registryDb,
      creditDb: runtime.creditDb,
      tokens: [config.token],
      handlerUrl: opts.handlerUrl,
    });

    // Start public registry server if registry-port > 0
    let registryServer: ReturnType<typeof createRegistryServer> | null = null;

    const gracefulShutdown = async () => {
      console.log('\nShutting down...');
      if (opts.announce) {
        await stopAnnouncement();
      }
      if (registryServer) {
        await registryServer.close();
      }
      await server.close();
      await runtime.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => { void gracefulShutdown(); });
    process.on('SIGTERM', () => { void gracefulShutdown(); });

    try {
      await server.listen({ port, host: '0.0.0.0' });
      console.log(`Gateway running on port ${port}`);

      if (registryPort > 0) {
        if (!config.api_key) {
          console.warn('No API key found. Run `agentbnb init` to enable dashboard features.');
        }
        registryServer = createRegistryServer({
          registryDb: runtime.registryDb,
          silent: false,
          ownerName: config.owner,
          ownerApiKey: config.api_key,
          creditDb: runtime.creditDb,
        });
        await registryServer.listen({ port: registryPort, host: '0.0.0.0' });
        console.log(`Registry API: http://0.0.0.0:${registryPort}/cards`);
      }

      if (opts.announce) {
        announceGateway(config.owner, port);
        console.log('Announcing on local network via mDNS');
      }
    } catch (err) {
      console.error('Failed to start:', err);
      if (registryServer) {
        await registryServer.close().catch(() => {});
      }
      await runtime.shutdown();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

program
  .command('connect <name> <url> <token>')
  .description('Register a remote peer agent (store URL + token for reuse)')
  .option('--json', 'Output as JSON')
  .action(async (name: string, url: string, token: string, opts: { json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    savePeer({ name, url, token, added_at: new Date().toISOString() });

    if (opts.json) {
      console.log(JSON.stringify({ success: true, name, url }, null, 2));
    } else {
      console.log(`Connected to peer: ${name} at ${url}`);
    }
  });

// ---------------------------------------------------------------------------
// peers
// ---------------------------------------------------------------------------

const peersCommand = program
  .command('peers')
  .description('List registered peer agents');

peersCommand
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const peers = loadPeers();

    if (opts.json) {
      console.log(JSON.stringify(peers, null, 2));
      return;
    }

    if (peers.length === 0) {
      console.log('No peers registered. Use `agentbnb connect` to add one.');
      return;
    }

    const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
    console.log(col('Name', 20) + '  ' + col('URL', 36) + '  ' + col('Added', 20));
    console.log('-'.repeat(80));
    for (const peer of peers) {
      console.log(col(peer.name, 20) + '  ' + col(peer.url, 36) + '  ' + col(peer.added_at.slice(0, 19), 20));
    }
    console.log(`\n${peers.length} peer(s)`);
  });

peersCommand
  .command('remove <name>')
  .description('Remove a registered peer')
  .action(async (name: string) => {
    const removed = removePeer(name);
    if (removed) {
      console.log(`Peer removed: ${name}`);
    } else {
      console.error(`Peer not found: ${name}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const configCmd = program
  .command('config')
  .description('Get or set AgentBnB configuration values');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key: string, value: string) => {
    const allowedKeys = ['registry', 'tier1', 'tier2'];
    if (!allowedKeys.includes(key)) {
      console.error(`Unknown config key: ${key}. Valid keys: ${allowedKeys.join(', ')}`);
      process.exit(1);
    }

    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    if (key === 'tier1' || key === 'tier2') {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) {
        console.error(`Error: ${key} must be a non-negative integer, got: ${value}`);
        process.exit(1);
      }

      // Initialize autonomy config from defaults if not yet set
      if (!config.autonomy) {
        config.autonomy = { ...DEFAULT_AUTONOMY_CONFIG };
      }

      if (key === 'tier1') {
        config.autonomy.tier1_max_credits = parsed;
        if (parsed >= config.autonomy.tier2_max_credits && config.autonomy.tier2_max_credits > 0) {
          console.warn(
            `Warning: tier1 (${parsed}) >= tier2 (${config.autonomy.tier2_max_credits}). ` +
              `Tier 2 will never be reached — consider increasing tier2.`
          );
        }
        saveConfig(config);
        console.log(`Set tier1 = ${parsed} (auto-execute threshold: <${parsed} credits)`);
      } else {
        config.autonomy.tier2_max_credits = parsed;
        if (config.autonomy.tier1_max_credits >= parsed && parsed > 0) {
          console.warn(
            `Warning: tier2 (${parsed}) <= tier1 (${config.autonomy.tier1_max_credits}). ` +
              `Tier 2 will never be reached — consider decreasing tier1.`
          );
        }
        saveConfig(config);
        console.log(`Set tier2 = ${parsed} (notify threshold: <${parsed} credits)`);
      }
      return;
    }

    (config as unknown as Record<string, unknown>)[key] = value;
    saveConfig(config);
    console.log(`Set ${key} = ${value}`);
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key: string) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    if (key === 'tier1') {
      console.log(String(config.autonomy?.tier1_max_credits ?? 0));
      return;
    }

    if (key === 'tier2') {
      console.log(String(config.autonomy?.tier2_max_credits ?? 0));
      return;
    }

    const value = (config as unknown as Record<string, unknown>)[key];
    console.log(value !== undefined ? String(value) : '(not set)');
  });

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

await program.parseAsync(process.argv);
