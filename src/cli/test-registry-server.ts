/**
 * Test fixture: standalone registry server for integration tests.
 *
 * Usage: npx tsx test-registry-server.ts <port-file-path>
 *
 * Starts a Fastify registry server with two pre-seeded cards:
 *   1. 'Remote Voice Synth' (no tags)
 *   2. 'NLP Classifier' (tags: ['nlp'])
 *
 * Writes the actual bound port to <port-file-path> when ready.
 * Exits on SIGTERM or SIGINT.
 */
import { createRegistryServer } from '../registry/server.js';
import { openDatabase, insertCard } from '../registry/store.js';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

const portFile = process.argv[2];
if (!portFile) {
  console.error('Usage: test-registry-server.ts <port-file-path>');
  process.exit(1);
}

const db = openDatabase(':memory:');

insertCard(db, {
  spec_version: '1.0' as const,
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  owner: 'remote-owner',
  name: 'Remote Voice Synth',
  description: 'A remote voice synthesis capability',
  level: 1 as const,
  inputs: [{ name: 'text', type: 'text' as const, required: true }],
  outputs: [{ name: 'audio', type: 'audio' as const, required: true }],
  pricing: { credits_per_call: 10 },
  availability: { online: true },
  metadata: {},
});

insertCard(db, {
  spec_version: '1.0' as const,
  id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  owner: 'remote-owner',
  name: 'NLP Classifier',
  description: 'A natural language processing classifier',
  level: 1 as const,
  inputs: [{ name: 'text', type: 'text' as const, required: true }],
  outputs: [{ name: 'label', type: 'text' as const, required: true }],
  pricing: { credits_per_call: 5 },
  availability: { online: true },
  metadata: { tags: ['nlp'] },
});

const server = createRegistryServer({ registryDb: db, silent: true });
await server.listen({ port: 0, host: '127.0.0.1' });
const port = (server.server.address() as AddressInfo).port;

// Signal readiness by writing port to file
writeFileSync(portFile, String(port), 'utf-8');

const shutdown = async () => {
  await server.close();
  db.close();
  process.exit(0);
};

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
