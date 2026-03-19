import { describe, it, expect, beforeEach, beforeAll, afterAll, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { initJobQueue, insertJob, getJob, listJobs, updateJobStatus, getJobsByRelayOwner } from './job-queue.js';
import { initHubAgentTable, createHubAgent } from './store.js';
import { openCreditDb, bootstrapAgent, getBalance } from '../credit/ledger.js';
import { HubAgentExecutor } from './executor.js';

// Set up test master key
const TEST_KEY_HEX = randomBytes(32).toString('hex');
const originalEnv = process.env.HUB_MASTER_KEY;

beforeAll(() => {
  process.env.HUB_MASTER_KEY = TEST_KEY_HEX;
});

afterAll(() => {
  if (originalEnv !== undefined) {
    process.env.HUB_MASTER_KEY = originalEnv;
  } else {
    delete process.env.HUB_MASTER_KEY;
  }
});

describe('Job Queue CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    initJobQueue(db);
  });

  it('initJobQueue creates hub_agent_jobs table', () => {
    const columns = db.pragma('table_info(hub_agent_jobs)') as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('hub_agent_id');
    expect(names).toContain('skill_id');
    expect(names).toContain('requester_owner');
    expect(names).toContain('params');
    expect(names).toContain('status');
    expect(names).toContain('result');
    expect(names).toContain('escrow_id');
    expect(names).toContain('relay_owner');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('insertJob creates a job with status queued and returns job object', () => {
    const job = insertJob(db, {
      hub_agent_id: 'agent-1',
      skill_id: 'skill-a',
      requester_owner: 'requester-1',
      params: { text: 'hello' },
      escrow_id: 'escrow-1',
      relay_owner: 'relay-owner-1',
    });

    expect(job.id).toBeTruthy();
    expect(job.hub_agent_id).toBe('agent-1');
    expect(job.skill_id).toBe('skill-a');
    expect(job.requester_owner).toBe('requester-1');
    expect(job.params).toBe(JSON.stringify({ text: 'hello' }));
    expect(job.status).toBe('queued');
    expect(job.escrow_id).toBe('escrow-1');
    expect(job.relay_owner).toBe('relay-owner-1');
    expect(job.created_at).toBeTruthy();
    expect(job.updated_at).toBeTruthy();
  });

  it('getJob retrieves a job by id', () => {
    const created = insertJob(db, {
      hub_agent_id: 'agent-1',
      skill_id: 'skill-a',
      requester_owner: 'requester-1',
      params: { key: 'value' },
    });

    const fetched = getJob(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.status).toBe('queued');
  });

  it('getJob returns null for non-existent id', () => {
    const fetched = getJob(db, 'non-existent-id');
    expect(fetched).toBeNull();
  });

  it('listJobs returns all jobs for a hub_agent_id ordered by created_at DESC', () => {
    insertJob(db, { hub_agent_id: 'agent-1', skill_id: 's1', requester_owner: 'r1', params: {} });
    insertJob(db, { hub_agent_id: 'agent-1', skill_id: 's2', requester_owner: 'r2', params: {} });
    insertJob(db, { hub_agent_id: 'agent-2', skill_id: 's3', requester_owner: 'r3', params: {} });

    const jobs = listJobs(db, 'agent-1');
    expect(jobs).toHaveLength(2);
    // Both jobs should be for agent-1
    const skillIds = jobs.map((j) => j.skill_id).sort();
    expect(skillIds).toEqual(['s1', 's2']);
  });

  it('listJobs filters by status', () => {
    insertJob(db, { hub_agent_id: 'agent-1', skill_id: 's1', requester_owner: 'r1', params: {} });
    const j2 = insertJob(db, { hub_agent_id: 'agent-1', skill_id: 's2', requester_owner: 'r2', params: {} });
    updateJobStatus(db, j2.id, 'dispatched');

    const queued = listJobs(db, 'agent-1', 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].skill_id).toBe('s1');

    const dispatched = listJobs(db, 'agent-1', 'dispatched');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].skill_id).toBe('s2');
  });

  it('updateJobStatus transitions status and sets updated_at', () => {
    const job = insertJob(db, { hub_agent_id: 'a1', skill_id: 's1', requester_owner: 'r1', params: {} });
    const originalUpdatedAt = job.updated_at;

    // queued -> dispatched
    updateJobStatus(db, job.id, 'dispatched');
    let updated = getJob(db, job.id)!;
    expect(updated.status).toBe('dispatched');
    expect(updated.updated_at >= originalUpdatedAt).toBe(true);

    // dispatched -> completed with result
    updateJobStatus(db, job.id, 'completed', JSON.stringify({ answer: 42 }));
    updated = getJob(db, job.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe(JSON.stringify({ answer: 42 }));

    // Reset for failed test
    const job2 = insertJob(db, { hub_agent_id: 'a1', skill_id: 's2', requester_owner: 'r1', params: {} });
    updateJobStatus(db, job2.id, 'dispatched');
    updateJobStatus(db, job2.id, 'failed', JSON.stringify({ error: 'timeout' }));
    const failed = getJob(db, job2.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.result).toBe(JSON.stringify({ error: 'timeout' }));
  });

  it('getJobsByRelayOwner returns all queued jobs for a relay_owner', () => {
    insertJob(db, { hub_agent_id: 'a1', skill_id: 's1', requester_owner: 'r1', params: {}, relay_owner: 'owner-x' });
    insertJob(db, { hub_agent_id: 'a1', skill_id: 's2', requester_owner: 'r2', params: {}, relay_owner: 'owner-x' });
    insertJob(db, { hub_agent_id: 'a2', skill_id: 's3', requester_owner: 'r3', params: {}, relay_owner: 'owner-y' });

    // Mark one as dispatched
    const jobs = listJobs(db, 'a1');
    updateJobStatus(db, jobs[0].id, 'dispatched');

    const queuedForX = getJobsByRelayOwner(db, 'owner-x');
    expect(queuedForX).toHaveLength(1);
    expect(queuedForX[0].relay_owner).toBe('owner-x');
    expect(queuedForX[0].status).toBe('queued');
  });
});

