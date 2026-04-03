/**
 * Weekly Verifiable Credential refresh scheduler.
 *
 * Runs a cron job (Sunday 00:00) to re-issue ReputationCredentials
 * for all active agents based on current execution metrics.
 * Idempotent — safe to run multiple times.
 *
 * @module credentials/vc-scheduler
 */

import { Cron } from 'croner';
import type Database from 'better-sqlite3';
import { buildReputationCredential } from './reputation-vc.js';
import { buildSkillCredential } from './skill-vc.js';
import type { VerifiableCredential } from './vc.js';
import type { SkillMilestone } from './skill-vc.js';

/** Stored credential record in the vc_credentials table. */
export interface StoredCredential {
  agent_id: string;
  credential_type: string;
  credential_json: string;
  issued_at: string;
}

/**
 * Ensures the vc_credentials table exists.
 */
export function ensureVCTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vc_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      credential_json TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      UNIQUE(agent_id, credential_type)
    )
  `);
}

/**
 * Upsert a credential — replaces existing credential of same type for same agent.
 */
export function upsertCredential(
  db: Database.Database,
  agentId: string,
  credentialType: string,
  vc: VerifiableCredential,
): void {
  ensureVCTable(db);
  db.prepare(`
    INSERT INTO vc_credentials (agent_id, credential_type, credential_json, issued_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id, credential_type)
    DO UPDATE SET credential_json = excluded.credential_json, issued_at = excluded.issued_at
  `).run(agentId, credentialType, JSON.stringify(vc), new Date().toISOString());
}

/**
 * Get all stored credentials for an agent.
 */
export function getStoredCredentials(
  db: Database.Database,
  agentId: string,
): StoredCredential[] {
  ensureVCTable(db);
  return db.prepare(`
    SELECT agent_id, credential_type, credential_json, issued_at
    FROM vc_credentials WHERE agent_id = ?
    ORDER BY credential_type
  `).all(agentId) as StoredCredential[];
}

/**
 * Refresh credentials for all active agents in the registry.
 * Idempotent — upserts credentials, so running multiple times is safe.
 *
 * @param registryDb - Registry database (for request_log, capability_cards).
 * @param signerKey - Platform Ed25519 private key for signing VCs.
 * @returns Number of credentials issued.
 */
export function refreshAllCredentials(
  registryDb: Database.Database,
  signerKey: Buffer,
): number {
  ensureVCTable(registryDb);

  const issuerDid = 'did:agentbnb:platform';
  let issued = 0;

  // Find all agents with executions
  const agents = registryDb.prepare(`
    SELECT DISTINCT cc.owner, cc.agent_id
    FROM (
      SELECT owner, json_extract(data, '$.agent_id') as agent_id
      FROM capability_cards
    ) cc
    WHERE cc.agent_id IS NOT NULL
  `).all() as Array<{ owner: string; agent_id: string }>;

  for (const agent of agents) {
    const agentDid = `did:agentbnb:${agent.agent_id}`;

    // Get execution metrics
    const metrics = registryDb.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
        AVG(CASE WHEN status = 'success' THEN latency_ms END) as avg_latency,
        MIN(created_at) as earliest,
        COALESCE(SUM(CASE WHEN status = 'success' THEN credits_charged ELSE 0 END), 0) as earned
      FROM request_log
      WHERE card_id IN (SELECT id FROM capability_cards WHERE owner = ?)
        AND action_type IS NULL
    `).get(agent.owner) as {
      total: number; successes: number; avg_latency: number | null;
      earliest: string | null; earned: number;
    } | undefined;

    const total = metrics?.total ?? 0;
    if (total === 0) continue;

    const successRate = total > 0 ? (metrics!.successes ?? 0) / total : 0;

    // Per-skill stats
    const skillRows = registryDb.prepare(`
      SELECT skill_id, COUNT(*) as uses,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes
      FROM request_log
      WHERE card_id IN (SELECT id FROM capability_cards WHERE owner = ?)
        AND skill_id IS NOT NULL AND action_type IS NULL
      GROUP BY skill_id
    `).all(agent.owner) as Array<{ skill_id: string; uses: number; successes: number }>;

    // Feedback count
    let feedbackCount = 0;
    try {
      const fb = registryDb.prepare(`SELECT COUNT(*) as cnt FROM feedback WHERE provider_agent = ?`).get(agent.agent_id) as { cnt: number } | undefined;
      feedbackCount = fb?.cnt ?? 0;
    } catch { /* table may not exist */ }

    // Issue ReputationCredential
    const repVC = buildReputationCredential({
      agentDid,
      stats: {
        totalTransactions: total,
        successRate,
        avgLatencyMs: metrics?.avg_latency ?? 0,
        totalEarned: metrics?.earned ?? 0,
        activeSince: metrics?.earliest ?? new Date().toISOString(),
      },
      skills: skillRows.map((s) => ({
        id: s.skill_id,
        uses: s.uses,
        rating: s.uses > 0 ? Math.round((s.successes / s.uses) * 50) / 10 : 0,
      })),
      feedbackCount,
      signerKey,
      issuerDid,
    });
    upsertCredential(registryDb, agent.agent_id, 'AgentReputationCredential', repVC);
    issued++;

    // Issue SkillCredentials for milestones
    const milestones: SkillMilestone[] = [1000, 500, 100];
    for (const skill of skillRows) {
      const milestone = milestones.find((m) => skill.uses >= m);
      if (milestone) {
        const skillVC = buildSkillCredential({
          agentDid,
          skillId: skill.skill_id,
          skillName: skill.skill_id,
          totalUses: skill.uses,
          milestone,
          avgRating: skill.uses > 0 ? Math.round((skill.successes / skill.uses) * 50) / 10 : 0,
          signerKey,
          issuerDid,
        });
        upsertCredential(registryDb, agent.agent_id, `AgentSkillCredential:${skill.skill_id}`, skillVC);
        issued++;
      }
    }
  }

  return issued;
}

/**
 * Start the weekly VC refresh cron job.
 * Runs every Sunday at 00:00 UTC.
 *
 * @param registryDb - Registry database.
 * @param signerKey - Platform Ed25519 private key.
 * @returns The Cron instance (call .stop() to cancel).
 */
export function startVCRefreshScheduler(
  registryDb: Database.Database,
  signerKey: Buffer,
): Cron {
  return new Cron('0 0 * * 0', () => {
    try {
      const count = refreshAllCredentials(registryDb, signerKey);
      if (count > 0) {
        console.log(`[vc-scheduler] Refreshed ${count} credential(s)`);
      }
    } catch (err) {
      console.error('[vc-scheduler] Refresh failed:', (err as Error).message);
    }
  });
}
