/**
 * Interactive onboarding: connect an OpenClaw agent to AgentBnB.
 * Invoked via `agentbnb openclaw setup`.
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { getPricingStats } from '../registry/pricing.js';
import { parseSoulMd } from '../skills/publish-capability.js';
import { publishFromSoulV2 } from '../openclaw/index.js';
import { performInit } from './init-action.js';
import { scanAgents, findSoulMd, inferBrainDir, getOpenClawWorkspaceDir } from '../workspace/scanner.js';
import { appendSoulMdTradingSection, appendHeartbeatTradingSection } from '../workspace/writer.js';
import { initGepDir } from '../workspace/gep-init.js';

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

  // ── Step 1: Mode selection ──────────────────────────────────────────────────
  if (!opts.yes) {
    console.log('How do you want to get started?');
    console.log('  1. Connect an existing agent');
    console.log('  2. Create a new trading agent (coming soon)');
    console.log('');
    const modeInput = await prompt('Select mode (default: 1): ');
    const mode = modeInput === '' ? '1' : modeInput;
    if (mode === '2') {
      console.log('\nCreating new trading agents from templates is coming in a future release.');
      console.log('For now, use Option 1 to connect an existing OpenClaw agent.');
      process.exit(0);
    }
    if (mode !== '1') {
      console.error('Invalid selection.');
      process.exit(1);
    }
  }

  // ── Step 2: Agent discovery (brains/ primary + agents/ fallback + workspace root) ────
  const agentsDir = joinPath(homedir(), '.openclaw', 'agents');
  const workspaceDir = getOpenClawWorkspaceDir();
  const brainsDir = joinPath(workspaceDir, 'brains');

  // Verify at least one OpenClaw directory exists
  if (!existsSync(agentsDir) && !existsSync(brainsDir) && !existsSync(workspaceDir)) {
    console.error(`Error: OpenClaw directory not found at ${agentsDir}`);
    console.error('Install OpenClaw first: https://openclaw.dev');
    process.exit(1);
  }

  let agentName: string;
  let agentBrainDir = '';

  if (opts.agent) {
    agentName = opts.agent;
    // Check brains dir first
    if (existsSync(joinPath(brainsDir, agentName))) {
      agentBrainDir = joinPath(brainsDir, agentName);
    } else if (agentName === 'main' && existsSync(joinPath(workspaceDir, 'SOUL.md'))) {
      // "main" agent with workspace-root SOUL.md
      agentBrainDir = workspaceDir;
    } else {
      agentBrainDir = '';
    }
  } else {
    console.log('Scanning for available agents...\n');

    // Use unified scanner (brains/ + agents/ + workspace root)
    const detected = scanAgents();

    if (detected.length === 0) {
      console.error('No agents found in OpenClaw workspace.');
      console.error(`Checked: ${brainsDir}, ${agentsDir}, ${workspaceDir}/SOUL.md`);
      process.exit(1);
    }

    console.log('Available agents:');
    const maxNameLen = Math.max(...detected.map((d) => d.name.length));
    detected.forEach((d, i) => {
      const desc = d.description ? d.description.slice(0, 50) : '(no description)';
      const skills = d.skillCount > 0 ? `, ${d.skillCount} skills` : '';
      const brainIndicator = d.brainDir ? ' [brain]' : '';
      console.log(
        `  ${i + 1}. ${d.name.padEnd(maxNameLen + 2)} — ${desc}${skills}${brainIndicator}`,
      );
    });
    console.log('');

    const input = await prompt(`Select agent (default: 1): `);
    const idx = input === '' ? 0 : parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= detected.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }

    const selected = detected[idx]!;
    agentName = selected.name;
    agentBrainDir = selected.brainDir;
  }

  // ── Step 3: Resolve SOUL.md ─────────────────────────────────────────────────
  const agentDir = joinPath(agentsDir, agentName);

  let soulPath: string;
  if (opts.soulPath) {
    soulPath = opts.soulPath;
    // Infer brainDir from explicit soul path if not already set
    if (!agentBrainDir) {
      agentBrainDir = inferBrainDir(soulPath, agentDir);
    }
  } else {
    const found = findSoulMd(agentName);
    if (found) {
      soulPath = found;
      // Infer brainDir from found soul path if not already set
      if (!agentBrainDir) {
        agentBrainDir = inferBrainDir(found, agentDir);
      }
    } else {
      // No SOUL.md found — offer partial (manual) setup
      console.log(`\nAgent "${agentName}" has no SOUL.md. Capability detection will be limited.`);
      console.log(`Checked: ${joinPath(workspaceDir, 'brains', agentName, 'SOUL.md')}`);
      console.log(`         ${joinPath(agentsDir, agentName, 'SOUL.md')}`);
      console.log(`         ${joinPath(workspaceDir, 'SOUL.md')}`);

      if (!opts.yes) {
        const answer = await prompt('\nProceed with manual skill setup? (Y/n) ');
        if (answer.toLowerCase() === 'n') {
          console.log('Setup cancelled.');
          process.exit(0);
        }
      }

      // Partial setup: init identity only, skip skill publishing
      console.log('\nInitializing...');
      const agentbnbDir = joinPath(agentDir, '.agentbnb');
      process.env['AGENTBNB_DIR'] = agentbnbDir;
      const alreadyInit = existsSync(joinPath(agentbnbDir, 'config.json'));
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

      // GEP init
      const effectiveBrainDir = agentBrainDir || agentDir;
      try {
        initGepDir(effectiveBrainDir);
        console.log(`  ✓ Initialized evolution assets (gep/)`);
      } catch { /* non-fatal */ }

      // HEARTBEAT.md
      const heartbeatCandidates = [
        agentBrainDir ? joinPath(agentBrainDir, 'HEARTBEAT.md') : null,
        joinPath(agentDir, 'HEARTBEAT.md'),
      ].filter(Boolean) as string[];
      const { existsSync: fsExists } = await import('node:fs');
      for (const hbPath of heartbeatCandidates) {
        if (fsExists(hbPath)) {
          try {
            appendHeartbeatTradingSection(hbPath, agentbnbDir);
            console.log(`  ✓ Updated HEARTBEAT.md`);
          } catch { /* non-fatal */ }
          break;
        }
      }

      console.log(`\n${agentName} initialized on AgentBnB (no skills yet).`);
      console.log(`Add skills manually: agentbnb openclaw skills add --manual --name <id> --type command --price 3`);
      console.log(`\nUseful commands:`);
      console.log(`  AGENTBNB_DIR=${agentbnbDir} agentbnb openclaw skills list`);
      console.log(`  AGENTBNB_DIR=${agentbnbDir} agentbnb status`);
      return;
    }
  }

  console.log(`\nReading ${agentName}/SOUL.md...`);

  // Parse SOUL.md to extract skills
  const soulContent = readFileSync(soulPath, 'utf-8');
  const parsed = parseSoulMd(soulContent);

  if (parsed.capabilities.length === 0) {
    console.log('No skills (H2 sections) found in SOUL.md.');
    console.log(`Add skills manually: agentbnb openclaw skills add --manual --name <id> --type command --price 3`);
    process.exit(0);
  }

  // ── Step 4: Determine agentbnb dir and pricing ──────────────────────────────
  const agentbnbDir = joinPath(agentDir, '.agentbnb');
  const alreadyInit = existsSync(joinPath(agentbnbDir, 'config.json'));

  // Set AGENTBNB_DIR for all subsequent operations
  process.env['AGENTBNB_DIR'] = agentbnbDir;

  // Get pricing suggestions
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

  // Display detected skills
  console.log('\nDetected skills:');
  const maxNameLen = Math.max(...parsed.capabilities.map((c) => c.name.length));
  for (const cap of parsed.capabilities) {
    const price = pricingMap[cap.name]!;
    const desc = cap.description.split('\n')[0]?.trim().slice(0, 40) ?? '';
    console.log(`  ${cap.name.padEnd(maxNameLen + 2)} — ${desc.padEnd(42)} (suggested: ${price} cr)`);
  }

  // Confirm
  if (!opts.yes) {
    const answer = await prompt(`\nShare ${parsed.capabilities.length} skill(s) on the AgentBnB network? [Y/n]: `);
    if (answer.toLowerCase() === 'n') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
  }

  console.log('\nInitializing...');

  // ── Step 5: Init identity + config ─────────────────────────────────────────
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

  // ── Step 6: Publish capability card ────────────────────────────────────────
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

  // ── Step 7: Generate skills.yaml template (only if not exists) ──────────────
  const { existsSync: fsExists, writeFileSync: fsWrite } = await import('node:fs');
  const skillsYamlPath = joinPath(agentbnbDir, 'skills.yaml');
  if (!fsExists(skillsYamlPath)) {
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
    fsWrite(skillsYamlPath, yamlLines.join('\n'), 'utf-8');
    console.log(`  ✓ Generated ${skillsYamlPath}`);
  }

  // ── Step 8: GEP-lite init ───────────────────────────────────────────────────
  const effectiveBrainDir = agentBrainDir || agentDir;
  try {
    initGepDir(effectiveBrainDir);
    console.log(`  ✓ Initialized evolution assets (gep/)`);
  } catch {
    // Non-fatal — brain dir may not be writable
  }

  // ── Step 9: Inject AgentBnB trading section into SOUL.md ───────────────────
  const skillEntries = parsed.capabilities.map((cap) => ({
    id: cap.name,
    name: cap.name,
    description: cap.description,
    pricing: { credits_per_call: pricingMap[cap.name]! },
  }));

  try {
    appendSoulMdTradingSection(soulPath, skillEntries, agentbnbDir);
    const currentContent = readFileSync(soulPath, 'utf-8');
    if (currentContent.includes('## AgentBnB Network Trading')) {
      console.log(`  ✓ AgentBnB trading section present in SOUL.md`);
    }
  } catch {
    // Non-fatal
  }

  // ── Step 10: Append HEARTBEAT.md trading section (if exists) ───────────────
  const heartbeatCandidates = [
    agentBrainDir ? joinPath(agentBrainDir, 'HEARTBEAT.md') : null,
    joinPath(agentDir, 'HEARTBEAT.md'),
  ].filter(Boolean) as string[];

  for (const hbPath of heartbeatCandidates) {
    if (fsExists(hbPath)) {
      try {
        appendHeartbeatTradingSection(hbPath, agentbnbDir);
        console.log(`  ✓ Updated HEARTBEAT.md`);
      } catch {
        // Non-fatal
      }
      break;
    }
  }

  console.log(`\n${agentName} is now on the AgentBnB network!`);
  console.log(`Run 'openclaw daemon restart' to start earning.`);
  console.log(`\nUseful commands:`);
  console.log(`  AGENTBNB_DIR=${agentbnbDir} agentbnb openclaw skills list`);
  console.log(`  AGENTBNB_DIR=${agentbnbDir} agentbnb openclaw skills stats`);
  console.log(`  AGENTBNB_DIR=${agentbnbDir} agentbnb status`);
}
