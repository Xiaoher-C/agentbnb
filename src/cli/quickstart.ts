/**
 * agentbnb quickstart — One-command setup: init + skills.yaml + MCP + serve.
 *
 * Target UX: `npx agentbnb quickstart` → ready in ~10 seconds.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

import { performInit } from './init-action.js';

/** Skills.yaml template for Claude Code users. */
const SKILLS_YAML_TEMPLATE = `skills:
  # General-purpose AI task execution via Claude Code CLI
  - id: claude-code-run
    type: command
    name: Claude Code Task Runner
    description: "Execute any text-based AI task via Claude Code"
    command: claude -p "\${params.prompt}"
    output_type: text
    allowed_commands:
      - claude
    timeout_ms: 180000
    pricing:
      credits_per_call: 5

  # Code review skill
  - id: claude-code-review
    type: command
    name: Code Review
    description: "Review code for bugs, style, and improvements"
    command: claude -p "Review this code for bugs, style issues, and improvements:\\n\\n\${params.code}"
    output_type: text
    allowed_commands:
      - claude
    timeout_ms: 120000
    pricing:
      credits_per_call: 3

  # Text summarization skill
  - id: claude-code-summarize
    type: command
    name: Text Summarizer
    description: "Summarize long text into concise key points"
    command: claude -p "Summarize the following text into concise key points:\\n\\n\${params.text}"
    output_type: text
    allowed_commands:
      - claude
    timeout_ms: 120000
    pricing:
      credits_per_call: 2
`;

/**
 * Generate skills.yaml at ~/.agentbnb/skills.yaml if it does not already exist.
 * Returns { generated: boolean, path: string }.
 */
function generateSkillsYaml(configDir: string): { generated: boolean; path: string; skillCount: number } {
  const skillsPath = join(configDir, 'skills.yaml');

  if (existsSync(skillsPath)) {
    // Count existing skills
    const content = readFileSync(skillsPath, 'utf-8');
    const matches = content.match(/^\s+-\s+id:/gm);
    return { generated: false, path: skillsPath, skillCount: matches?.length ?? 0 };
  }

  writeFileSync(skillsPath, SKILLS_YAML_TEMPLATE, 'utf-8');
  return { generated: true, path: skillsPath, skillCount: 3 };
}

/**
 * Register AgentBnB MCP server with Claude Code's settings.json.
 * Idempotent — skips if already registered or if Claude Code is not detected.
 */
function registerMcpWithClaudeCode(): { registered: boolean; path?: string; reason?: string } {
  const claudeDir = join(homedir(), '.claude');

  if (!existsSync(claudeDir)) {
    return {
      registered: false,
      reason: 'Claude Code not detected. Add MCP manually: claude mcp add agentbnb -- agentbnb mcp-server',
    };
  }

  const settingsPath = join(claudeDir, 'settings.json');

  // Resolve the agentbnb command path
  let agentbnbCommand = 'agentbnb';
  try {
    const resolved = execSync('which agentbnb', { encoding: 'utf-8' }).trim();
    if (resolved) agentbnbCommand = resolved;
  } catch {
    // Fall back to 'agentbnb' — user may install globally later
  }

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Malformed JSON — backup and start fresh
      try {
        writeFileSync(`${settingsPath}.bak`, readFileSync(settingsPath, 'utf-8'), 'utf-8');
      } catch { /* ignore backup failure */ }
      settings = {};
    }
  }

  // Check if already registered
  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  if (mcpServers.agentbnb) {
    return { registered: false, path: settingsPath, reason: 'already registered' };
  }

  // Add AgentBnB MCP entry
  mcpServers.agentbnb = {
    command: agentbnbCommand,
    args: ['mcp-server'],
  };
  settings.mcpServers = mcpServers;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { registered: true, path: settingsPath };
}

/** Quickstart command options. */
interface QuickstartOpts {
  owner?: string;
  port: string;
  serve?: boolean;
  mcp?: boolean;
  json?: boolean;
}

/**
 * Run the full quickstart flow:
 * 1. Init (idempotent)
 * 2. Generate skills.yaml
 * 3. Register MCP with Claude Code
 * 4. Start background daemon
 * 5. Print status summary
 */
