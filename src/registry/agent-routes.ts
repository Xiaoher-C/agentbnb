import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { listCards } from './store.js';
import type { CapabilityCard, CapabilityCardV2, AgentProfileV2 } from '../types/index.js';

// Tier threshold constants — used for trust/reputation tier computation
const TIER_1_MIN_EXEC = 10;
const TIER_2_MIN_EXEC = 50;
const TIER_2_MIN_SUCCESS_RATE = 0.85;

function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Options for agentRoutesPlugin. */
export interface AgentRoutesOptions {
  registryDb: Database.Database;
  creditDb?: Database.Database;
}

/**
 * Fastify plugin that registers agent profile endpoints.
 *
 *   GET /api/agents        — List all agent profiles sorted by reputation
 *   GET /api/agents/:owner — Get agent profile (AgentProfileV2)
 */
export async function agentRoutesPlugin(
  fastify: FastifyInstance,
  options: AgentRoutesOptions,
): Promise<void> {
  const { registryDb: db } = options;

  /**
   * GET /api/agents — Returns a reputation-sorted list of all agent profiles.
   *
   * Each agent profile is aggregated from their capability cards and request log.
   * Sorted by success_rate DESC (nulls last), then total_earned DESC.
   * credits_earned is computed via GROUP BY aggregate SQL, never stored as a column.
   */
  fastify.get('/api/agents', {
    schema: {
      tags: ['agents'],
      summary: 'List all agent profiles sorted by reputation',
      response: {
        200: {
          type: 'object',
          properties: { items: { type: 'array' }, total: { type: 'integer' } },
        },
      },
    },
  }, async (_request, reply) => {
    const allCards = listCards(db);

    // Group cards by owner
    const ownerMap = new Map<string, CapabilityCard[]>();
    for (const card of allCards) {
      const existing = ownerMap.get(card.owner) ?? [];
      existing.push(card);
      ownerMap.set(card.owner, existing);
    }

    // Compute credits_earned per owner via single aggregate SQL (NOT per-owner loop)
    const creditsStmt = db.prepare(`
      SELECT cc.owner,
             SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END) as credits_earned
      FROM capability_cards cc
      LEFT JOIN request_log rl ON rl.card_id = cc.id
      GROUP BY cc.owner
    `);
    const creditsRows = creditsStmt.all() as Array<{ owner: string; credits_earned: number }>;
    const creditsMap = new Map(creditsRows.map((r) => [r.owner, r.credits_earned ?? 0]));

    // Batch member_since query — single SQL instead of per-owner loop (N+1 fix)
    const memberSinceRows = db.prepare(
      'SELECT owner, MIN(created_at) as earliest FROM capability_cards GROUP BY owner'
    ).all() as Array<{ owner: string; earliest: string }>;
    const memberSinceMap = new Map(memberSinceRows.map((r) => [r.owner, r.earliest]));

    // Build agent profiles
    const agents = Array.from(ownerMap.entries()).map(([owner, cards]) => {
      const skillCount = cards.reduce((sum, card) => sum + ((card as unknown as CapabilityCardV2).skills?.length ?? 1), 0);
      const successRates = cards
        .map((c) => c.metadata?.success_rate)
        .filter((r): r is number => r != null);
      const avgSuccessRate =
        successRates.length > 0
          ? successRates.reduce((a, b) => a + b, 0) / successRates.length
          : null;

      return {
        owner,
        skill_count: skillCount,
        success_rate: avgSuccessRate,
        total_earned: creditsMap.get(owner) ?? 0,
        member_since: memberSinceMap.get(owner) ?? new Date().toISOString(),
      };
    });

    // Sort by reputation: success_rate DESC (nulls last), then total_earned DESC
    agents.sort((a, b) => {
      const aRate = a.success_rate ?? -1;
      const bRate = b.success_rate ?? -1;
      if (bRate !== aRate) return bRate - aRate;
      return b.total_earned - a.total_earned;
    });

    return reply.send({ items: agents, total: agents.length });
  });

  /**
   * GET /api/agents/:owner — Returns AgentProfileV2 for Hub v2.
   *
   * Returns 404 if the owner has no capability cards registered.
   * Computes trust_metrics, execution_proofs, and performance_tier from
   * request_log at query time (no snapshots in phase 1).
   * Also includes backwards-compatible `profile` and `recent_activity` fields.
   */
  fastify.get('/api/agents/:owner', {
    schema: {
      tags: ['agents'],
      summary: 'Get agent profile, skills, and recent activity (AgentProfileV2)',
      params: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { owner } = request.params as { owner: string };
    const ownerCards = listCards(db, owner);

    if (ownerCards.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const resolvedOwner = ownerCards[0]?.owner ?? owner;
    const ownerCardIds = ownerCards.map((card) => card.id);
    const cardIdPlaceholders = buildSqlPlaceholders(ownerCardIds.length);
    const joinedAt =
      ownerCards
        .map((card) => card.created_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort((left, right) => left.localeCompare(right))[0] ??
      new Date().toISOString();
    const latestCardUpdate =
      ownerCards
        .map((card) => card.updated_at ?? card.created_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort((left, right) => right.localeCompare(left))[0] ?? joinedAt;

    const lastActiveStmt = db.prepare(
      `SELECT MAX(created_at) as last_req FROM request_log WHERE card_id IN (${cardIdPlaceholders})`,
    );
    const lastActiveRow = lastActiveStmt.get(...ownerCardIds) as { last_req: string | null } | undefined;
    const lastActive = lastActiveRow?.last_req ?? latestCardUpdate ?? joinedAt;

    // --- Trust Metrics (from request_log, all-time) ---
    const metricsStmt = db.prepare(`
      SELECT
        SUM(CASE WHEN rl.failure_reason IS NULL OR rl.failure_reason IN ('bad_execution','auth_error')
            THEN 1 ELSE 0 END) as total,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as successes,
        AVG(CASE WHEN rl.status = 'success' THEN rl.latency_ms END) as avg_latency,
        COUNT(DISTINCT rl.requester) as unique_requesters,
        COUNT(DISTINCT CASE WHEN rl.status = 'success' THEN rl.requester END) as repeat_success_requesters
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
    `);
    const metricsRow = metricsStmt.get(...ownerCardIds) as {
      total: number;
      successes: number;
      avg_latency: number | null;
      unique_requesters: number;
      repeat_success_requesters: number;
    } | undefined;

    const totalExec = metricsRow?.total ?? 0;
    const successExec = metricsRow?.successes ?? 0;
    const successRate = totalExec > 0 ? successExec / totalExec : 0;
    const avgLatency = metricsRow?.avg_latency ?? 0;

    // refund_rate: proportion of requests that resulted in no credits charged (failure/timeout)
    const refundRate = totalExec > 0 ? (totalExec - successExec) / totalExec : 0;

    // repeat_use_rate: unique requesters who had at least one success / total unique requesters
    const uniqueReq = metricsRow?.unique_requesters ?? 0;
    const repeatRate = uniqueReq > 0 ? (metricsRow?.repeat_success_requesters ?? 0) / uniqueReq : 0;

    // 7-day trend: daily execution counts
    const trendStmt = db.prepare(`
      SELECT
        DATE(rl.created_at) as day,
        COUNT(*) as count,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
        AND rl.created_at >= DATE('now', '-7 days')
      GROUP BY DATE(rl.created_at)
      ORDER BY day ASC
    `);
    const trend_7d = (trendStmt.all(...ownerCardIds) as Array<{ day: string; count: number; success: number }>)
      .map((r) => ({ date: r.day, count: r.count, success: r.success }));

    // --- Performance Tier (metrics-only, no verification implication) ---
    let performanceTier: 0 | 1 | 2 = 0;
    if (totalExec > TIER_1_MIN_EXEC) performanceTier = 1;
    if (totalExec > TIER_2_MIN_EXEC && successRate >= TIER_2_MIN_SUCCESS_RATE) performanceTier = 2;

    // --- Execution Proofs (last 10, proof_source='request_log' in phase 1) ---
    const proofsStmt = db.prepare(`
      SELECT rl.card_name, rl.status, rl.latency_ms, rl.id, rl.created_at
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders}) AND rl.action_type IS NULL
      ORDER BY rl.created_at DESC
      LIMIT 10
    `);
    const proofRows = proofsStmt.all(...ownerCardIds) as Array<{
      card_name: string;
      status: 'success' | 'failure' | 'timeout';
      latency_ms: number;
      id: string;
      created_at: string;
    }>;

    const statusToOutcomeClass = (s: string): 'completed' | 'partial' | 'failed' | 'cancelled' => {
      if (s === 'success') return 'completed';
      if (s === 'timeout') return 'cancelled';
      return 'failed';
    };

    const executionProofs: AgentProfileV2['execution_proofs'] = proofRows.map((r) => ({
      action: r.card_name,
      status: r.status === 'timeout' ? 'timeout' : r.status,
      outcome_class: statusToOutcomeClass(r.status),
      latency_ms: r.latency_ms,
      receipt_id: r.id,
      proof_source: 'request_log' as const,
      timestamp: r.created_at,
    }));

    // --- Suitability from most recent v2.0 card ---
    const v2Card = ownerCards.find((c) => (c as unknown as CapabilityCardV2).spec_version === '2.0') as CapabilityCardV2 | undefined;
    const suitability = v2Card?.suitability;

    // --- Learning from most recent v2.0 card ---
    const learning: AgentProfileV2['learning'] = {
      known_limitations: v2Card?.learning?.known_limitations ?? [],
      common_failure_patterns: v2Card?.learning?.common_failure_patterns ?? [],
      recent_improvements: v2Card?.learning?.recent_improvements ?? [],
      critiques: v2Card?.learning?.critiques ?? [],
    };

    // --- Recent activity (backwards compat) ---
    const activityStmt = db.prepare(`
      SELECT rl.id, rl.card_name, rl.requester, rl.status, rl.credits_charged, rl.created_at
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders})
      ORDER BY rl.created_at DESC
      LIMIT 10
    `);
    const recentActivity = activityStmt.all(...ownerCardIds) as AgentProfileV2['recent_activity'];

    // --- Backwards-compat profile aggregate ---
    const skillCount = ownerCards.reduce((sum, card) => sum + ((card as unknown as CapabilityCardV2).skills?.length ?? 1), 0);
    const creditsStmt = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN rl.status = 'success' THEN rl.credits_charged ELSE 0 END), 0) as credits_earned
      FROM request_log rl
      WHERE rl.card_id IN (${cardIdPlaceholders})
    `);
    const creditsRow = creditsStmt.get(...ownerCardIds) as { credits_earned: number } | undefined;

    const response: AgentProfileV2 = {
      owner: resolvedOwner,
      agent_name: v2Card?.agent_name,
      short_description: v2Card?.short_description,
      joined_at: joinedAt,
      last_active: lastActive,
      performance_tier: performanceTier,
      verification_badges: [], // Phase 1: no verification mechanism yet
      authority: {
        authority_source: 'self',
        verification_status: 'none',
      },
      suitability,
      trust_metrics: {
        total_executions: totalExec,
        successful_executions: successExec,
        success_rate: successRate,
        avg_latency_ms: Math.round(avgLatency),
        refund_rate: refundRate,
        repeat_use_rate: repeatRate,
        trend_7d,
        snapshot_at: null,
        aggregation_window: 'all',
      },
      execution_proofs: executionProofs,
      learning,
      skills: ownerCards,
      recent_activity: recentActivity,
    };

    // Backwards-compat: also include `profile` shape for Hub v1 consumers
    return reply.send({
      ...response,
      profile: {
        owner: resolvedOwner,
        skill_count: skillCount,
        success_rate: successRate > 0 ? successRate : null,
        total_earned: creditsRow?.credits_earned ?? 0,
        member_since: joinedAt,
      },
    });
  });

  /**
   * GET /api/agents/:agent_id/maturity-evidence — v10 Maturity Evidence (ADR-022).
   *
   * Returns the evidence-first signal set used by Hub Agent Profile pages.
   * Per ADR-022 maturity is NEVER collapsed into a single score — instead we
   * surface a small set of independently-meaningful evidence categories.
   *
   * Public read (no auth) — matches existing GET /api/agents/:owner policy.
   * Computed on demand (no caching) — v0 is acceptable for current traffic.
   *
   * Each rental table query is wrapped in try/catch so an older registry that
   * has not yet applied the v10 migrations returns zero values instead of 500.
   */
  fastify.get('/api/agents/:agent_id/maturity-evidence', {
    schema: {
      tags: ['agents'],
      summary: 'Get v10 Maturity Evidence for an agent (ADR-022)',
      params: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id'],
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    // 404 if agent not found in cards table (matches GET /api/agents/:owner policy).
    // listCards looks up via both owner column and json_extract(data,'$.agent_id'),
    // so we accept either form of identifier.
    const ownerCards = listCards(db, agent_id);
    if (ownerCards.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const cardIds = ownerCards.map((c) => c.id);

    // --- platform_observed_sessions: ended rental sessions for this agent ---
    let platformObservedSessions = 0;
    try {
      const row = db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) as count FROM rental_sessions
           WHERE agent_id = ? AND status IN ('closed', 'settled')`,
        )
        .get(agent_id);
      platformObservedSessions = row?.count ?? 0;
    } catch {
      // Table missing on older migrations — treat as zero
    }

    // --- completed_tasks: completed threads across this agent's sessions ---
    let completedTasks = 0;
    try {
      const row = db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) as count FROM rental_threads rt
           INNER JOIN rental_sessions rs ON rs.id = rt.session_id
           WHERE rs.agent_id = ? AND rt.status = 'completed'`,
        )
        .get(agent_id);
      completedTasks = row?.count ?? 0;
    } catch {
      // ignore
    }

    // --- repeat_renters: distinct renter_did with > 1 session for this agent ---
    let repeatRenters = 0;
    try {
      const row = db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) as count FROM (
             SELECT renter_did FROM rental_sessions
             WHERE agent_id = ?
             GROUP BY renter_did
             HAVING COUNT(*) > 1
           )`,
        )
        .get(agent_id);
      repeatRenters = row?.count ?? 0;
    } catch {
      // ignore
    }

    // --- artifact_examples: top 3 most recently ended outcome pages ---
    interface ArtifactRow {
      share_token: string;
      ended_at: string | null;
      end_reason: string | null;
    }
    let artifactExamples: Array<{
      share_token: string;
      ended_at: number;
      summary: string;
    }> = [];
    try {
      const rows = db
        .prepare<[string], ArtifactRow>(
          `SELECT share_token, ended_at, end_reason FROM rental_sessions
           WHERE agent_id = ? AND status IN ('closed', 'settled') AND share_token IS NOT NULL
           ORDER BY ended_at DESC
           LIMIT 3`,
        )
        .all(agent_id);
      artifactExamples = rows.map((r) => ({
        share_token: r.share_token,
        ended_at: r.ended_at ? Date.parse(r.ended_at) : 0,
        summary: r.end_reason ?? 'completed',
      }));
    } catch {
      // ignore
    }

    // --- verified_tools: distinct tools mentioned in card metadata for this owner ---
    // Pulls from card-level powered_by[] / metadata.apis_used[] (v1) and from each
    // skill-level powered_by[] / metadata.apis_used[] (v2). Deduped + sorted.
    const toolSet = new Set<string>();
    const collectTools = (
      poweredBy: ReadonlyArray<{ provider?: string }> | undefined,
      apisUsed: ReadonlyArray<string> | undefined,
    ): void => {
      if (poweredBy) {
        for (const pb of poweredBy) {
          if (pb?.provider) toolSet.add(pb.provider);
        }
      }
      if (apisUsed) {
        for (const api of apisUsed) toolSet.add(api);
      }
    };

    for (const card of ownerCards) {
      collectTools(card.powered_by, card.metadata?.apis_used);
      const v2Skills = (card as unknown as CapabilityCardV2).skills;
      if (Array.isArray(v2Skills)) {
        for (const skill of v2Skills) {
          collectTools(skill.powered_by, skill.metadata?.apis_used);
        }
      }
    }
    const verifiedTools = Array.from(toolSet).sort();

    // --- response_reliability: share of completed sessions w/o error end_reason ---
    let responseReliability = 0;
    try {
      const row = db
        .prepare<[string], { total: number; clean: number }>(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN end_reason IS NULL OR end_reason IN ('completed') THEN 1 ELSE 0 END) as clean
           FROM rental_sessions
           WHERE agent_id = ? AND status IN ('closed', 'settled')`,
        )
        .get(agent_id);
      const total = row?.total ?? 0;
      const clean = row?.clean ?? 0;
      responseReliability = total > 0 ? clean / total : 0;
    } catch {
      // ignore
    }

    // --- renter rating average + count from rental_ratings ---
    let renterRatingAvg: number | null = null;
    let renterRatingCount = 0;
    try {
      const row = db
        .prepare<[string], { avg: number | null; count: number }>(
          `SELECT AVG(stars) as avg, COUNT(*) as count
           FROM rental_ratings
           WHERE rated_agent_id = ?`,
        )
        .get(agent_id);
      renterRatingCount = row?.count ?? 0;
      renterRatingAvg = renterRatingCount > 0 && row?.avg != null ? row.avg : null;
    } catch {
      // ignore
    }

    // Fallback for fresh agents with no rental sessions: derive response_reliability
    // from request_log so newly-published agents surface at least one signal.
    if (platformObservedSessions === 0 && cardIds.length > 0) {
      try {
        const placeholders = buildSqlPlaceholders(cardIds.length);
        const row = db
          .prepare<string[], { total: number; clean: number }>(
            `SELECT
               COUNT(*) as total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as clean
             FROM request_log
             WHERE card_id IN (${placeholders})`,
          )
          .get(...cardIds);
        const total = row?.total ?? 0;
        const clean = row?.clean ?? 0;
        if (total > 0) {
          responseReliability = clean / total;
        }
      } catch {
        // ignore
      }
    }

    const evidence = {
      platform_observed_sessions: platformObservedSessions,
      completed_tasks: completedTasks,
      repeat_renters: repeatRenters,
      artifact_examples: artifactExamples,
      verified_tools: verifiedTools,
      response_reliability: responseReliability,
      renter_rating_avg: renterRatingAvg,
      renter_rating_count: renterRatingCount,
    };

    // Flattened evidence_categories for UI rendering. Maturity is intentionally
    // NOT collapsed into a single number — the UI displays each row as its own
    // signal (ADR-022).
    const evidence_categories: Array<{
      key: string;
      value: number | string;
      kind: 'count' | 'rate' | 'avg' | 'list';
    }> = [
      { key: 'platform_observed_sessions', value: platformObservedSessions, kind: 'count' },
      { key: 'completed_tasks', value: completedTasks, kind: 'count' },
      { key: 'repeat_renters', value: repeatRenters, kind: 'count' },
      { key: 'artifact_examples', value: artifactExamples.length, kind: 'list' },
      { key: 'verified_tools', value: verifiedTools.length, kind: 'list' },
      { key: 'response_reliability', value: responseReliability, kind: 'rate' },
      {
        key: 'renter_rating_avg',
        value: renterRatingAvg ?? 0,
        kind: 'avg',
      },
      { key: 'renter_rating_count', value: renterRatingCount, kind: 'count' },
    ];

    return reply.send({
      agent_id,
      evidence,
      evidence_categories,
    });
  });
}
