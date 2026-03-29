/**
 * Extracted init logic — reusable by both `agentbnb init` and `agentbnb quickstart`.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

import { loadConfig, saveConfig, getConfigDir } from './config.js';
import type { AgentBnBConfig } from './config.js';
import { loadOrRepairIdentity } from '../identity/identity.js';
import { detectOpenPorts, buildDraftCard } from './onboarding.js';
import { detectCapabilities, capabilitiesToV2Card, interactiveTemplateMenu } from '../onboarding/index.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { openCreditDb, bootstrapAgent, migrateOwner } from '../credit/ledger.js';
import { createAgentRecord, lookupAgent, lookupAgentByOwner } from '../identity/agent-identity.js';
import { createLedger } from '../credit/create-ledger.js';
import { publishFromSoulV2 } from '../openclaw/index.js';
import type { CapabilityCard } from '../types/index.js';
import { createInterface } from 'node:readline';

/** Options accepted by performInit(). */
export interface InitOptions {
  owner?: string;
  agentId?: string;
  port: string;
  host?: string;
  yes?: boolean;
  nonInteractive?: boolean;
  detect?: boolean;
  from?: string;
  json?: boolean;
}

/** Result returned by performInit(). */
export interface InitResult {
  config: AgentBnBConfig;
  owner: string;
  configDir: string;
  publishedCards: Array<{ id: string; name: string }>;
  registryBalance?: number;
  identity: { agent_id: string };
  keypairStatus: string;
  detectedSource: string;
}

/** Interactive confirm prompt using readline. */
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

/** Detect the LAN (non-loopback) IPv4 address of this machine. */
function getLanIp(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

/**
 * Loads Ed25519 identity auth credentials, auto-generating keypair/identity if missing.
 */
function loadIdentityAuth(owner: string): { agentId: string; publicKey: string; privateKey: Buffer } {
  const configDir = getConfigDir();
  const { identity, keys } = loadOrRepairIdentity(configDir, owner);

  return {
    agentId: identity.agent_id,
    publicKey: identity.public_key,
    privateKey: keys.privateKey,
  };
}

/**
 * Core init logic extracted from the `agentbnb init` CLI command.
 * Idempotent — safe to call multiple times.
 */
export async function performInit(opts: InitOptions): Promise<InitResult> {
  const configDir = getConfigDir();
  const dbPath = join(configDir, 'registry.db');
  const creditDbPath = join(configDir, 'credit.db');
  const port = parseInt(opts.port, 10);
  const ip = opts.host ?? getLanIp();

  const yesMode = opts.yes ?? opts.nonInteractive ?? false;

  // Merge with existing config to preserve user-set values
  const existingConfig = loadConfig();

  const owner = opts.agentId ?? opts.owner ?? existingConfig?.owner ?? `agent-${randomBytes(4).toString('hex')}`;

  const config = {
    ...existingConfig,
    owner,
    gateway_url: `http://${ip}:${port}`,
    gateway_port: port,
    db_path: dbPath,
    credit_db_path: creditDbPath,
    token: existingConfig?.token ?? randomBytes(32).toString('hex'),
    api_key: existingConfig?.api_key ?? randomBytes(32).toString('hex'),
    ...(existingConfig?.registry
      ? { registry: existingConfig.registry }
      : yesMode
        ? { registry: 'https://agentbnb.fly.dev' }
        : {}),
  } as AgentBnBConfig;

  saveConfig(config);

  // Atomically load/repair identity + keypair.
  const identityMaterial = loadOrRepairIdentity(configDir, owner);
  const identity = identityMaterial.identity;
  const keypairStatus = identityMaterial.status === 'generated' ? 'generated' : 'existing';

  // Migrate data if owner changed
  const creditDb = openCreditDb(creditDbPath);
  if (existingConfig?.owner && existingConfig.owner !== owner) {
    migrateOwner(creditDb, existingConfig.owner as string, owner);

    const regDb = openDatabase(dbPath);
    try {
      const rows = regDb.prepare('SELECT id, owner, data FROM capability_cards WHERE owner != ?').all(owner) as Array<{ id: string; owner: string; data: string }>;
      for (const row of rows) {
        try {
          const card = JSON.parse(row.data);
          card.owner = owner;
          regDb.prepare('UPDATE capability_cards SET owner = ?, data = ? WHERE id = ?').run(owner, JSON.stringify(card), row.id);
        } catch { /* skip malformed cards */ }
      }
      if (!opts.json && rows.length > 0) {
        console.log(`Migrated ${rows.length} card(s) → ${owner}`);
      }
    } finally {
      regDb.close();
    }

    const allOwners = creditDb.prepare('SELECT owner FROM credit_balances WHERE owner != ?').all(owner) as Array<{ owner: string }>;
    for (const { owner: oldOwner } of allOwners) {
      migrateOwner(creditDb, oldOwner, owner);
    }

    if (existingConfig.registry) {
      try {
        const renameAuth = loadIdentityAuth(owner);
        const renameLedger = createLedger({
          registryUrl: existingConfig.registry as string,
          ownerPublicKey: renameAuth.publicKey,
          privateKey: renameAuth.privateKey,
        });
        await renameLedger.rename(existingConfig.owner as string, owner);
        if (!opts.json) {
          console.log(`Migrated Registry credits: ${existingConfig.owner} → ${owner}`);
        }
      } catch (err) {
        if (!opts.json) {
          console.warn(`Warning: could not migrate Registry credits: ${(err as Error).message}`);
        }
      }
    }

    if (!opts.json) {
      console.log(`Migrated local credits: ${existingConfig.owner} → ${owner}`);
    }
  }

  // Register agent record in agents table (V8 identity)
  const existingAgent = lookupAgent(creditDb, identity.agent_id) ?? lookupAgentByOwner(creditDb, owner);
  if (!existingAgent) {
    try {
      createAgentRecord(creditDb, {
        agent_id: identity.agent_id,
        display_name: config.display_name ?? owner,
        public_key: identity.public_key,
        legacy_owner: owner,
      });
    } catch {
      // AGENT_EXISTS — already registered, safe to ignore
    }
  }

  // Persist agent_id in config for fast access
  if (!config.agent_id || config.agent_id !== identity.agent_id) {
    config.agent_id = identity.agent_id;
    saveConfig(config);
  }

  // Bootstrap credit ledger with 100 credits
  bootstrapAgent(creditDb, owner, 100);
  creditDb.close();

  // Grant 50 credits on remote Registry if configured
  let registryBalance: number | undefined;
  if (config.registry) {
    try {
      const identityAuth = loadIdentityAuth(owner);
      const ledger = createLedger({
        registryUrl: config.registry as string,
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
      if (!opts.json) {
        console.log(`  Found ${result.sourceFile ?? 'docs'} — detected ${result.capabilities.length} capabilities:`);
        for (const cap of result.capabilities) {
          console.log(`    ${cap.name} (${cap.category}, cr ${cap.credits_per_call}/call)`);
        }
      }

      const card = capabilitiesToV2Card(result.capabilities, owner);

      if (yesMode) {
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

      if (yesMode) {
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
      if (process.stdout.isTTY && !yesMode && !opts.json) {
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

  return {
    config,
    owner,
    configDir,
    publishedCards,
    registryBalance,
    identity: { agent_id: identity.agent_id },
    keypairStatus,
    detectedSource,
  };
}
