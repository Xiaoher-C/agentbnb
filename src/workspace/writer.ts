/**
 * Workspace writer — mutates OpenClaw workspace markdown files.
 *
 * All functions are idempotent: calling them twice does not produce duplicates.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal skill entry for SOUL.md table generation. */
export interface SkillEntry {
  id: string;
  name?: string;
  description?: string;
  pricing?: { credits_per_call: number };
}

const SOUL_SECTION_HEADER = '## AgentBnB Network Trading';
const HEARTBEAT_SECTION_HEADER = '<!-- agentbnb-trading-rules -->';
const TOOLS_SECTION_HEADER = '<!-- agentbnb-cli -->';

/** Renders the skills table rows from a list of SkillEntry objects. */
function renderSkillsTable(skills: SkillEntry[]): string {
  const rows = skills
    .map((s) => {
      const price = s.pricing?.credits_per_call ?? 3;
      const desc = (s.description ?? '').split('\n')[0]?.trim().slice(0, 60) ?? '';
      return `| ${s.id} | ${price} cr | ${desc} |`;
    })
    .join('\n');

  return ['| Skill | Price | Description |', '|-------|-------|-------------|', rows].join('\n');
}

/**
 * Appends the "## AgentBnB Network Trading" block to SOUL.md.
 * No-op if the section already exists.
 *
 * @param soulPath - Absolute path to the SOUL.md file.
 * @param skills - Skills to include in the shared skills table.
 * @param agentbnbDir - Path to the agent's .agentbnb directory (used in CLI examples).
 */
export function appendSoulMdTradingSection(
  soulPath: string,
  skills: SkillEntry[],
  agentbnbDir: string,
): void {
  const content = readFileSync(soulPath, 'utf-8');
  if (content.includes(SOUL_SECTION_HEADER)) return;

  const skillsTable = renderSkillsTable(skills);

  const section = [
    '',
    '---',
    SOUL_SECTION_HEADER,
    '',
    `This agent is connected to the [AgentBnB](https://agentbnb.dev) P2P capability-sharing network.`,
    '',
    '### Shared Skills',
    skillsTable,
    '',
    '### Trading Rules',
    `- AGENTBNB_DIR: ${agentbnbDir}`,
    '- Reserve floor: 20 credits (never auto-spend below this)',
    '- Auto-trade limit: 10 credits per transaction (above → ask owner)',
    `- Request capabilities: \`AGENTBNB_DIR=${agentbnbDir} agentbnb request <card_id> --skill <skill> --params '<json>'\``,
    `- Check balance: \`AGENTBNB_DIR=${agentbnbDir} agentbnb status\``,
    `- Browse network: \`AGENTBNB_DIR=${agentbnbDir} agentbnb discover\``,
    '',
    '### GEP Evolution',
    'AgentBnB tracks capability evolution in the `gep/` directory:',
    '- `gep/genes.json` — capability traits earned through successful executions',
    '- `gep/capsules.json` — packaged skill bundles for sharing',
    '- `gep/events.jsonl` — append-only evolution event log',
    '',
    '### How to Earn',
    'Credits are escrowed when another agent hires your skill and settled on success (5% network fee applies).',
  ].join('\n');

  writeFileSync(soulPath, content + section, 'utf-8');
}

/**
 * Updates the skills table in an existing AgentBnB section of SOUL.md.
 * No-op if the section does not exist (call appendSoulMdTradingSection first).
 *
 * @param soulPath - Absolute path to the SOUL.md file.
 * @param skills - Updated skills list for the table.
 */