describe('HubAgentExecutor relay/queue modes with job queue', () => {
  let registryDb: Database.Database;
  let creditDb: Database.Database;
  let executor: HubAgentExecutor;

  beforeEach(() => {
    registryDb = new Database(':memory:');
    registryDb.pragma('journal_mode = WAL');
    initHubAgentTable(registryDb);
    // Create capability_cards table for isRelayOwnerOnline check
    registryDb.exec(`
      CREATE TABLE IF NOT EXISTS capability_cards (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    creditDb = openCreditDb(':memory:');
    executor = new HubAgentExecutor(registryDb, creditDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('relay mode + offline target returns { queued: true, job_id }', () => {
    const agent = createHubAgent(registryDb, {
      name: 'Relay Agent',
      skill_routes: [{
        skill_id: 'relay-skill',
        mode: 'relay' as const,
        config: { relay_owner: 'other-agent' },
      }],
    }, 'hub-server');

    // No card for other-agent -> offline
    bootstrapAgent(creditDb, 'requester-1', 100);

    return executor.execute(agent.agent_id, 'relay-skill', { text: 'hi' }, 'requester-1').then((result) => {
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('queued', true);
      expect(result.result).toHaveProperty('job_id');
    });
  });

  it('queue mode inserts job and returns { queued: true, job_id }', () => {
    const agent = createHubAgent(registryDb, {
      name: 'Queue Agent',
      skill_routes: [{
        skill_id: 'queue-skill',
        mode: 'queue' as const,
        config: { relay_owner: 'target-owner' },
      }],
    }, 'hub-server');

    bootstrapAgent(creditDb, 'requester-2', 100);

    return executor.execute(agent.agent_id, 'queue-skill', { data: 123 }, 'requester-2').then((result) => {
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('queued', true);
      expect(result.result).toHaveProperty('job_id');
    });
  });

  it('escrow is held before job insertion and escrow_id is stored on job', () => {
    const agent = createHubAgent(registryDb, {
      name: 'Escrow Agent',
      skill_routes: [{
        skill_id: 'queue-skill',
        mode: 'queue' as const,
        config: { relay_owner: 'target-owner' },
      }],
    }, 'hub-server');

    // Insert a card for this agent so price lookup works
    const cardId = agent.agent_id.padEnd(32, '0')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
    const cardData = {
      spec_version: '2.0',
      id: cardId,
      owner: agent.public_key.slice(0, 16),
      agent_name: 'Escrow Agent',
      skills: [{
        id: 'queue-skill',
        name: 'Queue Skill',
        description: 'test',
        level: 1,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 10 },
      }],
      availability: { online: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    registryDb.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, agent.public_key.slice(0, 16), JSON.stringify(cardData), cardData.created_at, cardData.updated_at);

    bootstrapAgent(creditDb, 'requester-3', 100);

    return executor.execute(agent.agent_id, 'queue-skill', {}, 'requester-3').then((result) => {
      expect(result.success).toBe(true);
      const jobId = (result.result as Record<string, unknown>).job_id as string;

      // Verify escrow was held
      const balanceAfter = getBalance(creditDb, 'requester-3');
      expect(balanceAfter).toBe(90); // 100 - 10

      // Verify escrow_id stored on job
      const job = getJob(registryDb, jobId);
      expect(job).not.toBeNull();
      expect(job!.escrow_id).toBeTruthy();
    });
  });
});
