#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { networkInterfaces, homedir } from 'node:os';

import { createInterface } from 'node:readline';

import { loadConfig, saveConfig, getConfigDir } from './config.js';
import { ensureIdentity } from '../identity/identity.js';
import { generateKeyPair, saveKeyPair, loadKeyPair } from '../credit/signing.js';
import { createSignedEscrowReceipt } from '../credit/escrow-receipt.js';
import { settleRequesterEscrow, releaseRequesterEscrow } from '../credit/settlement.js';
import { DEFAULT_AUTONOMY_CONFIG } from '../autonomy/tiers.js';
import { IdleMonitor } from '../autonomy/idle-monitor.js';
import { BudgetManager, DEFAULT_BUDGET_CONFIG } from '../credit/budget.js';
import { AutoRequestor } from '../autonomy/auto-request.js';
import { fetchRemoteCards, mergeResults } from './remote-registry.js';
import type { TaggedCard } from './remote-registry.js';
import { loadPeers, savePeer, removePeer, findPeer } from './peers.js';
import { detectOpenPorts, buildDraftCard } from './onboarding.js';
import { detectCapabilities, capabilitiesToV2Card, interactiveTemplateMenu } from '../onboarding/index.js';
import { AnyCardSchema } from '../types/index.js';
import { openDatabase, insertCard, listCards } from '../registry/store.js';
import { searchCards, filterCards } from '../registry/matcher.js';
import { getPricingStats } from '../registry/pricing.js';
import { openCreditDb, getBalance, bootstrapAgent, getTransactions } from '../credit/ledger.js';
import { createLedger } from '../credit/create-ledger.js';
import { AgentRuntime } from '../runtime/agent-runtime.js';
import { requestCapability } from '../gateway/client.js';
import { createGatewayServer } from '../gateway/server.js';
import { createRegistryServer } from '../registry/server.js';
import { announceGateway, discoverLocalAgents, stopAnnouncement } from '../discovery/mdns.js';
import type { CapabilityCard } from '../types/index.js';
import {
  publishFromSoulV2,
  generateHeartbeatSection,
  injectHeartbeatSection,
  getOpenClawStatus,
} from '../openclaw/index.js';

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
 * Loads Ed25519 identity auth credentials, auto-generating keypair/identity if missing.
 * Returns IdentityAuth for use with remote gateway requests.
 */
