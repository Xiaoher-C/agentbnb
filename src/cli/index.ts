#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { loadConfig, saveConfig, getConfigDir } from './config.js';
import { loadPeers, savePeer, removePeer, findPeer } from './peers.js';
import { CapabilityCardSchema } from '../types/index.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { searchCards, filterCards } from '../registry/matcher.js';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from '../credit/ledger.js';
import { requestCapability } from '../gateway/client.js';
import { createGatewayServer } from '../gateway/server.js';
import { announceGateway, discoverLocalAgents, stopAnnouncement } from '../discovery/mdns.js';
import type { CapabilityCard } from '../types/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

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
  .option('--json', 'Output as JSON')
  .action(async (opts: { owner?: string; port: string; json?: boolean }) => {
    const owner = opts.owner ?? `agent-${randomBytes(4).toString('hex')}`;
    const token = randomBytes(32).toString('hex');
    const configDir = getConfigDir();
    const dbPath = join(configDir, 'registry.db');
    const creditDbPath = join(configDir, 'credit.db');
    const port = parseInt(opts.port, 10);

    const config = {
      owner,
      gateway_url: `http://localhost:${port}`,
      gateway_port: port,
      db_path: dbPath,
      credit_db_path: creditDbPath,
      token,
    };

    saveConfig(config);

    // Bootstrap credit ledger with 100 credits
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, owner, 100);
    creditDb.close();

    if (opts.json) {
      console.log(JSON.stringify({ success: true, owner, config_dir: configDir, token }, null, 2));
    } else {
      console.log(`AgentBnB initialized.`);
      console.log(`  Owner:   ${owner}`);
      console.log(`  Token:   ${token}`);
      console.log(`  Config:  ${configDir}/config.json`);
      console.log(`  Credits: 100 (starter grant)`);
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
  .option('--json', 'Output as JSON')
  .action(async (query: string | undefined, opts: { level?: string; online?: boolean; local?: boolean; json?: boolean }) => {
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

    let cards: CapabilityCard[];
    try {
      const level = opts.level ? (parseInt(opts.level, 10) as 1 | 2 | 3) : undefined;
      const filters = { level, online: opts.online };

      if (query && query.trim().length > 0) {
        cards = searchCards(db, query, filters);
      } else {
        cards = filterCards(db, filters);
      }
    } finally {
      db.close();
    }

    if (opts.json) {
      console.log(JSON.stringify(cards, null, 2));
      return;
    }

    if (cards.length === 0) {
      console.log('No capabilities found.');
      return;
    }

    // Table output
    const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
    console.log(
      col('ID', 16) + '  ' +
      col('Name', 32) + '  ' +
      col('Lvl', 3) + '  ' +
      col('Credits', 7) + '  ' +
      col('Online', 6)
    );
    console.log('-'.repeat(72));
    for (const card of cards) {
      const shortId = card.id.slice(0, 8) + '...';
      console.log(
        col(shortId, 16) + '  ' +
        col(card.name, 32) + '  ' +
        col(String(card.level), 3) + '  ' +
        col(String(card.pricing.credits_per_call), 7) + '  ' +
        col(card.availability.online ? 'yes' : 'no', 6)
      );
    }
    console.log(`\n${cards.length} result(s)`);
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
  .option('--announce', 'Announce this gateway on the local network via mDNS')
  .action(async (opts: { port?: string; handlerUrl: string; announce?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const port = opts.port ? parseInt(opts.port, 10) : config.gateway_port;
    const registryDb = openDatabase(config.db_path);
    const creditDb = openCreditDb(config.credit_db_path);

    const server = createGatewayServer({
      port,
      registryDb,
      creditDb,
      tokens: [config.token],
      handlerUrl: opts.handlerUrl,
    });

    const gracefulShutdown = async () => {
      console.log('\nShutting down gateway...');
      if (opts.announce) {
        await stopAnnouncement();
      }
      await server.close();
      registryDb.close();
      creditDb.close();
      process.exit(0);
    };

    process.on('SIGINT', () => { void gracefulShutdown(); });
    process.on('SIGTERM', () => { void gracefulShutdown(); });

    try {
      await server.listen({ port, host: '0.0.0.0' });
      console.log(`Gateway running on port ${port}`);

      if (opts.announce) {
        announceGateway(config.owner, port);
        console.log('Announcing on local network via mDNS');
      }
    } catch (err) {
      console.error('Failed to start gateway:', err);
      registryDb.close();
      creditDb.close();
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
// Execute
// ---------------------------------------------------------------------------

await program.parseAsync(process.argv);
