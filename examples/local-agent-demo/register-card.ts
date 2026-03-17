#!/usr/bin/env npx tsx
/**
 * register-card.ts — Registers a v2.0 CapabilityCard into the AgentBnB registry.
 *
 * Usage:
 *   AGENTBNB_DIR=~/.agentbnb npx tsx register-card.ts
 *
 * Follows the same pattern as src/conductor/card.ts registerConductorCard().
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityCardV2Schema } from '../../src/types/index.js';
import { openDatabase } from '../../src/registry/store.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Resolve config directory
const configDir = process.env.AGENTBNB_DIR ?? join(process.env.HOME ?? '~', '.agentbnb');
const configPath = join(configDir, 'config.json');

// Load config to get DB path
let dbPath: string;
try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { db_path?: string };
  dbPath = config.db_path ?? join(configDir, 'registry.db');
} catch {
  dbPath = join(configDir, 'registry.db');
}

// Read and validate card
const cardPath = join(__dirname, 'demo-card.json');
const rawCard = JSON.parse(readFileSync(cardPath, 'utf-8')) as unknown;
const card = CapabilityCardV2Schema.parse(rawCard);

// Register in database (idempotent INSERT OR REPLACE)
const db = openDatabase(dbPath);
const now = new Date().toISOString();

const existing = db
  .prepare('SELECT id FROM capability_cards WHERE id = ?')
  .get(card.id) as { id: string } | undefined;

if (existing) {
  db.prepare(
    'UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?',
  ).run(JSON.stringify(card), now, card.id);
  console.log(`Updated card: ${card.agent_name} (${card.id})`);
} else {
  db.prepare(
    'INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(card.id, card.owner, JSON.stringify(card), now, now);
  console.log(`Registered card: ${card.agent_name} (${card.id})`);
}

console.log(`  Owner: ${card.owner}`);
console.log(`  Skills: ${card.skills.map((s) => s.id).join(', ')}`);

db.close();