export async function runQuickstart(opts: QuickstartOpts): Promise<void> {
  const jsonMode = opts.json ?? false;
  const skipServe = opts.serve === false;
  const skipMcp = opts.mcp === false;

  // Step 1: Init
  if (!jsonMode) console.log('Initializing AgentBnB...');
  const initResult = await performInit({
    owner: opts.owner,
    port: opts.port,
    yes: true,
    detect: true,
    json: false,  // We handle output ourselves
  });

  // Step 2: Generate skills.yaml
  const skills = generateSkillsYaml(initResult.configDir);
  if (!jsonMode) {
    if (skills.generated) {
      console.log(`\nGenerated skills.yaml with ${skills.skillCount} Claude Code skills`);
    } else {
      console.log(`\nSkills: ${skills.skillCount} skill(s) in ${skills.path}`);
    }
  }

  // Step 3: Register MCP
  let mcpResult: { registered: boolean; path?: string; reason?: string } = { registered: false, reason: 'skipped' };
  if (!skipMcp) {
    mcpResult = registerMcpWithClaudeCode();
    if (!jsonMode) {
      if (mcpResult.registered) {
        console.log(`MCP: registered in ${mcpResult.path}`);
      } else if (mcpResult.reason === 'already registered') {
        console.log(`MCP: already registered in ${mcpResult.path}`);
      } else {
        console.log(`MCP: ${mcpResult.reason}`);
      }
    }
  }

  // Step 4: Start background daemon
  let daemonStatus: { running: boolean; pid?: number; reason?: string } = { running: false, reason: 'skipped' };
  if (!skipServe) {
    try {
      const { ProcessGuard } = await import('../runtime/process-guard.js');
      const { ServiceCoordinator } = await import('../runtime/service-coordinator.js');

      const guard = new ProcessGuard(join(initResult.configDir, '.pid'));
      const coordinator = new ServiceCoordinator(initResult.config, guard);

      const result = await coordinator.ensureRunning({
        port: initResult.config.gateway_port,
        skillsYamlPath: join(initResult.configDir, 'skills.yaml'),
        registryUrl: initResult.config.registry,
        relay: true,
      });

      if (result === 'already_running') {
        daemonStatus = { running: true, reason: 'already running' };
      } else {
        const meta = guard.getRunningMeta();
        daemonStatus = { running: true, pid: meta?.pid };
      }

      if (!jsonMode) {
        if (result === 'already_running') {
          console.log(`Daemon: already running`);
        } else {
          console.log(`Daemon: started (pid ${daemonStatus.pid ?? 'unknown'})`);
        }
      }
    } catch (err) {
      daemonStatus = { running: false, reason: (err as Error).message };
      if (!jsonMode) {
        console.warn(`Daemon: failed to start — ${(err as Error).message}`);
        console.warn(`  Start manually with: agentbnb serve`);
      }
    }
  }

  // Step 5: Output
  if (jsonMode) {
    console.log(JSON.stringify({
      success: true,
      owner: initResult.owner,
      config_dir: initResult.configDir,
      gateway_url: initResult.config.gateway_url,
      registry: initResult.config.registry,
      credits: initResult.registryBalance ?? 100,
      skills: { count: skills.skillCount, generated: skills.generated, path: skills.path },
      mcp: mcpResult,
      daemon: daemonStatus,
      published_cards: initResult.publishedCards,
    }, null, 2));
  } else {
    console.log('\n--- AgentBnB quickstart complete! ---\n');
    console.log(`  Owner:    ${initResult.owner}`);
    console.log(`  Gateway:  ${initResult.config.gateway_url}`);
    console.log(`  Credits:  ${initResult.registryBalance ?? 100}`);
    console.log(`  Registry: ${initResult.config.registry ?? 'not configured'}`);
    console.log(`  Skills:   ${skills.skillCount} loaded`);
    console.log(`  MCP:      ${mcpResult.registered ? 'registered' : mcpResult.reason}`);
    console.log(`  Daemon:   ${daemonStatus.running ? `running${daemonStatus.pid ? ` (pid ${daemonStatus.pid})` : ''}` : `not running — ${daemonStatus.reason}`}`);
    console.log('');
    console.log('  You are now both a consumer and provider on AgentBnB.');
    console.log('');
    console.log('  Consumer: In Claude Code, use agentbnb_discover and agentbnb_request');
    console.log('  Provider: Your claude -p skills are live and accepting requests');
    console.log(`  Dashboard: http://localhost:7701/hub/#/myagent`);
  }
}
