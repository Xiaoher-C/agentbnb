/**
 * Interactive onboarding: connect an OpenClaw agent to AgentBnB.
 * Invoked via `agentbnb openclaw setup`.
 */

import { createInterface } from 'node:readline';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { getPricingStats } from '../registry/pricing.js';
import { parseSoulMd } from '../skills/publish-capability.js';
import { publishFromSoulV2 } from '../openclaw/index.js';
import { performInit } from './init-action.js';

/** Options passed to runOpenClawSetup */
export interface OpenClawSetupOptions {
  agent?: string;
  soulPath?: string;
  yes?: boolean;
}

/** Pricing heuristic when no market data is available. */
function heuristicPrice(skillName: string): number {
  const lower = skillName.toLowerCase();
  if (/voice|tts|elevenlabs/.test(lower)) return 4;
  if (/crawl|browser|cf/.test(lower)) return 3;
  if (/scrape|stealth/.test(lower)) return 5;
  if (/search|kb|knowledge/.test(lower)) return 2;
  return 3;
}

/** Prompt the user for a line of input. */
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  } finally {
    rl.close();
  }
}

/** Detect a free port by trying sequentially from 3000. */
async function detectFreePort(start = 3100): Promise<number> {
  const net = await import('node:net');
  for (let port = start; port < start + 100; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
    if (available) return port;
  }
  return start;
}

/**
 * Interactive setup wizard: registers an OpenClaw agent on the AgentBnB network.
 */