function loadIdentityAuth(owner: string): import('../gateway/client.js').IdentityAuth {
  const configDir = getConfigDir();

  // Ensure keypair exists (may be missing on machines initialized with older versions)
  let keys: import('../credit/signing.js').KeyPair;
  try {
    keys = loadKeyPair(configDir);
  } catch {
    keys = generateKeyPair();
    saveKeyPair(configDir, keys);
  }

  // Ensure identity exists
  const identity = ensureIdentity(configDir, owner);

  return {
    agentId: identity.agent_id,
    publicKey: identity.public_key,
    privateKey: keys.privateKey,
  };
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
  .option('--from <file>', 'Parse a specific file for capability detection')
  .option('--json', 'Output as JSON')
  .action(async (opts: { owner?: string; port: string; host?: string; yes?: boolean; detect?: boolean; from?: string; json?: boolean }) => {
    const owner = opts.owner ?? `agent-${randomBytes(4).toString('hex')}`;
    const token = randomBytes(32).toString('hex');
    const configDir = getConfigDir();
    const dbPath = join(configDir, 'registry.db');
    const creditDbPath = join(configDir, 'credit.db');
    const port = parseInt(opts.port, 10);
    const ip = opts.host ?? getLanIp();

    // Merge with existing config to preserve user-set values (registry, autonomy, budget, etc.)
    const existingConfig = loadConfig();

    const config = {
      ...existingConfig,               // Preserve all existing keys (registry, autonomy, budget, etc.)
      owner,
      gateway_url: `http://${ip}:${port}`,
      gateway_port: port,
      db_path: dbPath,
      credit_db_path: creditDbPath,
      token: existingConfig?.token ?? token,       // Preserve existing token
      api_key: existingConfig?.api_key ?? randomBytes(32).toString('hex'),
    };

    saveConfig(config);

    // Generate Ed25519 keypair (idempotent — preserves existing keypair)
    let keypairStatus = 'existing';
    try {
      loadKeyPair(configDir);
    } catch {
      const keys = generateKeyPair();
      saveKeyPair(configDir, keys);
      keypairStatus = 'generated';
    }

    // Create or load agent identity (idempotent — preserves existing identity)
    const identity = ensureIdentity(configDir, owner);

    // Bootstrap credit ledger with 100 credits (local always)
    const creditDb = openCreditDb(creditDbPath);
    bootstrapAgent(creditDb, owner, 100);
    creditDb.close();

    // If a Registry is configured, also grant 50 credits on Registry
    let registryBalance: number | undefined;
    if (existingConfig?.registry) {
      try {
        const identityAuth = loadIdentityAuth(owner);
        const ledger = createLedger({
          registryUrl: existingConfig.registry,
          ownerPublicKey: identityAuth.publicKey,
          privateKey: identityAuth.privateKey,
        });
        await ledger.grant(owner, 50);
        registryBalance = await ledger.getBalance(owner);
      } catch (err) {
        console.warn(`Warning: could not connect to Registry for credit grant: ${(err as Error).message}`);
      }
    }

    // --- Smart onboarding detection flow ---
    // Commander negates --no-detect into opts.detect (false when --no-detect is passed)
    const skipDetect = opts.detect === false;
    const publishedCards: Array<{ id: string; name: string }> = [];
    let detectedSource = 'none';

    if (!skipDetect) {
      if (!opts.json) {
        console.log('\nDetecting capabilities...');
      }

      const result = detectCapabilities({ fromFile: opts.from, cwd: process.cwd() });
      detectedSource = result.source;

      if (result.source === 'soul') {
        // SOUL.md — use existing publishFromSoulV2 flow
        if (!opts.json) {
          console.log(`  Found SOUL.md — extracting capabilities...`);
        }
        const db = openDatabase(dbPath);
        try {
          const card = publishFromSoulV2(db, result.soulContent!, owner);
          publishedCards.push({ id: card.id, name: card.agent_name });
          if (!opts.json) {
            console.log(`  Published v2.0 card: ${card.agent_name} (${card.skills.length} skills)`);
          }
        } finally {
          db.close();
        }
      } else if (result.source === 'docs') {
        // Doc file (CLAUDE.md, AGENTS.md, README.md, or --from) — build v2.0 card
        if (!opts.json) {
          console.log(`  Found ${result.sourceFile ?? 'docs'} — detected ${result.capabilities.length} capabilities:`);
          for (const cap of result.capabilities) {
            console.log(`    ${cap.name} (${cap.category}, cr ${cap.credits_per_call}/call)`);
          }
        }

        const card = capabilitiesToV2Card(result.capabilities, owner);

        if (opts.yes) {
          const db = openDatabase(dbPath);
          try {
            db.prepare(
              `INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`
            ).run(card.id, card.owner, JSON.stringify(card), card.created_at, card.updated_at);
            publishedCards.push({ id: card.id, name: card.agent_name });
            if (!opts.json) {
              console.log(`  Published v2.0 card: ${card.agent_name} (${card.skills.length} skills)`);
            }
          } finally {
            db.close();
          }
        } else if (process.stdout.isTTY) {
          const yes = await confirm(`\nPublish these ${card.skills.length} capabilities? [y/N] `);
          if (yes) {
            const db = openDatabase(dbPath);
            try {
              db.prepare(
                `INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`
              ).run(card.id, card.owner, JSON.stringify(card), card.created_at, card.updated_at);
              publishedCards.push({ id: card.id, name: card.agent_name });
              console.log(`  Published v2.0 card: ${card.agent_name} (${card.skills.length} skills)`);
            } finally {
              db.close();
            }
          } else {
            console.log('  Skipped publishing.');
          }
        } else {
          if (!opts.json) {
            console.log('  Non-interactive environment. Re-run with --yes to auto-publish.');
          }
        }
      } else if (result.source === 'env') {
        // Environment variables — use existing v1.0 buildDraftCard flow
        const detectedKeys = result.envKeys ?? [];
        if (!opts.json) {
          console.log(`  Detected ${detectedKeys.length} API key${detectedKeys.length > 1 ? 's' : ''}: ${detectedKeys.join(', ')}`);
        }

        const detectedPorts = await detectOpenPorts([7700, 7701, 8080, 3000, 8000, 11434]);
        if (detectedPorts.length > 0 && !opts.json) {
          console.log(`  Found services on ports: ${detectedPorts.join(', ')}`);
        }

        const drafts = detectedKeys
          .map((key) => buildDraftCard(key, owner))
          .filter((card): card is CapabilityCard => card !== null);

        if (opts.yes) {
          const db = openDatabase(dbPath);
          try {
            for (const card of drafts) {
              insertCard(db, card);
              publishedCards.push({ id: card.id, name: card.name });
              if (!opts.json) {
                console.log(`  Published: ${card.name} (${card.id})`);
              }
            }
          } finally {
            db.close();
          }
        } else if (process.stdout.isTTY) {
          const db = openDatabase(dbPath);
          try {
            for (const card of drafts) {
              const yes = await confirm(`Publish "${card.name}"? [y/N] `);
              if (yes) {
                insertCard(db, card);
                publishedCards.push({ id: card.id, name: card.name });
                console.log(`  Published: ${card.name} (${card.id})`);
              } else {
                console.log(`  Skipped: ${card.name}`);
              }
            }
          } finally {
            db.close();
          }
        } else {
          if (!opts.json) {
            console.log('  Non-interactive environment. Re-run with --yes to auto-publish.');
          }
        }
      } else {
        // Nothing auto-detected — try interactive fallback
        if (process.stdout.isTTY && !opts.yes && !opts.json) {
          const selected = await interactiveTemplateMenu();
          if (selected.length > 0) {
            const card = capabilitiesToV2Card(selected, owner);
            const db = openDatabase(dbPath);
            try {
              db.prepare(
                `INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`
              ).run(card.id, card.owner, JSON.stringify(card), card.created_at, card.updated_at);
              publishedCards.push({ id: card.id, name: card.agent_name });
              console.log(`\n  Published v2.0 card: ${card.agent_name} (${card.skills.length} skills)`);
            } finally {
              db.close();
            }
          }
        } else if (!opts.json) {
          console.log('  No capabilities detected. You can manually publish with `agentbnb publish`.');
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
        keypair: keypairStatus,
        agent_id: identity.agent_id,
      };
      if (registryBalance !== undefined) {
        jsonOutput.registry_balance = registryBalance;
      }
      if (!skipDetect) {
        jsonOutput.detected_source = detectedSource;
        jsonOutput.published_cards = publishedCards;
      }
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      console.log(`AgentBnB initialized.`);
      console.log(`  Owner:   ${owner}`);
      console.log(`  Token:   ${token}`);
      console.log(`  Config:  ${configDir}/config.json`);
      if (registryBalance !== undefined) {
        console.log(`  Registry balance: ${registryBalance} credits`);
      } else {
        console.log(`  Credits: 100 (starter grant)`);
      }
      console.log(`  Keypair: ${keypairStatus === 'generated' ? 'generated (Ed25519)' : 'preserved (existing)'}`);
      console.log(`  Agent ID: ${identity.agent_id}`);
      console.log(`  Gateway: http://${ip}:${port}`);
    }
  });

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

program
  .command('publish <card.json>')
  .description('Publish a Capability Card to the registry (v1.0 or v2.0)')
  .option('--json', 'Output as JSON')
  .option('--registry <url>', 'POST card to a remote registry URL instead of local DB')
  .action(async (cardPath: string, opts: { json?: boolean; registry?: string }) => {
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

    // Default spec_version to '1.0' if missing (AnyCardSchema requires discriminator)
    if (typeof parsed === 'object' && parsed !== null && !('spec_version' in parsed)) {
      (parsed as Record<string, unknown>).spec_version = '1.0';
    }

    const result = AnyCardSchema.safeParse(parsed);
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

    const card = result.data;
    const cardName = card.spec_version === '2.0'
      ? (card as import('../types/index.js').CapabilityCardV2).agent_name
      : card.name;

    // Enforce minimum price: credits_per_call must be >= 1
    if (card.spec_version === '2.0') {
      const v2card = card as import('../types/index.js').CapabilityCardV2;
      const invalidSkill = v2card.skills?.find((s) => s.pricing.credits_per_call < 1);
      if (invalidSkill) {
        if (opts.json) {
          console.log(JSON.stringify({ success: false, error: 'Minimum price is 1 credit per call', skill_id: invalidSkill.id }, null, 2));
        } else {
          console.error(`Error: Minimum price is 1 credit per call (skill "${invalidSkill.id}" has credits_per_call=${invalidSkill.pricing.credits_per_call})`);
        }
        process.exit(1);
      }
    } else {
      if (card.pricing.credits_per_call < 1) {
        if (opts.json) {
          console.log(JSON.stringify({ success: false, error: 'Minimum price is 1 credit per call' }, null, 2));
        } else {
          console.error(`Error: Minimum price is 1 credit per call (card has credits_per_call=${card.pricing.credits_per_call})`);
        }
        process.exit(1);
      }
    }

    // Always publish to local DB
    const db = openDatabase(config.db_path);
    try {
      if (card.spec_version === '2.0') {
        const now = new Date().toISOString();
        const cardWithTimestamps = { ...card, created_at: card.created_at ?? now, updated_at: now };
        db.prepare(
          'INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(cardWithTimestamps.id, cardWithTimestamps.owner, JSON.stringify(cardWithTimestamps), cardWithTimestamps.created_at, cardWithTimestamps.updated_at);
      } else {
        insertCard(db, card);
      }
    } finally {
      db.close();
    }

    if (!opts.json) {
      console.log(`Published locally: ${cardName} (${card.id})`);
    }

    // Also POST to remote registry if configured (explicit --registry or config.registry)
    const registryUrl = opts.registry ?? config.registry;
    let remoteSuccess = false;
    if (registryUrl) {
      const url = `${registryUrl.replace(/\/$/, '')}/cards`;
      // Inject gateway_url so remote agents know where to send requests
      const remoteCard = { ...card, gateway_url: config.gateway_url };
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remoteCard),
        });
        if (!response.ok) {
          const body = await response.text();
          console.error(`Warning: remote registry returned ${response.status}: ${body}`);
        } else {
          remoteSuccess = true;
          if (!opts.json) {
            console.log(`Published to registry: ${url}`);
          }
        }
      } catch (err) {
        console.error(`Warning: cannot reach registry at ${url}: ${(err as Error).message}`);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({
        success: true,
        id: card.id,
        name: cardName,
        ...(registryUrl ? { registry: registryUrl, remote_published: remoteSuccess } : {}),
      }, null, 2));
    } else if (!registryUrl) {
      // No remote configured — hint about it
    }
  });

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

