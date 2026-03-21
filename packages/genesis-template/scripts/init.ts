#!/usr/bin/env node
import prompts from 'prompts';
import Handlebars from 'handlebars';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../templates');

async function main() {
  console.log('\nGenesis Template Setup\n');
  console.log('This sets up a born-trading agent on the AgentBnB network.\n');

  const identity = await prompts([
    { type: 'text', name: 'agentName', message: 'Agent name:', initial: 'genesis-bot' },
    { type: 'text', name: 'ownerName', message: 'Your name / owner ID:' },
    { type: 'text', name: 'domain', message: 'Primary domain (e.g. "software dev", "data analysis"):', initial: 'general' },
    { type: 'text', name: 'language', message: 'Communication language:', initial: 'English' },
  ]);

  console.log('\nModel Routing Setup');
  console.log('Genesis uses 3 layers to minimize token costs:\n');
  console.log('  Layer 0 (Fast)  — cheap model for routing & formatting (~80% of tasks)');
  console.log('  Layer 1 (Smart) — stronger model for deep reasoning (~15% of tasks)');
  console.log('  Layer 2 (Heavy) — rent Claude Code via AgentBnB (~5% of tasks)\n');

  const modelConfig = await prompts([
    { type: 'text', name: 'layer0Model', message: 'Layer 0 model:', initial: 'claude-haiku-4-5' },
    { type: 'text', name: 'layer1Model', message: 'Layer 1 model:', initial: 'claude-sonnet-4-6' },
    { type: 'number', name: 'layer1DailyCap', message: 'Layer 1 daily token cap:', initial: 100000 },
    { type: 'number', name: 'layer2DailyCap', message: 'Layer 2 daily credit cap:', initial: 50 },
  ]);

  console.log('\nAutonomy Configuration');
  const autonomy = await prompts([
    { type: 'number', name: 'tier1Threshold', message: 'Tier 1 threshold (full auto below):', initial: 10 },
    { type: 'number', name: 'tier2Threshold', message: 'Tier 2 threshold (notify after below):', initial: 50 },
    { type: 'number', name: 'reserveFloor', message: 'Reserve floor (never spend below):', initial: 20 },
  ]);

  console.log('\nAgentBnB Network');
  const network = await prompts([
    { type: 'confirm', name: 'joinNetwork', message: 'Join AgentBnB network? (earn credits by sharing idle capabilities)', initial: true },
  ]);

  const outputDir = process.cwd();
  const templateVars = { ...identity, ...modelConfig, ...autonomy, ...network };

  // Generate files from templates
  const templates = ['SOUL.md', 'HEARTBEAT.md', 'openclaw.plugin.json'];
  for (const tmplName of templates) {
    const tmplSrc = readFileSync(join(TEMPLATES_DIR, `${tmplName}.hbs`), 'utf8');
    const compiled = Handlebars.compile(tmplSrc);
    const output = compiled(templateVars);
    writeFileSync(join(outputDir, tmplName), output, 'utf8');
    console.log(`  Generated ${tmplName}`);
  }

  if (network.joinNetwork) {
    console.log('\nRegistering on AgentBnB network...');
    try {
      execSync(`agentbnb init --yes --owner "${identity.ownerName as string}"`, { stdio: 'inherit' });
      console.log('Registered on AgentBnB. Starting balance: 50 credits.');
    } catch {
      console.log('agentbnb CLI not found. Install: npm install -g agentbnb');
    }
  }

  // Copy skills/ directory
  const skillsSrc = join(__dirname, '../skills');
  const skillsDst = join(outputDir, 'skills');
  try {
    mkdirSync(skillsDst, { recursive: true });
    cpSync(skillsSrc, skillsDst, { recursive: true });
    console.log('  Copied skills/');
  } catch {
    // skills dir may not exist in some build configs
  }

  // Seed core memories
  const seedPath = join(__dirname, '../memory-seeds/core-memories.json');
  const seedData = JSON.parse(readFileSync(seedPath, 'utf8')) as unknown;
  writeFileSync(join(outputDir, 'core-memories.json'), JSON.stringify(seedData, null, 2));

  console.log('\nGenesis Template installed successfully!');
  console.log(`   Agent: ${identity.agentName as string}`);
  console.log('   Your agent will start its first heartbeat in 30 minutes.');
  console.log('   Monitor: agentbnb status');
  console.log('   Hub: https://hub.agentbnb.dev\n');
}

main().catch(console.error);
