#!/usr/bin/env npx tsx
/**
 * register-card.ts — Registers the TTS Studio v2.0 card.
 *
 * Usage: AGENTBNB_DIR=~/.agentbnb npx tsx register-card.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityCardV2Schema } from '../../src/types/index.js';
import { openDatabase } from '../../src/registry/store.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const configDir = process.env.AGENTBNB_DIR ?? join(process.env.HOME ?? '~', '.agentbnb');

let dbPath: string;
try {
  const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8')) as { db_path?: string };
  dbPath = config.db_path ?? join(configDir, 'registry.db');
} catch {
  dbPath = join(configDir, 'registry.db');
}

const card = CapabilityCardV2Schema.parse(
  JSON.parse(readFileSync(join(__dirname, 'card.json'), 'utf-8')),
);

const db = openDatabase(dbPath);
const now = new Date().toISOString();

const existing = db.prepare('SELECT id FROM capability_cards WHERE id = ?').get(card.id) as { id: string } | undefined;
if (existing) {
  db.prepare('UPDATE capability_cards SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(card), now, card.id);
  console.log(`Updated card: ${card.agent_name} (${card.id})`);
} else {
  db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(card.id, card.owner, JSON.stringify(card), now, now);
  console.log(`Registered card: ${card.agent_name} (${card.id})`);
}
console.log(`  Owner: ${card.owner}`);
console.log(`  Skills: ${card.skills.map(s => s.id).join(', ')}`);
db.close();
