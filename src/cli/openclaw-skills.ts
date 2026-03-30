/**
 * openclaw skills subcommands — manage shared skills on AgentBnB.
 *
 * Commands: list | add | remove | price | stats
 *
 * All commands read AGENTBNB_DIR from env (set by the caller or environment).
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { getConfigDir, loadConfig } from './config.js';
import type { SkillEntry } from '../workspace/writer.js';

/** A minimal skills.yaml entry shape for read/write operations. */
interface SkillYamlEntry {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  command?: string;
  agent_name?: string;
  pricing?: { credits_per_call: number };
  [key: string]: unknown;
}

/** Prompt helper for interactive input. */
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

/**
 * Reads skills.yaml from the config directory.
 * Handles both flat YAML array format and `{ skills: [...] }` wrapped format.
 *
 * @param configDir - The AGENTBNB_DIR path.
 * @returns Parsed skill entries, or empty array if file doesn't exist.
 */
function readSkillsYaml(configDir: string): SkillYamlEntry[] {
  const yamlPath = join(configDir, 'skills.yaml');
  if (!existsSync(yamlPath)) return [];

  const content = readFileSync(yamlPath, 'utf-8');
  const parsed = yaml.load(content);

  if (Array.isArray(parsed)) return parsed as SkillYamlEntry[];
  if (parsed && typeof parsed === 'object' && 'skills' in parsed) {
    return (parsed as { skills: SkillYamlEntry[] }).skills ?? [];
  }
  return [];
}

/**
 * Writes skills back to skills.yaml.
 * Preserves the flat array format (consistent with `openclaw setup` output).
 */
function writeSkillsYaml(configDir: string, skills: SkillYamlEntry[]): void {
  const yamlPath = join(configDir, 'skills.yaml');
  const comment = '# AgentBnB skills configuration — managed by `agentbnb openclaw skills`\n';
  writeFileSync(yamlPath, comment + yaml.dump(skills, { lineWidth: 100 }), 'utf-8');
}

/** Formats a number as a right-aligned string within a given width. */
function rpad(s: string | number, width: number): string {
  return String(s).padEnd(width);
}

/** Options for skillsList. */
export interface SkillsListOptions {
  agentDir?: string;
}

/**
 * Lists all shared skills with hire counts and revenue.
 *
 * @param opts - Optional AGENTBNB_DIR override.
 */
