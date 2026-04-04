/**
 * `agentbnb skill wrap` — Turn any CLI command into a rentable AgentBnB skill.
 *
 * Supports:
 * - Core wrap: --name + --command + --price
 * - Auto-detect: --auto <binary> (scan subcommands)
 * - From help: --from-help <binary> (parse --help output)
 * - Batch scan: --scan (find all cli-anything-* binaries on PATH)
 * - Pricing engine: --price auto (category-based suggestion)
 * - Interactive mode: no args → readline prompts
 *
 * @module cli/skill-wrap
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import yaml from 'js-yaml';
import { getConfigDir } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from the CLI parser. */
export interface WrapOptions {
  name?: string;
  command?: string;
  description?: string;
  price?: string;
  category?: string;
  inputs?: string;
  outputs?: string;
  tags?: string;
  auto?: string;
  fromHelp?: string;
  scan?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

/** Detected subcommand from --help parsing. */
export interface DetectedSubcommand {
  name: string;
  description: string;
}

/** Result from CLI auto-detection. */
export interface DetectedCliInfo {
  name: string;
  description: string;
  subcommands: DetectedSubcommand[];
}

/** Category-based pricing defaults (credits per call). */
const CATEGORY_PRICES: Record<string, number> = {
  '3d-rendering': 15,
  'image-processing': 8,
  'video-editing': 12,
  'audio-processing': 8,
  'document-generation': 5,
  'code-execution': 5,
  'web-crawling': 3,
  'data-analysis': 10,
  'custom': 5,
};

/** Binary name substrings → category mapping for auto-pricing. */
const BINARY_CATEGORY_HINTS: Array<[string[], string]> = [
  [['blender', '3d', 'render'], '3d-rendering'],
  [['gimp', 'imagemagick', 'magick', 'sharp', 'image'], 'image-processing'],
  [['ffmpeg', 'video', 'premiere', 'davinci'], 'video-editing'],
  [['sox', 'audio', 'elevenlabs', 'tts', 'whisper'], 'audio-processing'],
  [['libreoffice', 'pandoc', 'latex', 'pdf', 'doc'], 'document-generation'],
  [['node', 'python', 'ruby', 'code', 'claude'], 'code-execution'],
  [['curl', 'wget', 'crawl', 'scrape', 'fetch'], 'web-crawling'],
  [['pandas', 'data', 'csv', 'sql', 'analyze'], 'data-analysis'],
];

// ---------------------------------------------------------------------------
// Param extraction
// ---------------------------------------------------------------------------

/**
 * Extract parameter names from a command template.
 * Matches `${params.xxx}` patterns, returns deduplicated list.
 */
export function extractParamsFromTemplate(command: string): string[] {
  const regex = /\$\{params\.(\w+)\}/g;
  const params: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    if (!params.includes(match[1]!)) {
      params.push(match[1]!);
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Help output parser
// ---------------------------------------------------------------------------

/**
 * Parse a CLI --help output to extract subcommands and description.
 * Best-effort heuristic — works with commander, yargs, click, argparse, etc.
 */
export function parseHelpOutput(text: string): { description: string; subcommands: DetectedSubcommand[] } {
  const lines = text.split('\n');
  const subcommands: DetectedSubcommand[] = [];

  // Description: first non-empty line that isn't "Usage:" or a flag
  let description = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(usage|options|commands|flags):/i.test(trimmed)) continue;
    if (trimmed.startsWith('-')) continue;
    if (trimmed.startsWith('$')) continue;
    description = trimmed;
    break;
  }

  // Find subcommands section
  let inCommandSection = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers
    if (/^(commands|available commands|subcommands|positional arguments):/i.test(trimmed)) {
      inCommandSection = true;
      continue;
    }
    if (inCommandSection && /^(options|flags|global|examples):/i.test(trimmed)) {
      inCommandSection = false;
      continue;
    }

    if (inCommandSection && trimmed) {
      // Match: "  command-name    Description text" or "  command-name  Description text"
      const match = trimmed.match(/^(\S+)\s{2,}(.+)$/);
      if (match) {
        subcommands.push({ name: match[1]!, description: match[2]!.trim() });
      }
    }
  }

  return { description, subcommands };
}

// ---------------------------------------------------------------------------
// CLI detection
// ---------------------------------------------------------------------------

/**
 * Detect CLI information by running --help.
 * @throws Error if binary not found or --help fails.
 */
export async function detectCliInfo(binary: string): Promise<DetectedCliInfo> {
  // Verify binary exists
  try {
    execSync(`which ${binary}`, { stdio: 'pipe', timeout: 5000 });
  } catch {
    throw new Error(`CLI not found: ${binary}. Is it installed and on PATH?`);
  }

  // Run --help
  let helpText = '';
  try {
    helpText = execSync(`${binary} --help 2>&1`, { encoding: 'utf-8', timeout: 10000 });
  } catch (err) {
    // Some CLIs exit with non-zero on --help
    const stderr = (err as { stdout?: string }).stdout ?? '';
    helpText = stderr || `CLI tool: ${binary}`;
  }

  const parsed = parseHelpOutput(helpText);
  const baseName = binary.replace(/^cli-anything-/, '');

  return {
    name: baseName,
    description: parsed.description || `CLI tool: ${binary}`,
    subcommands: parsed.subcommands,
  };
}

