#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { loadConfig, saveConfig, getConfigDir } from './config.js';
import { CapabilityCardSchema } from '../types/index.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { searchCards, filterCards } from '../registry/matcher.js';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from '../credit/ledger.js';
import { requestCapability } from '../gateway/client.js';
import { createGatewayServer } from '../gateway/server.js';
import type { CapabilityCard } from '../types/index.js';

const program = new Command();

program
  .name('agentbnb')
  .description('P2P Agent Capability Sharing Protocol — Airbnb for AI agent pipelines')
  .version('0.0.1');

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
  .option('--json', 'Output as JSON')
  .action(async (query: string | undefined, opts: { level?: string; online?: boolean; json?: boolean }) => {
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
  .option('--json', 'Output as JSON')
  .action(async (cardId: string, opts: { params: string; json?: boolean }) => {
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

    try {
      const result = await requestCapability({
        gatewayUrl: config.gateway_url,
        token: config.token,
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
  .action(async (opts: { port?: string; handlerUrl: string }) => {
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
    } catch (err) {
      console.error('Failed to start gateway:', err);
      registryDb.close();
      creditDb.close();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

await program.parseAsync(process.argv);