export function updateSoulMdSkillsTable(soulPath: string, skills: SkillEntry[]): void {
  const content = readFileSync(soulPath, 'utf-8');
  if (!content.includes(SOUL_SECTION_HEADER)) return;

  const newTable = renderSkillsTable(skills);

  // Replace the skills table (everything between "### Shared Skills" and the next "###" or "---" or end)
  const updated = content.replace(
    /(### Shared Skills\n)\|.*?\|[\s\S]*?(?=\n###|\n---|\n$)/,
    `$1${newTable}\n`,
  );

  if (updated !== content) {
    writeFileSync(soulPath, updated, 'utf-8');
  }
}

/**
 * Appends the AgentBnB trading cycle block to HEARTBEAT.md.
 * No-op if the section already exists.
 *
 * @param heartbeatPath - Absolute path to HEARTBEAT.md.
 * @param agentbnbDir - Path to the agent's .agentbnb directory.
 */
export function appendHeartbeatTradingSection(heartbeatPath: string, agentbnbDir: string): void {
  if (!existsSync(heartbeatPath)) return;
  const content = readFileSync(heartbeatPath, 'utf-8');
  if (content.includes(HEARTBEAT_SECTION_HEADER)) return;

  const section = [
    '',
    HEARTBEAT_SECTION_HEADER,
    '## AgentBnB Trading Cycle',
    '',
    '- Every idle period (>10 min): check `AGENTBNB_DIR=' + agentbnbDir + ' agentbnb status`',
    '- If balance < 20 credits: pause auto-requests, notify owner',
    '- If idle_rate > 70%: auto-share idle skills to network',
    '- Settle completed escrows automatically (no action needed)',
    '<!-- /agentbnb-trading-rules -->',
  ].join('\n');

  writeFileSync(heartbeatPath, content + section, 'utf-8');
}

/**
 * Appends the AgentBnB CLI reference block to TOOLS.md.
 * No-op if the section already exists.
 *
 * @param toolsPath - Absolute path to TOOLS.md.
 * @param agentbnbDir - Path to the agent's .agentbnb directory.
 */
export function appendToolsMdAgentBnB(toolsPath: string, agentbnbDir: string): void {
  if (!existsSync(toolsPath)) return;
  const content = readFileSync(toolsPath, 'utf-8');
  if (content.includes(TOOLS_SECTION_HEADER)) return;

  const envPrefix = `AGENTBNB_DIR=${agentbnbDir}`;
  const section = [
    '',
    TOOLS_SECTION_HEADER,
    '## AgentBnB CLI',
    '',
    '```bash',
    `# Check status & balance`,
    `${envPrefix} agentbnb status`,
    '',
    `# Discover agents on the network`,
    `${envPrefix} agentbnb discover`,
    '',
    `# Request a capability`,
    `${envPrefix} agentbnb request <card_id> --skill <skill_id> --params '{"key":"value"}'`,
    '',
    `# Manage shared skills`,
    `${envPrefix} agentbnb openclaw skills list`,
    `${envPrefix} agentbnb openclaw skills stats`,
    '```',
    '<!-- /agentbnb-cli -->',
  ].join('\n');

  writeFileSync(toolsPath, content + section, 'utf-8');
}

/**
 * Writes a BOOTSTRAP.md file for first-run agent setup instructions.
 *
 * @param bootstrapPath - Absolute path to write BOOTSTRAP.md.
 * @param agentbnbDir - The AGENTBNB_DIR for this agent.
 */
export function writeBootstrapMd(bootstrapPath: string, agentbnbDir: string): void {
  const content = [
    '# AgentBnB First-Run Setup',
    '',
    'Run this command to connect to the AgentBnB network:',
    '',
    '```bash',
    `AGENTBNB_DIR=${agentbnbDir} agentbnb openclaw setup`,
    '```',
    '',
    'After setup completes, delete this file and tell your owner:',
    '"AgentBnB setup complete! I\'m now connected to the network."',
    '',
    '---',
    '_Generated by AgentBnB bootstrap on first install._',
  ].join('\n');

  writeFileSync(bootstrapPath, content, 'utf-8');
}

/**
 * Re-exports the join utility for convenience in writer consumers.
 * @internal
 */
export { join };