export async function runOpenClawSetup(opts: OpenClawSetupOptions): Promise<void> {
  console.log('AgentBnB Setup for OpenClaw Agents\n');

  // 1. Resolve OpenClaw agents directory
  const agentsDir = joinPath(homedir(), '.openclaw', 'agents');
  if (!existsSync(agentsDir)) {
    console.error(`Error: OpenClaw agents directory not found at ${agentsDir}`);
    console.error('Install OpenClaw first: https://openclaw.dev');
    process.exit(1);
  }

  // 2. Discover agents with SOUL.md
  let agentName: string;
  if (opts.agent) {
    agentName = opts.agent;
  } else {
    console.log(`Scanning ${agentsDir}...\n`);
    const entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => existsSync(joinPath(agentsDir, name, 'SOUL.md')));

    if (entries.length === 0) {
      console.error('No agents with SOUL.md found in ~/.openclaw/agents/');
      process.exit(1);
    }

    console.log('Available agents:');
    entries.forEach((name, i) => console.log(`  ${i + 1}. ${name} (SOUL.md found)`));
    console.log('');

    const input = await prompt(`Select agent (default: 1): `);
    const idx = input === '' ? 0 : parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= entries.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }
    agentName = entries[idx]!;
  }

  const agentDir = joinPath(agentsDir, agentName);
  const soulPath = opts.soulPath ?? joinPath(agentDir, 'SOUL.md');

  if (!existsSync(soulPath)) {
    console.error(`Error: SOUL.md not found at ${soulPath}`);
    process.exit(1);
  }

  console.log(`\nReading ${agentName}/SOUL.md...`);

  // 3. Parse SOUL.md to extract skills
  const soulContent = readFileSync(soulPath, 'utf-8');
  const parsed = parseSoulMd(soulContent);

  if (parsed.capabilities.length === 0) {
    console.error('No skills (H2 sections) found in SOUL.md.');
    process.exit(1);
  }

  // 4. Determine agentbnb dir for this agent
  const agentbnbDir = joinPath(agentDir, '.agentbnb');
  const alreadyInit = existsSync(joinPath(agentbnbDir, 'config.json'));

  // 5. Set AGENTBNB_DIR for all subsequent operations
  process.env['AGENTBNB_DIR'] = agentbnbDir;

  // 6. Get pricing suggestions
  // We need a temp db instance for pricing stats. If already init'd, use existing db.
  // Otherwise we can't query yet — use heuristics only.
  const pricingMap: Record<string, number> = {};
  if (alreadyInit) {
    try {
      const { loadConfig } = await import('./config.js');
      const cfg = loadConfig();
      if (cfg) {
        const db = (await import('../registry/store.js')).openDatabase(cfg.db_path);
        try {
          for (const cap of parsed.capabilities) {
            const stats = getPricingStats(db, cap.name);
            pricingMap[cap.name] = stats.count > 0 ? stats.median : heuristicPrice(cap.name);
          }
        } finally {
          db.close();
        }
      }
    } catch { /* fall through to heuristics */ }
  }
  for (const cap of parsed.capabilities) {
    if (!(cap.name in pricingMap)) {
      pricingMap[cap.name] = cap.pricing ?? heuristicPrice(cap.name);
    }
  }

  // 7. Display detected skills
  console.log('\nDetected skills:');
  const maxNameLen = Math.max(...parsed.capabilities.map((c) => c.name.length));
  for (const cap of parsed.capabilities) {
    const price = pricingMap[cap.name]!;
    const desc = cap.description.split('\n')[0]?.trim().slice(0, 40) ?? '';
    console.log(`  ${cap.name.padEnd(maxNameLen + 2)} — ${desc.padEnd(42)} (suggested: ${price} cr)`);
  }

  // 8. Confirm
  if (!opts.yes) {
    const answer = await prompt(`\nShare ${parsed.capabilities.length} skill(s) on the AgentBnB network? [Y/n]: `);
    if (answer.toLowerCase() === 'n') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
  }

  console.log('\nInitializing...');

  // 9. Init (if needed)
  if (!alreadyInit) {
    const freePort = await detectFreePort();
    await performInit({
      owner: agentName,
      port: String(freePort),
      yes: true,
      nonInteractive: true,
      detect: false,
    });
    console.log(`  ✓ Created ${agentbnbDir}/config.json`);
  } else {
    console.log(`  ✓ ${agentbnbDir}/config.json already exists`);
  }

  // 10. Publish capability card
  const { loadConfig } = await import('./config.js');
  const cfg = loadConfig();
  if (!cfg) {
    console.error('Error: config not found after init.');
    process.exit(1);
  }

  const db = (await import('../registry/store.js')).openDatabase(cfg.db_path);
  try {
    const card = publishFromSoulV2(db, soulContent, cfg.owner, undefined);
    console.log(`  ✓ Published capability card (${card.skills.length} skill(s))`);
  } finally {
    db.close();
  }

  // 11. Generate skills.yaml template (only if not exists)
  const skillsYamlPath = joinPath(agentbnbDir, 'skills.yaml');
  if (!existsSync(skillsYamlPath)) {
    const yamlLines = ['# AgentBnB skills configuration — generated by `agentbnb openclaw setup`', ''];
    for (const cap of parsed.capabilities) {
      const price = pricingMap[cap.name]!;
      yamlLines.push(
        `- id: ${cap.name}`,
        `  name: ${cap.name}`,
        `  description: "${cap.description.split('\n')[0]?.trim() ?? ''}"`,
        `  pricing:`,
        `    credits_per_call: ${price}`,
        `  type: command`,
        `  command: "echo 'TODO: implement ${cap.name}'"`,
        '',
      );
    }
    writeFileSync(skillsYamlPath, yamlLines.join('\n'), 'utf-8');
    console.log(`  ✓ Generated ${skillsYamlPath}`);
  }

  // 12. Inject AgentBnB trading section into SOUL.md
  const sectionHeader = '## AgentBnB Network Trading';
  if (!soulContent.includes(sectionHeader)) {
    const skillRows = parsed.capabilities
      .map((cap) => `| ${cap.name} | ${pricingMap[cap.name]!} cr | ${cap.description.split('\n')[0]?.trim().slice(0, 60) ?? ''} |`)
      .join('\n');

    const section = [
      '',
      '---',
      sectionHeader,
      '',
      `This agent is connected to the [AgentBnB](https://agentbnb.dev) P2P capability-sharing network.`,
      '',
      '### Shared Skills',
      '| Skill | Price | Description |',
      '|-------|-------|-------------|',
      skillRows,
      '',
      '### Trading Rules',
      `- AGENTBNB_DIR: ${agentbnbDir}`,
      '- Reserve floor: 20 credits (never auto-spend below this)',
      '- Auto-trade limit: 10 credits per transaction (above → ask owner)',
      `- Run capabilities: \`AGENTBNB_DIR=${agentbnbDir} agentbnb request <card_id> --skill <skill> --params '<json>'\``,
      `- Check balance: \`AGENTBNB_DIR=${agentbnbDir} agentbnb status\``,
      '',
      '### How to Earn',
      'Credits are escrowed when another agent hires your skill and settled on success (5% network fee applies).',
    ].join('\n');

    writeFileSync(soulPath, soulContent + section, 'utf-8');
    console.log(`  ✓ AgentBnB trading section added to SOUL.md`);
  } else {
    console.log(`  ✓ SOUL.md already has AgentBnB section`);
  }

  console.log(`\n${agentName} is now on the AgentBnB network!`);
  console.log(`Run 'openclaw daemon restart' to start earning.`);
}
