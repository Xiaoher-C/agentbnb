import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanAgents, scanCapabilities } from './scanner.js';

/** Create a temp dir for test isolation. */
function makeTempDir(): string {
  const dir = join(tmpdir(), `agentbnb-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('scanAgents', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = makeTempDir();
    originalHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env['HOME'] = originalHome;
    else delete process.env['HOME'];
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns empty array when no openclaw directories exist', () => {
    const result = scanAgents();
    expect(result).toEqual([]);
  });

  it('scans workspace/brains/ directory for agents', () => {
    const brainsDir = join(tempHome, '.openclaw', 'workspace', 'brains', 'my-agent');
    mkdirSync(brainsDir, { recursive: true });
    writeFileSync(
      join(brainsDir, 'SOUL.md'),
      '# My Agent\n\nI am a test agent that does things.\n\n## Skill One\n\nDoes skill one.',
      'utf-8',
    );

    const result = scanAgents();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('my-agent');
    expect(result[0]!.description).toContain('test agent');
    expect(result[0]!.brainDir).toBe(brainsDir);
  });

  it('counts skills in the skills/ subdirectory', () => {
    const brainsDir = join(tempHome, '.openclaw', 'workspace', 'brains', 'skill-agent');
    mkdirSync(join(brainsDir, 'skills', 'skill-a'), { recursive: true });
    mkdirSync(join(brainsDir, 'skills', 'skill-b'), { recursive: true });
    writeFileSync(join(brainsDir, 'SOUL.md'), '# Agent\n\nDescription here.', 'utf-8');

    const result = scanAgents();
    expect(result[0]!.name).toBe('skill-agent');
    expect(result[0]!.skillCount).toBe(2);
  });

  it('falls back to agents/ directory for agents without brain dirs', () => {
    const agentsDir = join(tempHome, '.openclaw', 'agents', 'legacy-agent');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'SOUL.md'), '# Legacy\n\nLegacy agent.', 'utf-8');

    const result = scanAgents();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('legacy-agent');
    expect(result[0]!.brainDir).toBe('');
  });

  it('deduplicates: brain agent takes precedence over legacy agent with same name', () => {
    const brainsDir = join(tempHome, '.openclaw', 'workspace', 'brains', 'shared-agent');
    mkdirSync(brainsDir, { recursive: true });
    writeFileSync(join(brainsDir, 'SOUL.md'), '# Shared\n\nBrain version.', 'utf-8');

    const agentsDir = join(tempHome, '.openclaw', 'agents', 'shared-agent');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'SOUL.md'), '# Shared\n\nLegacy version.', 'utf-8');

    const result = scanAgents();
    expect(result).toHaveLength(1);
    expect(result[0]!.brainDir).toBe(brainsDir);
    expect(result[0]!.description).toContain('Brain version');
  });

  it('returns agents sorted by name', () => {
    const brainsBase = join(tempHome, '.openclaw', 'workspace', 'brains');
    for (const name of ['zebra-bot', 'alpha-bot', 'middle-bot']) {
      mkdirSync(join(brainsBase, name), { recursive: true });
      writeFileSync(join(brainsBase, name, 'SOUL.md'), `# ${name}\n\nDesc.`, 'utf-8');
    }

    const result = scanAgents();
    expect(result.map((r) => r.name)).toEqual(['alpha-bot', 'middle-bot', 'zebra-bot']);
  });
});

describe('scanCapabilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when SOUL.md does not exist', () => {
    const result = scanCapabilities(tempDir);
    expect(result).toEqual([]);
  });

  it('parses H2 sections from SOUL.md as capabilities', () => {
    writeFileSync(
      join(tempDir, 'SOUL.md'),
      '# My Agent\n\nI do things.\n\n## Web Search\n\nSearches the web.\n\n## Voice Synthesis\n\nSpeaks text aloud.',
      'utf-8',
    );

    const result = scanCapabilities(tempDir);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Web Search');
    expect(result[0]!.source).toBe('soul_md');
    expect(result[1]!.name).toBe('Voice Synthesis');
  });

  it('skips AgentBnB Network Trading section', () => {
    writeFileSync(
      join(tempDir, 'SOUL.md'),
      '# Agent\n\n## My Skill\n\nDoes stuff.\n\n## AgentBnB Network Trading\n\nTrading info.',
      'utf-8',
    );

    const result = scanCapabilities(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('My Skill');
  });

  it('reads skills/*/SKILL.md frontmatter for additional capabilities', () => {
    const skillDir = join(tempDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: Custom Skill\ndescription: Does something custom\n---\n\n# Details',
      'utf-8',
    );

    const result = scanCapabilities(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Custom Skill');
    expect(result[0]!.description).toBe('Does something custom');
    expect(result[0]!.source).toBe('skill_md');
  });

  it('deduplicates capabilities across SOUL.md and SKILL.md', () => {
    writeFileSync(
      join(tempDir, 'SOUL.md'),
      '# Agent\n\n## My Skill\n\nFrom SOUL.',
      'utf-8',
    );

    const skillDir = join(tempDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: My Skill\ndescription: From SKILL.md\n---',
      'utf-8',
    );

    const result = scanCapabilities(tempDir);
    // Deduplicated: soul_md takes precedence
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('soul_md');
  });

  it('applies heuristic pricing based on skill name', () => {
    writeFileSync(
      join(tempDir, 'SOUL.md'),
      '# Agent\n\n## voice-tts\n\nVoice synthesis.\n\n## stealth-scrape\n\nScraping.',
      'utf-8',
    );

    const result = scanCapabilities(tempDir);
    const voice = result.find((r) => r.name === 'voice-tts');
    const scrape = result.find((r) => r.name === 'stealth-scrape');
    expect(voice?.suggestedPrice).toBe(4); // voice heuristic
    expect(scrape?.suggestedPrice).toBe(5); // scrape heuristic
  });
});