export async function skillsList(opts: SkillsListOptions): Promise<void> {
  if (opts.agentDir) process.env['AGENTBNB_DIR'] = opts.agentDir;

  const configDir = getConfigDir();
  const skills = readSkillsYaml(configDir);

  if (skills.length === 0) {
    console.log('No skills configured. Run `agentbnb openclaw setup` to share skills.');
    return;
  }

  // Query request_log for hire stats
  const hireMap: Record<string, { hires: number; successes: number; latencySum: number }> = {};
  const config = loadConfig();
  if (config) {
    try {
      const { openDatabase } = await import('../registry/store.js');
      const db = openDatabase(config.db_path);
      try {
        const rows = db
          .prepare(
            `SELECT skill_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
                    SUM(latency_ms) as latency_sum
             FROM request_log
             WHERE skill_id IS NOT NULL
             GROUP BY skill_id`,
          )
          .all() as Array<{
          skill_id: string;
          total: number;
          successes: number;
          latency_sum: number;
        }>;

        for (const row of rows) {
          hireMap[row.skill_id] = {
            hires: row.total,
            successes: row.successes,
            latencySum: row.latency_sum,
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // DB unavailable — show skills without stats
    }
  }

  // Print table
  const headers = ['ID', 'Price', 'Hires', 'Revenue', 'Success%'];
  console.log(
    `\n${rpad(headers[0]!, 24)} ${rpad(headers[1]!, 8)} ${rpad(headers[2]!, 7)} ${rpad(headers[3]!, 9)} ${headers[4]}`,
  );
  console.log('-'.repeat(62));

  for (const skill of skills) {
    const price = skill.pricing?.credits_per_call ?? 0;
    const stats = hireMap[skill.id];
    const hires = stats?.hires ?? 0;
    const revenue = hires * price;
    const successPct =
      hires > 0 ? Math.round(((stats?.successes ?? 0) / hires) * 100) + '%' : '-';

    console.log(
      `${rpad(skill.id, 24)} ${rpad(price + ' cr', 8)} ${rpad(hires, 7)} ${rpad(revenue + ' cr', 9)} ${successPct}`,
    );
  }
  console.log('');
}

/** Options for skillsAdd. */
export interface SkillsAddOptions {
  manual?: boolean;
  name?: string;
  type?: string;
  price?: number;
  description?: string;
}

/**
 * Adds a new skill to skills.yaml.
 *
 * Manual mode: uses flags directly.
 * Interactive mode: discovers unshared capabilities and prompts user.
 *
 * @param opts - Options including manual flag and skill fields.
 */
export async function skillsAdd(opts: SkillsAddOptions): Promise<void> {
  const configDir = getConfigDir();
  const existingSkills = readSkillsYaml(configDir);
  const existingIds = new Set(existingSkills.map((s) => s.id));

  let newSkill: SkillYamlEntry;

  if (opts.manual) {
    // Manual mode: validate required flags
    if (!opts.name) {
      console.error('Error: --name is required in manual mode');
      process.exit(1);
    }
    if (!opts.type || !['command', 'openclaw', 'api', 'pipeline', 'conductor'].includes(opts.type)) {
      console.error('Error: --type must be one of: command, openclaw, api, pipeline, conductor');
      process.exit(1);
    }
    if (opts.price === undefined || isNaN(opts.price)) {
      console.error('Error: --price is required in manual mode');
      process.exit(1);
    }
    if (existingIds.has(opts.name)) {
      console.error(`Error: skill "${opts.name}" already exists. Use \`skills price\` to update price.`);
      process.exit(1);
    }

    newSkill = {
      id: opts.name,
      name: opts.name,
      description: opts.description ?? '',
      type: opts.type,
      command: opts.type === 'command' ? `echo 'TODO: implement ${opts.name}'` : undefined,
      pricing: { credits_per_call: opts.price },
    };
    // Remove undefined fields
    if (newSkill.command === undefined) delete newSkill['command'];
  } else {
    // Interactive mode: discover capabilities
    const { scanCapabilities } = await import('../workspace/scanner.js');

    // Find a brain dir for this agent
    const agentsDir = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root',
      '.openclaw',
      'agents',
    );
    const configParent = configDir.replace(/\/.agentbnb$/, '');
    const agentName = configParent.split('/').pop() ?? '';
    const brainsDir = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root',
      '.openclaw',
      'workspace',
      'brains',
    );
    const brainDir = join(brainsDir, agentName);

    const soulPath = join(agentsDir, agentName, 'SOUL.md');
    const brainSoulPath = join(brainDir, 'SOUL.md');
    const hasBrain = existsSync(brainDir) && existsSync(brainSoulPath);
    const hasSoul = existsSync(soulPath);

    if (!hasBrain && !hasSoul) {
      console.log('No SOUL.md found. Use --manual to add a skill directly.');
      console.log(`  Example: agentbnb openclaw skills add --manual --name my-skill --type command --price 3`);
      return;
    }

    const capabilities = hasBrain
      ? scanCapabilities(brainDir)
      : scanCapabilities(agentsDir + '/' + agentName);

    const unshared = capabilities.filter((c) => !existingIds.has(c.name));

    if (unshared.length === 0) {
      console.log('All detected capabilities are already shared!');
      console.log('Use --manual to add a new skill: agentbnb openclaw skills add --manual --name <id> --type command --price <n>');
      return;
    }

    console.log('\nUnshared capabilities:');
    unshared.forEach((c, i) =>
      console.log(`  ${i + 1}. ${c.name} — ${c.description.slice(0, 50)} (suggested: ${c.suggestedPrice} cr)`),
    );

    const selInput = await prompt('\nSelect capability to add (default: 1): ');
    const selIdx = selInput === '' ? 0 : parseInt(selInput, 10) - 1;
    if (isNaN(selIdx) || selIdx < 0 || selIdx >= unshared.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }

    const selected = unshared[selIdx]!;

    const typeInput = await prompt(`Skill type [command/openclaw] (default: command): `);
    const skillType = typeInput === '' ? 'command' : typeInput;

    const priceInput = await prompt(`Price in credits (default: ${selected.suggestedPrice}): `);
    const skillPrice =
      priceInput === '' ? selected.suggestedPrice : parseFloat(priceInput);

    if (isNaN(skillPrice)) {
      console.error('Invalid price.');
      process.exit(1);
    }

    newSkill = {
      id: selected.name,
      name: selected.name,
      description: selected.description,
      type: skillType,
      pricing: { credits_per_call: skillPrice },
    };

    if (skillType === 'command') {
      newSkill['command'] = `echo 'TODO: implement ${selected.name}'`;
    }
  }

  const updatedSkills = [...existingSkills, newSkill];
  writeSkillsYaml(configDir, updatedSkills);
  console.log(`\n✅ Added skill "${newSkill.id}" (${newSkill.pricing?.credits_per_call} cr)`);

  // Update SOUL.md skills table if section exists
  try {
    const { updateSoulMdSkillsTable } = await import('../workspace/writer.js');
    const agentsDir = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root',
      '.openclaw',
      'agents',
    );
    const configParent = configDir.replace(/\/.agentbnb$/, '');
    const agentName = configParent.split('/').pop() ?? '';
    const soulPath = join(agentsDir, agentName, 'SOUL.md');
    if (existsSync(soulPath)) {
      const skillEntries: SkillEntry[] = updatedSkills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        pricing: s.pricing,
      }));
      updateSoulMdSkillsTable(soulPath, skillEntries);
      console.log(`✅ Updated SOUL.md skills table`);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Removes a skill from skills.yaml and updates SOUL.md.
 *
 * @param skillId - The skill ID to remove.
 */
