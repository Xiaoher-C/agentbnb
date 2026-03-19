import type Database from 'better-sqlite3';
import { getHubAgent } from './store.js';
import { ApiExecutor } from '../skills/api-executor.js';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';
import type { ExecutionResult } from '../skills/executor.js';
import type { ApiSkillConfig } from '../skills/skill-config.js';
import type { SkillRoute } from './types.js';

/**
 * Hub Agent skill executor.
 * Routes skill execution requests to the appropriate backend based on the
 * agent's skill routing table.
 *
 * Supported modes:
 *   - direct_api: Calls external REST APIs via ApiExecutor with decrypted secrets
 *   - relay: Not yet available (requires connected session agent)
 *   - queue: Not yet implemented (Phase 37)
 */
export class HubAgentExecutor {
  constructor(
    private registryDb: Database.Database,
    private creditDb: Database.Database,
  ) {}

  /**
   * Execute a skill on a Hub Agent.
   *
   * @param agentId - The Hub Agent ID.
   * @param skillId - The skill_id to execute from the agent's routing table.
   * @param params - Input parameters for the skill.
   * @param requesterOwner - Optional requester identifier for credit escrow.
   * @returns ExecutionResult with success status, result/error, and latency_ms.
   */
  async execute(
    agentId: string,
    skillId: string,
    params: Record<string, unknown>,
    requesterOwner?: string,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. Load agent
    const agent = getHubAgent(this.registryDb, agentId);
    if (!agent) {
      return { success: false, error: 'Hub Agent not found', latency_ms: Date.now() - startTime };
    }

    // 2. Check status
    if (agent.status === 'paused') {
      return { success: false, error: 'Hub Agent is paused', latency_ms: Date.now() - startTime };
    }

    // 3. Find skill route
    const route = agent.skill_routes.find((r) => r.skill_id === skillId);
    if (!route) {
      return { success: false, error: 'Skill not found in routing table', latency_ms: Date.now() - startTime };
    }

    // 4. Dispatch based on mode
    switch (route.mode) {
      case 'relay':
        return { success: false, error: 'relay mode requires connected session agent', latency_ms: 0 };

      case 'queue':
        return { success: false, error: 'queue mode not yet implemented (Phase 37)', latency_ms: 0 };

      case 'direct_api':
        return this.executeDirectApi(route, agent, params, requesterOwner, startTime);
    }
  }

  /**
   * Execute a direct_api skill route via ApiExecutor.
   * Handles secret injection and credit escrow.
   */
  private async executeDirectApi(
    route: SkillRoute & { mode: 'direct_api' },
    agent: ReturnType<typeof getHubAgent> & { secrets?: Record<string, string> },
    params: Record<string, unknown>,
    requesterOwner: string | undefined,
    startTime: number,
  ): Promise<ExecutionResult> {
    // Build ApiSkillConfig with decrypted secrets injected
    const config = this.injectSecrets(route.config as ApiSkillConfig, agent.secrets);

    // Credit escrow: hold before execution
    const pricing = (route.config as ApiSkillConfig).pricing;
    const creditsPerCall = pricing?.credits_per_call ?? 0;
    let escrowId: string | undefined;

    if (requesterOwner && creditsPerCall > 0) {
      const cardId = agent.agent_id.padEnd(32, '0')
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
      escrowId = holdEscrow(this.creditDb, requesterOwner, creditsPerCall, cardId);
    }

    try {
      const apiExecutor = new ApiExecutor();
      const modeResult = await apiExecutor.execute(config, params);
      const result: ExecutionResult = {
        ...modeResult,
        latency_ms: Date.now() - startTime,
      };

      // Settle escrow on success, release on failure
      if (escrowId) {
        if (result.success) {
          settleEscrow(this.creditDb, escrowId, agent.agent_id);
        } else {
          releaseEscrow(this.creditDb, escrowId);
        }
      }

      return result;
    } catch (err) {
      // Release escrow on unexpected error
      if (escrowId) {
        releaseEscrow(this.creditDb, escrowId);
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        latency_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Injects decrypted secrets into the API skill config's auth field.
   * If secrets contain 'api_key' and auth type is 'bearer', replaces the token.
   * If secrets contain 'api_key' and auth type is 'apikey', replaces the key.
   */
  private injectSecrets(
    config: ApiSkillConfig,
    secrets?: Record<string, string>,
  ): ApiSkillConfig {
    if (!secrets || Object.keys(secrets).length === 0) {
      return config;
    }

    // Deep clone config to avoid mutating the original
    const injected = JSON.parse(JSON.stringify(config)) as ApiSkillConfig;

    // If there's an api_key secret, inject it into the auth config
    const apiKey = secrets.api_key ?? secrets.API_KEY;
    if (apiKey && injected.auth) {
      switch (injected.auth.type) {
        case 'bearer':
          injected.auth.token = apiKey;
          break;
        case 'apikey':
          injected.auth.key = apiKey;
          break;
        // basic auth: could inject username/password from secrets if needed
      }
    }

    return injected;
  }
}