program
  .command('sync')
  .description('Push all local capability cards to the configured remote registry')
  .option('--registry <url>', 'Remote registry URL (overrides config.registry)')
  .option('--json', 'Output as JSON')
  .action(async (opts: { registry?: string; json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const registryUrl = opts.registry ?? config.registry;
    if (!registryUrl) {
      console.error('Error: no remote registry configured.');
      console.error('Set one with: agentbnb config set registry <url>');
      process.exit(1);
    }

    const db = openDatabase(config.db_path);
    let localCards: CapabilityCard[];
    try {
      localCards = listCards(db);
    } finally {
      db.close();
    }

    if (localCards.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ synced: 0, failed: 0, registry: registryUrl }));
      } else {
        console.log('No local cards to sync.');
      }
      return;
    }

    const url = `${registryUrl.replace(/\/$/, '')}/cards`;
    let synced = 0;
    let failed = 0;
    const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];

    for (const card of localCards) {
      const { _internal: _, ...publicCard } = card;
      // Inject gateway_url so remote agents know where to send requests
      const remoteCard = { ...publicCard, gateway_url: config.gateway_url };
      const displayName = card.name ?? (card as unknown as { agent_name?: string }).agent_name ?? card.id;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remoteCard),
        });
        if (response.ok) {
          synced++;
          results.push({ id: card.id, name: displayName, ok: true });
          if (!opts.json) {
            console.log(`  Synced: ${displayName} (${card.id.slice(0, 8)}...)`);
          }
        } else {
          const body = await response.text();
          failed++;
          results.push({ id: card.id, name: displayName, ok: false, error: `${response.status}: ${body}` });
          if (!opts.json) {
            console.error(`  Failed: ${displayName} — ${response.status}`);
          }
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ id: card.id, name: displayName, ok: false, error: msg });
        if (!opts.json) {
          console.error(`  Failed: ${displayName} — ${msg}`);
        }
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ synced, failed, registry: registryUrl, results }, null, 2));
    } else {
      console.log(`\nSynced ${synced}/${localCards.length} cards to ${registryUrl}${failed > 0 ? ` (${failed} failed)` : ''}`);
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

      const col = (s: string | undefined, w: number) => (s ?? '').slice(0, w).padEnd(w);
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
    const col = (s: string | undefined, w: number) => (s ?? '').slice(0, w).padEnd(w);

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
        const displayName = card.name ?? (card as unknown as { agent_name?: string }).agent_name ?? '';
        const source = 'source' in card ? (card as TaggedCard).source : 'local';
        const sourceTag = source === 'remote' ? '[remote]' : '[local]';
        console.log(
          col(shortId, 16) + '  ' +
          col(displayName, 28) + '  ' +
          col(String(card.level ?? ''), 3) + '  ' +
          col(String(card.pricing?.credits_per_call ?? ''), 7) + '  ' +
          col(card.availability?.online ? 'yes' : 'no', 6) + '  ' +
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
        const displayName = card.name ?? (card as unknown as { agent_name?: string }).agent_name ?? '';
        console.log(
          col(shortId, 16) + '  ' +
          col(displayName, 32) + '  ' +
          col(String(card.level ?? ''), 3) + '  ' +
          col(String(card.pricing?.credits_per_call ?? ''), 7) + '  ' +
          col(card.availability?.online ? 'yes' : 'no', 6)
        );
      }
    }

    console.log(`\n${outputCards.length} result(s)`);
  });

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

