/**
 * POST /cards publish loop — dual-auth (DID + Bearer) + canonical owner binding.
 *
 * Audit reference: docs/maintenance/2026-04-25-ui-backend-gap-audit.md finding #2.
 *
 * Scenarios covered:
 *  - Hub flow: DID headers + canonical agent_id owner -> 201
 *  - Hub flow: DID headers + `agent-<canonical>` prefixed owner -> 201
 *  - Legacy CLI flow: Bearer token + display-name owner -> 201
 *  - Mismatch: DID headers for agent A + agent B's id as owner -> 403
 *  - No auth -> 401
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createRegistryServer } from './server.js';
import { openDatabase, getCard } from './store.js';
import { generateKeyPair } from '../credit/signing.js';
import { signRequest } from './identity-auth.js';
import { createAgentRecord } from '../identity/agent-identity.js';
import { deriveAgentId } from '../identity/identity.js';
import type Database from 'better-sqlite3';
import type { CapabilityCard } from '../types/index.js';

vi.mock('../cli/onboarding.js', () => ({
  detectApiKeys: vi.fn().mockReturnValue([]),
  buildDraftCard: vi.fn().mockReturnValue(null),
  KNOWN_API_KEYS: [],
}));

interface KeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
}

interface AgentFixture {
  keyPair: KeyPair;
  publicKeyHex: string;
  agentId: string;
}

function makeAgent(): AgentFixture {
  const keyPair = generateKeyPair();
  const publicKeyHex = keyPair.publicKey.toString('hex');
  const agentId = deriveAgentId(publicKeyHex);
  return { keyPair, publicKeyHex, agentId };
}

function makeV2CardBody(owner: string): Record<string, unknown> {
  return {
    spec_version: '2.0',
    id: crypto.randomUUID(),
    owner,
    agent_name: 'Publish Loop Tester',
    skills: [
      {
        id: 'skill-publish-test',
        name: 'Publish Test Skill',
        description: 'Sufficient description for the quality gate (20+ chars).',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5 },
        availability: { online: true },
      },
    ],
    availability: { online: true },
  };
}

describe('POST /cards — publish loop (audit P0 #2)', () => {
  let db: Database.Database;
  let server: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const created = createRegistryServer({
      registryDb: db,
      silent: true,
      ownerName: 'cli-display-name',
      ownerApiKey: 'cli-secret-key',
    });
    server = created.server;
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it('Hub flow: DID headers + canonical agent_id owner -> 201 + persisted', async () => {
    const agent = makeAgent();
    createAgentRecord(db, {
      agent_id: agent.agentId,
      display_name: 'Hannah',
      public_key: agent.publicKeyHex,
      legacy_owner: 'Hannah',
    });

    const body = makeV2CardBody(agent.agentId);
    const headers = signRequest('POST', '/cards', body, agent.keyPair.privateKey, agent.publicKeyHex);

    const response = await server.inject({ method: 'POST', url: '/cards', headers, payload: body });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ok: true, id: body.id });

    const persisted = getCard(db, body.id as string);
    expect(persisted?.owner).toBe(agent.agentId);
  });

  it('Hub flow: DID headers + agent-prefixed owner is canonicalized -> 201', async () => {
    const agent = makeAgent();
    createAgentRecord(db, {
      agent_id: agent.agentId,
      display_name: 'Cheng Wen',
      public_key: agent.publicKeyHex,
      legacy_owner: 'Cheng Wen',
    });

    const body = makeV2CardBody(`agent-${agent.agentId}`);
    const headers = signRequest('POST', '/cards', body, agent.keyPair.privateKey, agent.publicKeyHex);

    const response = await server.inject({ method: 'POST', url: '/cards', headers, payload: body });

    expect(response.statusCode).toBe(201);
    const persisted = getCard(db, body.id as string);
    // Owner persisted as the canonical bare 16-hex form, not the prefixed input.
    expect(persisted?.owner).toBe(agent.agentId);
  });

  it('Legacy CLI flow: Bearer token + display-name owner -> 201', async () => {
    const body = makeV2CardBody('cli-display-name');

    const response = await server.inject({
      method: 'POST',
      url: '/cards',
      headers: {
        Authorization: 'Bearer cli-secret-key',
        'Content-Type': 'application/json',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    const persisted = getCard(db, body.id as string);
    expect(persisted?.owner).toBe('cli-display-name');
  });

  it('Mismatch: DID headers for agent A + agent B id in owner -> 403', async () => {
    const agentA = makeAgent();
    const agentB = makeAgent();
    createAgentRecord(db, {
      agent_id: agentA.agentId,
      display_name: 'Agent A',
      public_key: agentA.publicKeyHex,
      legacy_owner: 'Agent A',
    });
    createAgentRecord(db, {
      agent_id: agentB.agentId,
      display_name: 'Agent B',
      public_key: agentB.publicKeyHex,
      legacy_owner: 'Agent B',
    });

    const body = makeV2CardBody(agentB.agentId);
    const headers = signRequest('POST', '/cards', body, agentA.keyPair.privateKey, agentA.publicKeyHex);

    const response = await server.inject({ method: 'POST', url: '/cards', headers, payload: body });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Card owner does not match authenticated identity' });
    expect(getCard(db, body.id as string)).toBeNull();
  });

  it('No auth -> 401', async () => {
    const body = makeV2CardBody('anybody');

    const response = await server.inject({
      method: 'POST',
      url: '/cards',
      headers: { 'Content-Type': 'application/json' },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Valid DID identity headers or admin Bearer token required',
    });
    expect(getCard(db, body.id as string)).toBeNull();
  });

  it('Backward compat: existing DID flow with bare canonical agent_id is unchanged', async () => {
    // Sanity check: the prior contract (bare agent_id, DID-only) still works
    // exactly the same — no other publish path is regressed by the dual-auth
    // change. This is also what the v10 Hub flow now sends after SharePage's
    // owner rewrite.
    const agent = makeAgent();
    createAgentRecord(db, {
      agent_id: agent.agentId,
      display_name: 'Backcompat Agent',
      public_key: agent.publicKeyHex,
      legacy_owner: 'Backcompat Agent',
    });
    const body = makeV2CardBody(agent.agentId);
    const headers = signRequest('POST', '/cards', body, agent.keyPair.privateKey, agent.publicKeyHex);
    const response = await server.inject({ method: 'POST', url: '/cards', headers, payload: body });
    expect(response.statusCode).toBe(201);

    const persisted = getCard(db, body.id as string) as CapabilityCard | null;
    expect(persisted).not.toBeNull();
    expect(persisted?.owner).toBe(agent.agentId);
  });
});