export async function skillsRemove(skillId: string): Promise<void> {
  const configDir = getConfigDir();
  const skills = readSkillsYaml(configDir);
  const filtered = skills.filter((s) => s.id !== skillId);

  if (filtered.length === skills.length) {
    console.error(`Error: skill "${skillId}" not found.`);
    process.exit(1);
  }

  writeSkillsYaml(configDir, filtered);
  console.log(`✅ Removed skill "${skillId}"`);

  // Update SOUL.md
  try {
    const { updateSoulMdSkillsTable } = await import('../workspace/writer.js');
    const agentsDir = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root',
      '.openclaw',
      'agents',
    );
    const configParent = configDir.replace(/\/.agentbnb$/, '');
    const agentName = configParent.split('/').pop() ?? '';
    const soulPath = join(agentsDir, agentName, 'SOUL.md');
    if (existsSync(soulPath)) {
      const skillEntries: SkillEntry[] = filtered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        pricing: s.pricing,
      }));
      updateSoulMdSkillsTable(soulPath, skillEntries);
      console.log(`✅ Updated SOUL.md skills table`);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Updates the price of an existing skill.
 *
 * @param skillId - The skill ID to update.
 * @param newPrice - The new credits_per_call value.
 */
export async function skillsPrice(skillId: string, newPrice: number): Promise<void> {
  const configDir = getConfigDir();
  const skills = readSkillsYaml(configDir);
  const skill = skills.find((s) => s.id === skillId);

  if (!skill) {
    console.error(`Error: skill "${skillId}" not found.`);
    process.exit(1);
  }

  const oldPrice = skill.pricing?.credits_per_call ?? 0;
  skill.pricing = { ...(skill.pricing ?? {}), credits_per_call: newPrice };

  writeSkillsYaml(configDir, skills);
  console.log(`✅ Updated "${skillId}" price: ${oldPrice} cr → ${newPrice} cr`);

  // Update SOUL.md
  try {
    const { updateSoulMdSkillsTable } = await import('../workspace/writer.js');
    const agentsDir = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root',
      '.openclaw',
      'agents',
    );
    const configParent = configDir.replace(/\/.agentbnb$/, '');
    const agentName = configParent.split('/').pop() ?? '';
    const soulPath = join(agentsDir, agentName, 'SOUL.md');
    if (existsSync(soulPath)) {
      const skillEntries: SkillEntry[] = skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        pricing: s.pricing,
      }));
      updateSoulMdSkillsTable(soulPath, skillEntries);
      console.log(`✅ Updated SOUL.md skills table`);
    }
  } catch {
    // Non-fatal
  }
}