program
  .command('request [card-id]')
  .description('Request a capability from another agent — direct (card-id) or auto (--query)')
  .option('--params <json>', 'Input parameters as JSON string', '{}')
  .option('--peer <name>', 'Peer name to send request to (resolves URL+token from peer registry)')
  .option('--skill <id>', 'Skill ID within a v2.0 card')
  .option('--cost <credits>', 'Credits to commit (required for cross-machine peer requests)')
  .option('--query <text>', 'Search query for capability gap (triggers auto-request flow)')
  .option('--max-cost <credits>', 'Maximum credits to spend on auto-request (default: 50)')
  .option('--no-receipt', 'Skip signed escrow receipt (local-only mode)')
  .option('--json', 'Output as JSON')
  .action(async (cardId: string | undefined, opts: { params: string; peer?: string; skill?: string; cost?: string; query?: string; maxCost?: string; receipt: boolean; json?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    // Auto-request flow: --query triggers AutoRequestor instead of direct request
    if (opts.query) {
      let queryParams: Record<string, unknown> | undefined;
      if (opts.params && opts.params !== '{}') {
        try {
          queryParams = JSON.parse(opts.params) as Record<string, unknown>;
        } catch {
          console.error('Error: --params must be valid JSON.');
          process.exit(1);
        }
      }

      const registryDb = openDatabase(join(getConfigDir(), 'registry.db'));
      const creditDb = openCreditDb(join(getConfigDir(), 'credit.db'));
      registryDb.pragma('busy_timeout = 5000');
      creditDb.pragma('busy_timeout = 5000');

      try {
        const budgetManager = new BudgetManager(creditDb, config.owner, config.budget ?? DEFAULT_BUDGET_CONFIG);
        const requestor = new AutoRequestor({
          owner: config.owner,
          registryDb,
          creditDb,
          autonomyConfig: config.autonomy ?? DEFAULT_AUTONOMY_CONFIG,
          budgetManager,
          registryUrl: config.registry,
        });

        const result = await requestor.requestWithAutonomy({
          query: opts.query,
          maxCostCredits: Number(opts.maxCost ?? 50),
          params: queryParams,
        });

        console.log(JSON.stringify(result, null, 2));
      } finally {
        registryDb.close();
        creditDb.close();
      }
      return;
    }

    // Direct request flow: card-id is required
    if (!cardId) {
      console.error('Error: provide a <card-id> for direct request, or use --query for auto-request.');
      process.exit(1);
    }

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(opts.params) as Record<string, unknown>;
    } catch {
      console.error('Error: --params must be valid JSON.');
      process.exit(1);
    }

    // Resolve gateway URL and auth
    // Priority: --peer > remote card gateway_url > local config
    let gatewayUrl: string;
    let token: string;
    let isRemoteRequest = false;
    let targetOwner: string | undefined; // For relay routing
    // Always load identity auth — used for remote requests, harmless for local
    const identityAuth = loadIdentityAuth(config.owner);

    if (opts.peer) {
      const peer = findPeer(opts.peer);
      if (!peer) {
        console.error(`Error: Peer not found: ${opts.peer}. Run \`agentbnb peers\` to see registered peers.`);
        process.exit(1);
      }
      gatewayUrl = peer.url;
      token = peer.token;
      isRemoteRequest = true;
      targetOwner = opts.peer;

      // Identity auth already loaded above
    } else {
      // Check if card exists locally
      const db = openDatabase(config.db_path);
      let localCard: CapabilityCard | undefined;
      try {
        localCard = db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string } | undefined
          ? JSON.parse((db.prepare('SELECT data FROM capability_cards WHERE id = ?').get(cardId) as { data: string }).data) as CapabilityCard
          : undefined;
      } finally {
        db.close();
      }

      if (localCard) {
        // Local card — use local gateway
        gatewayUrl = config.gateway_url;
        token = config.token;
      } else {
        // Card not local — try fetching from remote registry
        const registryUrl = config.registry;
        if (!registryUrl) {
          console.error('Error: card not found locally and no remote registry configured.');
          console.error('Set one with: agentbnb config set registry <url>');
          process.exit(1);
        }

        const cardUrl = `${registryUrl.replace(/\/$/, '')}/cards/${cardId}`;
        let remoteCard: Record<string, unknown>;
        try {
          const resp = await fetch(cardUrl);
          if (!resp.ok) {
            console.error(`Error: card ${cardId} not found on remote registry (${resp.status}).`);
            process.exit(1);
          }
          remoteCard = await resp.json() as Record<string, unknown>;
        } catch (err) {
          console.error(`Error: cannot reach registry: ${(err as Error).message}`);
          process.exit(1);
        }

        targetOwner = (remoteCard.owner ?? remoteCard.agent_name) as string | undefined;

        if (remoteCard.gateway_url && typeof remoteCard.gateway_url === 'string') {
          gatewayUrl = remoteCard.gateway_url;
        } else if (targetOwner && config.registry) {
          // No gateway_url but we can try relay routing
          gatewayUrl = ''; // Will go straight to relay fallback
        } else {
          console.error('Error: remote card has no gateway_url and no relay available. The provider needs to re-publish with `agentbnb sync`.');
          process.exit(1);
        }

        token = ''; // Not used — identity auth below
        isRemoteRequest = true;

        // Identity auth already loaded above

        if (!opts.json) {
          const displayName = (remoteCard.name ?? remoteCard.agent_name ?? cardId) as string;
          if (gatewayUrl) {
            console.log(`Found remote card: ${displayName} @ ${gatewayUrl}`);
          } else {
            console.log(`Found remote card: ${displayName} (relay-only)`);
          }
        }
      }
    }

    // Cross-machine requests use signed escrow receipts
    const useReceipt = isRemoteRequest && opts.receipt !== false;

    // When Registry is configured, use CreditLedger for direct HTTP requests;
    // relay-only requests (no gatewayUrl) skip CLI-side escrow — relay handles credits.
    const useRegistryLedger = isRemoteRequest && !!config.registry && !!gatewayUrl;

    if (useReceipt && !opts.cost) {
      console.error('Error: --cost <credits> is required for remote requests. Specify the credits to commit.');
      process.exit(1);
    }

    let escrowId: string | undefined;
    let escrowReceipt: import('../types/index.js').EscrowReceipt | undefined;
    // Track which ledger was used so settle/release use the same ledger
    let requestLedger: import('../credit/create-ledger.js').CreditLedger | undefined;

    if (useReceipt) {
      const amount = Number(opts.cost);
      if (isNaN(amount) || amount <= 0) {
        console.error('Error: --cost must be a positive number.');
        process.exit(1);
      }

      if (useRegistryLedger) {
        // Use CreditLedger (Registry HTTP mode) for direct remote requests
        const reqIdentityAuth = loadIdentityAuth(config.owner);
        requestLedger = createLedger({
          registryUrl: config.registry!,
          ownerPublicKey: reqIdentityAuth.publicKey,
          privateKey: reqIdentityAuth.privateKey,
        });
        try {
          const { escrowId: heldId } = await requestLedger.hold(config.owner, amount, cardId);
          escrowId = heldId;
          if (!opts.json) {
            console.log(`Escrow: ${amount} credits held via Registry (ID: ${escrowId.slice(0, 8)}...)`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (opts.json) {
            console.log(JSON.stringify({ success: false, error: msg }, null, 2));
          } else {
            console.error(`Error creating escrow via Registry: ${msg}`);
          }
          process.exit(1);
        }
      } else if (gatewayUrl) {
        // Local SQLite escrow for non-Registry direct requests
        const configDir = getConfigDir();
        const creditDb = openCreditDb(join(configDir, 'credit.db'));
        creditDb.pragma('busy_timeout = 5000');

        try {
          const keys = loadKeyPair(configDir);
          const receiptResult = createSignedEscrowReceipt(creditDb, keys.privateKey, keys.publicKey, {
            owner: config.owner,
            amount,
            cardId,
            skillId: opts.skill,
          });
          escrowId = receiptResult.escrowId;
          escrowReceipt = receiptResult.receipt;

          if (!opts.json) {
            console.log(`Escrow: ${amount} credits held (ID: ${escrowId.slice(0, 8)}...)`);
          }
        } catch (err) {
          creditDb.close();
          const msg = err instanceof Error ? err.message : String(err);
          if (opts.json) {
            console.log(JSON.stringify({ success: false, error: msg }, null, 2));
          } else {
            console.error(`Error creating escrow receipt: ${msg}`);
          }
          process.exit(1);
        }
        // Note: creditDb intentionally not closed here — used by settle/release helpers below
        creditDb.close();
      }
      // else: relay-only path (no gatewayUrl) — relay handles escrow, skip CLI-side hold
    }

    // Helpers to settle/release escrow and print result
    const settleEscrow = async () => {
      if (useReceipt && escrowId) {
        if (requestLedger) {
          // Registry CreditLedger path
          await requestLedger.settle(escrowId, targetOwner ?? config.owner);
          if (!opts.json) console.log(`Escrow settled: ${opts.cost} credits deducted.`);
        } else if (escrowReceipt) {
          // Local SQLite path
          const configDir = getConfigDir();
          const creditDb = openCreditDb(join(configDir, 'credit.db'));
          creditDb.pragma('busy_timeout = 5000');
          try {
            settleRequesterEscrow(creditDb, escrowId);
            if (!opts.json) console.log(`Escrow settled: ${opts.cost} credits deducted.`);
          } finally { creditDb.close(); }
        }
      }
    };
    const releaseEscrow = async () => {
      if (useReceipt && escrowId) {
        if (requestLedger) {
          // Registry CreditLedger path
          await requestLedger.release(escrowId);
          if (!opts.json) console.log('Escrow released: credits refunded.');
        } else if (escrowReceipt) {
          // Local SQLite path
          const configDir = getConfigDir();
          const creditDb = openCreditDb(join(configDir, 'credit.db'));
          creditDb.pragma('busy_timeout = 5000');
          try {
            releaseRequesterEscrow(creditDb, escrowId);
            if (!opts.json) console.log('Escrow released: credits refunded.');
          } finally { creditDb.close(); }
        }
      }
    };
    const printResult = (result: unknown) => {
      if (opts.json) {
        console.log(JSON.stringify({ success: true, result }, null, 2));
      } else {
        console.log('Result:');
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      }
    };
    const isNetworkError = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('NETWORK_ERROR') || msg.includes('ECONNREFUSED')
        || msg.includes('fetch failed') || msg.includes('Network error');
    };

    // Relay fallback: try via WebSocket relay when direct connection fails
    const tryViaRelay = async (): Promise<unknown> => {
      const { RelayClient } = await import('../relay/websocket-client.js');
      const { requestViaRelay } = await import('../gateway/client.js');

      const tempRelay = new RelayClient({
        registryUrl: config.registry!,
        owner: config.owner,
        token: config.token,
        card: { id: config.owner, owner: config.owner },
        onRequest: async () => ({ error: { code: -32601, message: 'Not serving' } }),
        silent: true,
      });

      try {
        await tempRelay.connect();
        const result = await requestViaRelay(tempRelay, {
          targetOwner: targetOwner!,
          cardId,
          skillId: opts.skill,
          params: { ...params, ...(opts.skill ? { skill_id: opts.skill } : {}) },
          escrowReceipt,
        });
        return result;
      } finally {
        tempRelay.disconnect();
      }
    };

    try {
      let result: unknown;

      // If no gateway_url, go straight to relay
      if (!gatewayUrl && isRemoteRequest && config.registry && targetOwner) {
        if (!opts.json) console.log('No gateway URL, requesting via relay...');
        result = await tryViaRelay();
      } else {
        // Try direct connection first
        try {
          result = await requestCapability({
            gatewayUrl,
            token,
            cardId,
            params: { ...params, ...(opts.skill ? { skill_id: opts.skill } : {}) },
            escrowReceipt,
            identity: identityAuth,
          });
        } catch (directErr) {
          // Fallback to relay on network error for remote requests
          if (isNetworkError(directErr) && isRemoteRequest && config.registry && targetOwner) {
            if (!opts.json) console.log('Direct connection failed, trying relay...');
            result = await tryViaRelay();
          } else {
            throw directErr;
          }
        }
      }

      await settleEscrow();
      printResult(result);
    } catch (err) {
      await releaseEscrow();

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
    let transactions: import('../credit/ledger.js').CreditTransaction[];
    let heldEscrows: Array<{ id: string; amount: number; card_id: string; created_at: string }>;

    if (config.registry) {
      // Registry mode: use CreditLedger for balance and history
      const statusIdentityAuth = loadIdentityAuth(config.owner);
      const statusLedger = createLedger({
        registryUrl: config.registry,
        ownerPublicKey: statusIdentityAuth.publicKey,
        privateKey: statusIdentityAuth.privateKey,
      });
      try {
        balance = await statusLedger.getBalance(config.owner);
        transactions = await statusLedger.getHistory(config.owner, 5);
        // Held escrows are still tracked locally in Registry mode for display
        heldEscrows = creditDb
          .prepare('SELECT id, amount, card_id, created_at FROM credit_escrow WHERE owner = ? AND status = ?')
          .all(config.owner, 'held') as Array<{ id: string; amount: number; card_id: string; created_at: string }>;
      } finally {
        creditDb.close();
      }
    } else {
      // Local mode: use SQLite directly
      try {
        balance = getBalance(creditDb, config.owner);
        transactions = getTransactions(creditDb, config.owner, 5);
        heldEscrows = creditDb
          .prepare('SELECT id, amount, card_id, created_at FROM credit_escrow WHERE owner = ? AND status = ?')
          .all(config.owner, 'held') as Array<{ id: string; amount: number; card_id: string; created_at: string }>;
      } finally {
        creditDb.close();
      }
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
  .option('--skills-yaml <path>', 'Path to skills.yaml (default: ~/.agentbnb/skills.yaml)')
  .option('--registry-port <port>', 'Public registry API port (0 to disable)', '7701')
  .option('--registry <url>', 'Connect to remote registry via WebSocket relay (e.g., hub.agentbnb.dev)')
  .option('--conductor', 'Enable Conductor orchestration mode')
  .option('--announce', 'Announce this gateway on the local network via mDNS')
  .option('--no-relay', 'Do not auto-connect to remote registry relay')
  .action(async (opts: { port?: string; handlerUrl: string; skillsYaml?: string; registryPort: string; registry?: string; conductor?: boolean; announce?: boolean; relay?: boolean }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const port = opts.port ? parseInt(opts.port, 10) : config.gateway_port;
    const registryPort = parseInt(opts.registryPort, 10);

    const skillsYamlPath = opts.skillsYaml ?? join(homedir(), '.agentbnb', 'skills.yaml');
    const runtime = new AgentRuntime({
      registryDbPath: config.db_path,
      creditDbPath: config.credit_db_path,
      owner: config.owner,
      skillsYamlPath,
      conductorEnabled: opts.conductor ?? false,
      conductorToken: config.token,
    });
    await runtime.start();

    if (runtime.skillExecutor) {
      console.log(`SkillExecutor initialized from ${skillsYamlPath}`);
    }
    if (opts.conductor) {
      console.log('Conductor mode enabled — orchestrate/plan skills available via gateway');
    }

    // Register conductor card locally when conductor.public is enabled
    if (opts.conductor && config.conductor?.public) {
      const { buildConductorCard } = await import('../conductor/card.js');
      const conductorCard = buildConductorCard(config.owner);
      // Use raw SQL to insert (same pattern as relay upsertCard)
      const now = new Date().toISOString();
      const existing = runtime.registryDb.prepare('SELECT id FROM capability_cards WHERE id = ?').get(conductorCard.id) as { id: string } | undefined;
      if (existing) {
        runtime.registryDb.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(conductorCard), now, conductorCard.id);
      } else {
        runtime.registryDb.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(conductorCard.id, config.owner, JSON.stringify(conductorCard), now, now);
      }
      console.log('Conductor card registered locally (conductor.public: true)');
    }

    // Start IdleMonitor background loop
    const autonomyConfig = config.autonomy ?? DEFAULT_AUTONOMY_CONFIG;
    const idleMonitor = new IdleMonitor({
      owner: config.owner,
      db: runtime.registryDb,
      autonomyConfig,
    });
    const idleJob = idleMonitor.start();
    runtime.registerJob(idleJob);
    console.log('IdleMonitor started (60s poll interval, 70% idle threshold)');

    const server = createGatewayServer({
      port,
      registryDb: runtime.registryDb,
      creditDb: runtime.creditDb,
      tokens: [config.token],
      handlerUrl: opts.handlerUrl,
      skillExecutor: runtime.skillExecutor,
    });

    // Start public registry server if registry-port > 0
    let registryFastify: import('fastify').FastifyInstance | null = null;
    let relayClient: import('../relay/websocket-client.js').RelayClient | null = null;

    const gracefulShutdown = async () => {
      console.log('\nShutting down...');
      if (relayClient) {
        relayClient.disconnect();
      }
      if (opts.announce) {
        await stopAnnouncement();
      }
      if (registryFastify) {
        await registryFastify.close();
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
        const { server: regServer, relayState } = createRegistryServer({
          registryDb: runtime.registryDb,
          silent: false,
          ownerName: config.owner,
          ownerApiKey: config.api_key,
          creditDb: runtime.creditDb,
        });
        registryFastify = regServer;
        await registryFastify.listen({ port: registryPort, host: '0.0.0.0' });
        console.log(`Registry API: http://0.0.0.0:${registryPort}/cards`);
        if (relayState) {
          console.log(`WebSocket relay active on /ws`);
        }
      }

      // Connect to remote registry via WebSocket relay (auto from config, or explicit --registry)
      const relayUrl = opts.registry ?? config.registry;
      if (relayUrl && opts.relay !== false) {
        const { RelayClient } = await import('../relay/websocket-client.js');
        const { executeCapabilityRequest } = await import('../gateway/execute.js');

        // Build card data for registration
        const cards = listCards(runtime.registryDb, config.owner);
        const card = cards[0] ?? {
          id: config.owner,
          owner: config.owner,
          name: config.owner,
          description: 'Agent registered via CLI',
          spec_version: '1.0',
          level: 1,
          inputs: [],
          outputs: [],
          pricing: { credits_per_call: 0 },
          availability: { online: true },
        };

        // Build conductor card for relay registration if conductor.public is enabled
        const additionalCards: Record<string, unknown>[] = [];
        if (config.conductor?.public) {
          const { buildConductorCard } = await import('../conductor/card.js');
          const conductorCard = buildConductorCard(config.owner);
          additionalCards.push(conductorCard as unknown as Record<string, unknown>);
          console.log('Conductor card will be published to registry (conductor.public: true)');
        }

        relayClient = new RelayClient({
          registryUrl: relayUrl,
          owner: config.owner,
          token: config.token,
          card: card as Record<string, unknown>,
          cards: additionalCards.length > 0 ? additionalCards : undefined,
          onRequest: async (req) => {
            const onProgress: import('../skills/executor.js').ProgressCallback = (info) => {
              relayClient!.sendProgress(req.id, info);
            };
            const result = await executeCapabilityRequest({
              registryDb: runtime.registryDb,
              creditDb: runtime.creditDb,
              cardId: req.card_id,
              skillId: req.skill_id,
              params: req.params as Record<string, unknown>,
              requester: req.requester ?? req.from_owner,
              escrowReceipt: req.escrow_receipt as import('../types/index.js').EscrowReceipt | undefined,
              skillExecutor: runtime.skillExecutor,
              handlerUrl: opts.handlerUrl,
              onProgress,
            });
            if (result.success) {
              return { result: result.result };
            }
            return { error: { code: result.error.code, message: result.error.message } };
          },
        });

        try {
          await relayClient.connect();
          console.log(`Connected to registry: ${relayUrl}${opts.registry ? '' : ' (auto)'}`);
        } catch (err) {
          console.warn(`Warning: could not connect to registry ${relayUrl}: ${err instanceof Error ? err.message : err}`);
          console.warn('Will auto-reconnect in background...');
        }
      }

      if (opts.announce) {
        announceGateway(config.owner, port);
        console.log('Announcing on local network via mDNS');
      }
    } catch (err) {
      console.error('Failed to start:', err);
      if (relayClient) relayClient.disconnect();
      if (registryFastify) {
        await registryFastify.close().catch(() => {});
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

    const col = (s: string | undefined, w: number) => (s ?? '').slice(0, w).padEnd(w);
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
    const allowedKeys = ['registry', 'tier1', 'tier2', 'reserve', 'idle-threshold', 'conductor-public'];
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

    if (key === 'reserve') {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) {
        console.error(`Error: reserve must be a non-negative integer, got: ${value}`);
        process.exit(1);
      }

      // Initialize budget config from defaults if not yet set
      if (!config.budget) {
        config.budget = { ...DEFAULT_BUDGET_CONFIG };
      }

      config.budget.reserve_credits = parsed;
      saveConfig(config);
      console.log(`Set reserve = ${parsed} (credit reserve floor: ${parsed} credits)`);
      return;
    }

    if (key === 'idle-threshold') {
      const parsed = parseFloat(value);
      if (isNaN(parsed) || parsed < 0 || parsed > 1) {
        console.error('Error: idle-threshold must be a number between 0 and 1');
        process.exit(1);
      }
      (config as unknown as Record<string, unknown>)['idle_threshold'] = parsed;
      saveConfig(config);
      console.log(`Set idle-threshold = ${parsed} (idle rate threshold for auto-share)`);
      return;
    }

    if (key === 'conductor-public') {
      const boolVal = value === 'true';
      if (value !== 'true' && value !== 'false') {
        console.error('Error: conductor-public must be "true" or "false"');
        process.exit(1);
      }
      config.conductor = { public: boolVal };
      saveConfig(config);
      console.log(`Set conductor-public = ${boolVal} (conductor card ${boolVal ? 'will be' : 'will NOT be'} published to registry)`);
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

    if (key === 'reserve') {
      console.log(String(config.budget?.reserve_credits ?? DEFAULT_BUDGET_CONFIG.reserve_credits));
      return;
    }

    if (key === 'idle-threshold') {
      const val = (config as unknown as Record<string, unknown>)['idle_threshold'];
      console.log(val !== undefined ? String(val) : '0.70');
      return;
    }

    if (key === 'conductor-public') {
      console.log(String(config.conductor?.public ?? false));
      return;
    }

    const value = (config as unknown as Record<string, unknown>)[key];
    console.log(value !== undefined ? String(value) : '(not set)');
  });

// ---------------------------------------------------------------------------
// openclaw
// ---------------------------------------------------------------------------

const openclaw = program.command('openclaw').description('OpenClaw integration commands');

/**
 * agentbnb openclaw sync
 * Reads SOUL.md and publishes (or updates) a v2.0 multi-skill card.
 */
openclaw
  .command('sync')
  .description('Read SOUL.md and publish/update a v2.0 capability card')
  .option('--soul-path <path>', 'Path to SOUL.md', './SOUL.md')
  .action(async (opts: { soulPath: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    let content: string;
    try {
      content = readFileSync(opts.soulPath, 'utf-8');
    } catch {
      console.error(`Error: cannot read SOUL.md at ${opts.soulPath}`);
      process.exit(1);
    }

    const db = openDatabase(config.db_path);
    try {
      const card = publishFromSoulV2(db, content, config.owner);
      console.log(`Published card ${card.id} with ${card.skills.length} skill(s)`);

      // Display market reference prices per skill
      for (const skill of card.skills) {
        const stats = getPricingStats(db, skill.name);
        if (stats.count > 0) {
          console.log(`  ${skill.name}: ${skill.pricing.credits_per_call} cr (market: ${stats.min}-${stats.max} cr, median ${stats.median}, ${stats.count} providers)`);
        } else {
          console.log(`  ${skill.name}: ${skill.pricing.credits_per_call} cr (no market data yet)`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    } finally {
      db.close();
    }
  });

/**
 * agentbnb openclaw status
 * Shows install state, tier thresholds, balance, reserve, and per-skill idle rate.
 */
openclaw
  .command('status')
  .description('Show OpenClaw integration status, tier config, and skill idle rates')
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const db = openDatabase(config.db_path);
    const creditDb = openCreditDb(config.credit_db_path);
    try {
      const status = getOpenClawStatus(config, db, creditDb);
      console.log('AgentBnB OpenClaw Status');
      console.log(`Owner: ${status.owner}`);
      console.log(`Gateway: ${status.gateway_url}`);
      console.log(`Tier 1 (auto): < ${status.tier.tier1_max_credits} credits`);
      console.log(`Tier 2 (notify): ${status.tier.tier1_max_credits}-${status.tier.tier2_max_credits} credits`);
      console.log(`Tier 3 (ask): > ${status.tier.tier2_max_credits} credits`);
      console.log(`Balance: ${status.balance} credits`);
      console.log(`Reserve: ${status.reserve} credits`);
      console.log(`Skills: ${status.skills.length}`);
      for (const skill of status.skills) {
        console.log(`  - ${skill.id}: ${skill.name} (idle: ${skill.idle_rate ?? 'N/A'}, online: ${skill.online})`);
      }
    } finally {
      db.close();
      creditDb.close();
    }
  });

/**
 * agentbnb openclaw rules
 * Prints or injects the HEARTBEAT.md autonomy rules block.
 */
openclaw
  .command('rules')
  .description('Print HEARTBEAT.md rules block (or inject into a file with --inject)')
  .option('--inject <path>', 'Path to HEARTBEAT.md file to patch with rules block')
  .action(async (opts: { inject?: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Error: not initialized. Run `agentbnb init` first.');
      process.exit(1);
    }

    const autonomy = config.autonomy ?? DEFAULT_AUTONOMY_CONFIG;
    const budget = config.budget ?? DEFAULT_BUDGET_CONFIG;
    const section = generateHeartbeatSection(autonomy, budget);

    if (opts.inject) {
      injectHeartbeatSection(opts.inject, section);
      console.log(`Injected AgentBnB rules into ${opts.inject}`);
    } else {
      console.log(section);
    }
  });

// ---------------------------------------------------------------------------
// conduct
// ---------------------------------------------------------------------------

program
  .command('conduct <task>')
  .description('Orchestrate a complex task across the AgentBnB network')
  .option('--plan-only', 'Show execution plan without executing')
  .option('--max-budget <credits>', 'Maximum credits to spend', '100')
  .option('--json', 'Output as JSON')
  .action(async (task: string, opts: { planOnly?: boolean; maxBudget: string; json?: boolean }) => {
    const { conductAction } = await import('./conduct.js');
    const result = await conductAction(task, opts);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) process.exit(1);
      return;
    }

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    // Display plan
    const plan = result.plan as { steps: Array<{ step: number; description: string; capability: string; agent: string; credits: number; depends_on: string[] }>; orchestration_fee: number; estimated_total: number };
    console.log('\nExecution Plan:');
    for (const step of plan.steps) {
      const deps = step.depends_on.length > 0 ? ` [depends on prior steps]` : '';
      console.log(`  Step ${step.step}: ${step.description} (${step.capability}) -> @${step.agent} (${step.credits} cr)${deps}`);
    }
    console.log(`  Orchestration fee: ${plan.orchestration_fee} cr`);
    console.log(`  Total estimated: ${plan.estimated_total} cr`);

    if (result.execution) {
      console.log('\nResults:');
      console.log(JSON.stringify(result.execution, null, 2));
      console.log(`\nTotal credits spent: ${result.total_credits ?? 0} cr`);
      console.log(`Latency: ${result.latency_ms ?? 0} ms`);
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      for (const err of result.errors) {
        console.log(`  - ${err}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

program
  .command('mcp-server')
  .description('Start an MCP (Model Context Protocol) server for IDE integration')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

await program.parseAsync(process.argv);