// ---------------------------------------------------------------------------
// Pricing engine
// ---------------------------------------------------------------------------

/**
 * Suggest a price based on binary name and optional category.
 */
export function suggestPrice(binary: string, category?: string): number {
  if (category && CATEGORY_PRICES[category] !== undefined) {
    return CATEGORY_PRICES[category]!;
  }

  const lower = binary.toLowerCase();
  for (const [keywords, cat] of BINARY_CATEGORY_HINTS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return CATEGORY_PRICES[cat] ?? 5;
    }
  }

  return 5;
}

// ---------------------------------------------------------------------------
// YAML operations
// ---------------------------------------------------------------------------

/** Get the path to skills.yaml in the config directory. */
function getSkillsYamlPath(configDir?: string): string {
  return join(configDir ?? getConfigDir(), 'skills.yaml');
}

/**
 * Append a skill definition to ~/.agentbnb/skills.yaml.
 * Creates the file if it doesn't exist. Rejects duplicate IDs.
 *
 * @param skillDef - Skill definition object.
 * @param configDir - Override config directory (for testing).
 */
export function appendToSkillsYaml(skillDef: Record<string, unknown>, configDir?: string): void {
  const dir = configDir ?? getConfigDir();
  const yamlPath = getSkillsYamlPath(dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let skills: unknown[] = [];

  if (existsSync(yamlPath)) {
    const content = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(content) as unknown;
    if (Array.isArray(parsed)) {
      skills = parsed;
    } else if (parsed && typeof parsed === 'object' && 'skills' in parsed) {
      skills = (parsed as { skills: unknown[] }).skills ?? [];
    }
  }

  // Check for duplicate ID
  const newId = skillDef['id'] as string;
  const existing = skills.find((s) => (s as Record<string, unknown>)['id'] === newId);
  if (existing) {
    throw new Error(`Skill "${newId}" already exists in skills.yaml. Remove it first or use a different name.`);
  }

  skills.push(skillDef);

  const header = '# AgentBnB skills configuration — managed by agentbnb skill wrap\n';
  writeFileSync(yamlPath, header + yaml.dump(skills, { lineWidth: 120 }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Scan mode
// ---------------------------------------------------------------------------

/**
 * Scan PATH for cli-anything-* binaries.
 */
export function scanCliAnythingBinaries(): string[] {
  try {
    const result = execSync('bash -c \'compgen -c | grep "^cli-anything-" | sort -u\'', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    // Fallback: scan PATH directories manually
    const pathDirs = (process.env['PATH'] ?? '').split(':');
    const found = new Set<string>();
    for (const dir of pathDirs) {
      try {
        const entries = execSync(`ls "${dir}" 2>/dev/null | grep "^cli-anything-"`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        for (const entry of entries.trim().split('\n').filter(Boolean)) {
          found.add(entry);
        }
      } catch { /* skip */ }
    }
    return [...found].sort();
  }
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------

async function prompt(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? ` (${defaultVal})` : '';
  return new Promise<string>((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run the `agentbnb skill wrap` command.
 */
export async function runSkillWrap(opts: WrapOptions): Promise<void> {
  // --scan mode: batch wrap all cli-anything-* binaries
  if (opts.scan) {
    const binaries = scanCliAnythingBinaries();
    if (binaries.length === 0) {
      console.log('No cli-anything-* binaries found on PATH.');
      return;
    }
    console.log(`Found ${binaries.length} CLI-Anything tool(s):`);
    binaries.forEach((b) => console.log(`  ${b}`));

    if (!opts.yes && !opts.dryRun) {
      const confirm = await prompt('\nWrap all as skills? (Y/n)', 'Y');
      if (confirm.toLowerCase() === 'n') return;
    }

    let totalSkills = 0;
    for (const binary of binaries) {
      try {
        const info = await detectCliInfo(binary);
        const created = await wrapDetectedCli(binary, info, opts);
        totalSkills += created;
      } catch (err) {
        console.error(`  Skipping ${binary}: ${(err as Error).message}`);
      }
    }
    console.log(`\nCreated ${totalSkills} skill(s) from ${binaries.length} CLI(s).`);
    if (!opts.dryRun) {
      console.log(`Run 'agentbnb serve' to start accepting requests.`);
    }
    return;
  }

  // --auto mode: auto-detect subcommands
  if (opts.auto) {
    const info = await detectCliInfo(opts.auto);
    await wrapDetectedCli(opts.auto, info, opts);
    return;
  }

  // --from-help mode: parse --help
  if (opts.fromHelp) {
    const info = await detectCliInfo(opts.fromHelp);
    if (info.subcommands.length === 0) {
      // Single-command CLI — wrap as one skill
      const name = opts.name ?? info.name;
      const price = resolvePrice(opts.price, opts.fromHelp, opts.category);
      await wrapSingleSkill({
        name,
        command: `${opts.fromHelp} \${params.input}`,
        description: opts.description ?? info.description,
        price,
        category: opts.category,
        tags: opts.tags,
        dryRun: opts.dryRun,
      });
    } else {
      await wrapDetectedCli(opts.fromHelp, info, opts);
    }
    return;
  }

  // Interactive mode: no name or command provided
  if (!opts.name && !opts.command) {
    const command = await prompt('CLI command to wrap');
    if (!command) { console.error('Command is required.'); process.exit(1); }
    const baseName = command.split(/\s+/)[0]!.replace(/^.*\//, '').replace(/^cli-anything-/, '');
    const name = await prompt('Skill name', baseName);
    const description = await prompt('Short description');
    const priceStr = await prompt('Price (credits per call)', '5');
    const category = await prompt('Category (optional)');

    opts = { ...opts, name, command, description, price: priceStr, category: category || undefined };
  }

  // Core wrap mode
  if (!opts.name || !opts.command) {
    console.error('Error: --name and --command are required (or use --auto/--from-help/--scan).');
    process.exit(1);
  }

  const price = resolvePrice(opts.price, opts.command, opts.category);
  await wrapSingleSkill({
    name: opts.name,
    command: opts.command,
    description: opts.description,
    price,
    category: opts.category,
    tags: opts.tags,
    inputs: opts.inputs,
    outputs: opts.outputs,
    dryRun: opts.dryRun,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePrice(priceStr: string | undefined, binary: string, category?: string): number {
  if (!priceStr || priceStr === 'auto') {
    return suggestPrice(binary, category);
  }
  const n = parseInt(priceStr, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error('Error: --price must be a positive integer or "auto".');
    process.exit(1);
  }
  return n;
}

async function wrapSingleSkill(opts: {
  name: string;
  command: string;
  description?: string;
  price: number;
  category?: string;
  tags?: string;
  inputs?: string;
  outputs?: string;
  dryRun?: boolean;
}): Promise<void> {
  const params = extractParamsFromTemplate(opts.command);
  const baseCommand = opts.command.split(/\s+/)[0] ?? '';

  const skillDef: Record<string, unknown> = {
    id: opts.name,
    type: 'command',
    name: opts.name,
    description: opts.description || `Wrapped CLI: ${baseCommand}`,
    command: opts.command,
    output_type: 'text',
    pricing: { credits_per_call: opts.price },
  };

  if (opts.category) {
    skillDef['category'] = opts.category;
  }

  const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  if (tags.length > 0) {
    skillDef['metadata'] = { tags };
  }

  // Parse custom inputs/outputs if provided
  if (opts.inputs) {
    try { skillDef['_input_hint'] = JSON.parse(opts.inputs); } catch { /* ignore */ }
  }

  if (opts.dryRun) {
    console.log('--- Dry Run Preview ---');
    console.log(yaml.dump([skillDef], { lineWidth: 120 }));
    console.log(`Parameters detected: ${params.length > 0 ? params.join(', ') : '(none)'}`);
    console.log(`Price: ${opts.price} cr/call`);
    return;
  }

  try {
    appendToSkillsYaml(skillDef);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Created skill: ${opts.name} (${opts.price} cr/call)`);
  console.log(`  Command: ${opts.command}`);
  if (params.length > 0) console.log(`  Params:  ${params.join(', ')}`);
  console.log(`  Added to ${getSkillsYamlPath()}`);
  console.log(`  Run 'agentbnb serve' to start accepting requests.`);
}

async function wrapDetectedCli(binary: string, info: DetectedCliInfo, opts: WrapOptions): Promise<number> {
  const baseName = binary.replace(/^cli-anything-/, '');

  if (info.subcommands.length === 0) {
    const price = resolvePrice(opts.price, binary, opts.category);
    await wrapSingleSkill({
      name: opts.name ?? baseName,
      command: `${binary} \${params.input}`,
      description: opts.description ?? info.description,
      price,
      category: opts.category,
      tags: opts.tags,
      dryRun: opts.dryRun,
    });
    return 1;
  }

  console.log(`\n${binary} — ${info.description}`);
  console.log(`Found ${info.subcommands.length} subcommand(s):`);
  for (const sub of info.subcommands) {
    const price = suggestPrice(`${baseName}-${sub.name}`, opts.category);
    console.log(`  ${sub.name.padEnd(20)} ${String(price).padEnd(4)} cr  ${sub.description}`);
  }

  if (!opts.yes && !opts.dryRun) {
    const confirm = await prompt('\nCreate skills for all subcommands? (Y/n)', 'Y');
    if (confirm.toLowerCase() === 'n') return 0;
  }

  let created = 0;
  for (const sub of info.subcommands) {
    const skillName = `${baseName}-${sub.name}`;
    const price = resolvePrice(opts.price, `${baseName}-${sub.name}`, opts.category);
    try {
      await wrapSingleSkill({
        name: skillName,
        command: `${binary} ${sub.name} \${params.input}`,
        description: sub.description,
        price,
        category: opts.category,
        tags: opts.tags,
        dryRun: opts.dryRun,
      });
      created++;
    } catch (err) {
      console.error(`  Skipping ${skillName}: ${(err as Error).message}`);
    }
  }
  return created;
}