/** Options for skillsStats. */
export interface SkillsStatsOptions {
  days?: number;
}

/**
 * Shows revenue and performance report for shared skills.
 *
 * @param opts - Options including lookback days (default: 7).
 */
export async function skillsStats(opts: SkillsStatsOptions): Promise<void> {
  const days = opts.days ?? 7;
  const configDir = getConfigDir();
  const skills = readSkillsYaml(configDir);

  if (skills.length === 0) {
    console.log('No skills configured.');
    return;
  }

  const priceMap: Record<string, number> = {};
  for (const s of skills) {
    priceMap[s.id] = s.pricing?.credits_per_call ?? 0;
  }

  interface StatRow {
    skill_id: string;
    hires: number;
    successes: number;
    failures: number;
    avg_latency: number | null;
  }

  let rows: StatRow[] = [];
  const config = loadConfig();
  if (config) {
    try {
      const { openDatabase } = await import('../registry/store.js');
      const db = openDatabase(config.db_path);
      try {
        rows = db
          .prepare(
            `SELECT skill_id,
                    COUNT(*) as hires,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
                    SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failures,
                    AVG(CASE WHEN status = 'success' THEN latency_ms END) as avg_latency
             FROM request_log
             WHERE skill_id IS NOT NULL
               AND created_at > datetime('now', '-${days} days')
             GROUP BY skill_id`,
          )
          .all() as StatRow[];
      } finally {
        db.close();
      }
    } catch {
      // DB unavailable
    }
  }

  const statsMap: Record<string, StatRow> = {};
  for (const row of rows) {
    statsMap[row.skill_id] = row;
  }

  console.log(`\nSkill Performance — last ${days} days`);
  console.log('='.repeat(70));
  console.log(
    `${rpad('Skill', 24)} ${rpad('Hires', 7)} ${rpad('Revenue', 9)} ${rpad('Success%', 9)} Avg Latency`,
  );
  console.log('-'.repeat(70));

  let totalRevenue = 0;
  const insights: string[] = [];

  for (const skill of skills) {
    const stat = statsMap[skill.id];
    const price = priceMap[skill.id] ?? 0;
    const hires = stat?.hires ?? 0;
    const successes = stat?.successes ?? 0;
    const revenue = hires * price;
    totalRevenue += revenue;

    const successPct = hires > 0 ? Math.round((successes / hires) * 100) : null;
    const avgLatency =
      stat?.avg_latency != null ? Math.round(stat.avg_latency) + 'ms' : '-';

    console.log(
      `${rpad(skill.id, 24)} ${rpad(hires, 7)} ${rpad(revenue + ' cr', 9)} ${rpad(successPct !== null ? successPct + '%' : '-', 9)} ${avgLatency}`,
    );

    // Collect insights
    if (hires > 0 && successPct !== null && successPct < 70) {
      insights.push(`⚠️  "${skill.id}" has low success rate (${successPct}%) — check command implementation`);
    }
    if (hires > 10 && price < 3) {
      insights.push(`💡 "${skill.id}" is in high demand (${hires} hires) — consider raising price`);
    }
    if (hires === 0) {
      insights.push(`📢 "${skill.id}" has no hires in ${days} days — check discovery or lower price`);
    }
  }

  console.log('-'.repeat(70));
  console.log(`${'Total'.padEnd(24)} ${''.padEnd(7)} ${rpad(totalRevenue + ' cr', 9)}`);

  if (insights.length > 0) {
    console.log('\nInsights:');
    for (const insight of insights) {
      console.log(`  ${insight}`);
    }
  }
  console.log('');
}
