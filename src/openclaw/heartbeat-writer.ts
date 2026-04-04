import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { AutonomyConfig } from '../autonomy/tiers.js';
import type { BudgetConfig } from '../credit/budget.js';
import type { AgentBnBConfig } from '../cli/config.js';

/** HTML comment marker for the start of the AgentBnB rules block. */
export const HEARTBEAT_MARKER_START = '<!-- agentbnb:start -->';

/** HTML comment marker for the end of the AgentBnB rules block. */
export const HEARTBEAT_MARKER_END = '<!-- agentbnb:end -->';

/**
 * Generates a ready-to-paste HEARTBEAT.md rules block for OpenClaw agents.
 *
 * The block is wrapped in HTML comment markers so `injectHeartbeatSection` can
 * find and replace it without destroying surrounding content.
 *
 * @param autonomy - Owner-configured autonomy tier thresholds.
 * @param budget - Owner-configured credit budget config.
 * @returns Markdown string with start/end markers included.
 */
export function generateHeartbeatSection(
  autonomy: AutonomyConfig,
  budget: BudgetConfig,
  config?: AgentBnBConfig,
): string {
  const t1 = autonomy.tier1_max_credits;
  const t2 = autonomy.tier2_max_credits;
  const reserve = budget.reserve_credits;

  const dailyLimit = config?.provider_daily_limit ?? 0;
  const dailyLimitLabel = dailyLimit === 0 ? 'unlimited' : `${dailyLimit}/day`;

  return [
    HEARTBEAT_MARKER_START,
    '## AgentBnB Protocol',
    '',
    'You are a participant in the AgentBnB capability sharing network.',
    '',
    '### Sharing Rules',
    '- When your idle_rate exceeds 70%, automatically share idle capabilities',
    '- Accept incoming requests that match your published Capability Card',
    '- Track credit earnings and report to owner weekly',
    '',
    '### Requesting Rules',
    '- When you encounter a task you cannot complete with local skills:',
    '  1. Query AgentBnB network for matching capabilities',
    '  2. If found and credit sufficient, automatically request',
    '  3. Integrate result into your current workflow',
    '- Budget limits:',
    `  - < ${t1} credits: auto-execute, no notification`,
    `  - ${t1}-${t2} credits: execute, notify owner after`,
    `  - > ${t2} credits: ask owner before executing`,
    '',
    '### Credit Management',
    `- Maintain minimum balance of ${reserve} credits (reserve for emergencies)`,
    `- If balance drops below ${reserve}, increase sharing priority`,
    '- If balance exceeds 500, notify owner of surplus',
    '',
    '### Provider Control',
    '',
    'Owner can control incoming rental requests via natural language.',
    `Current daily limit: ${dailyLimitLabel}.`,
    '',
    '**All commands require the AGENTBNB_DIR prefix for your agent.**',
    '',
    '| Owner says | Command |',
    '|------------|---------|',
    '| Stop accepting / 停止接單 | `agentbnb config set provider-accepting false` |',
    '| Start accepting / 開始接單 | `agentbnb config set provider-accepting true` |',
    '| Block \\<agent_id\\> / 封鎖 | `agentbnb config set provider-blacklist <current>,<agent_id>` |',
    '| Unblock \\<agent_id\\> / 解除封鎖 | `agentbnb config set provider-blacklist <without_agent_id>` |',
    '| Set daily limit to N | `agentbnb config set provider-daily-limit N` |',
    '| Remove daily limit | `agentbnb config set provider-daily-limit 0` |',
    '| Check status / 查看狀態 | `agentbnb config get provider-accepting` |',
    '',
    'Before modifying blacklist: read current value first with `agentbnb config get provider-blacklist`,',
    'then append or remove the agent ID from the comma-separated list.',
    'Changes take effect immediately — no serve restart needed.',
    HEARTBEAT_MARKER_END,
  ].join('\n');
}

/**
 * Injects a heartbeat section into a HEARTBEAT.md file.
 *
 * Three behaviors:
 * - File does not exist: creates file with the section + trailing newline.
 * - File exists with markers: replaces content between markers (inclusive) with new section.
 * - File exists without markers: appends newline + section + trailing newline.
 *
 * @param heartbeatPath - Absolute or relative path to the HEARTBEAT.md file.
 * @param section - The full section string including start/end markers.
 */
export function injectHeartbeatSection(heartbeatPath: string, section: string): void {
  if (!existsSync(heartbeatPath)) {
    writeFileSync(heartbeatPath, section + '\n', 'utf-8');
    return;
  }

  let content = readFileSync(heartbeatPath, 'utf-8');
  const startIdx = content.indexOf(HEARTBEAT_MARKER_START);
  const endIdx = content.indexOf(HEARTBEAT_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing block (inclusive of both markers)
    content =
      content.slice(0, startIdx) +
      section +
      content.slice(endIdx + HEARTBEAT_MARKER_END.length);
  } else {
    // Append to file without markers
    content = content + '\n' + section + '\n';
  }

  writeFileSync(heartbeatPath, content, 'utf-8');
}
