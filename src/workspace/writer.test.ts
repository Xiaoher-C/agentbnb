import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendSoulMdTradingSection,
  updateSoulMdSkillsTable,
  appendHeartbeatTradingSection,
  writeBootstrapMd,
} from './writer.js';
import type { SkillEntry } from './writer.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentbnb-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SAMPLE_SKILLS: SkillEntry[] = [
  { id: 'web-search', name: 'Web Search', description: 'Searches the web', pricing: { credits_per_call: 2 } },
  { id: 'voice-tts', name: 'Voice TTS', description: 'Converts text to speech', pricing: { credits_per_call: 4 } },
];

describe('appendSoulMdTradingSection', () => {
  let tempDir: string;
  let soulPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    soulPath = join(tempDir, 'SOUL.md');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends the AgentBnB section when not present', () => {
    writeFileSync(soulPath, '# My Agent\n\nI do things.\n', 'utf-8');

    appendSoulMdTradingSection(soulPath, SAMPLE_SKILLS, '/home/agent/.agentbnb');

    const content = readFileSync(soulPath, 'utf-8');
    expect(content).toContain('## AgentBnB Network Trading');
    expect(content).toContain('web-search');
    expect(content).toContain('2 cr');
    expect(content).toContain('voice-tts');
    expect(content).toContain('4 cr');
    expect(content).toContain('/home/agent/.agentbnb');
    expect(content).toContain('gep/genes.json');
  });

  it('is idempotent: does not append twice', () => {
    writeFileSync(soulPath, '# My Agent\n\nI do things.\n', 'utf-8');

    appendSoulMdTradingSection(soulPath, SAMPLE_SKILLS, '/home/agent/.agentbnb');
    appendSoulMdTradingSection(soulPath, SAMPLE_SKILLS, '/home/agent/.agentbnb');

    const content = readFileSync(soulPath, 'utf-8');
    const count = (content.match(/## AgentBnB Network Trading/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('includes trading rules and earn section', () => {
    writeFileSync(soulPath, '# My Agent\n\nDescription.\n', 'utf-8');

    appendSoulMdTradingSection(soulPath, SAMPLE_SKILLS, '/path/to/.agentbnb');

    const content = readFileSync(soulPath, 'utf-8');
    expect(content).toContain('Reserve floor: 20 credits');
    expect(content).toContain('How to Earn');
    expect(content).toContain('5% network fee');
  });

  it('renders skill table with truncated descriptions', () => {
    const longDescSkills: SkillEntry[] = [{
      id: 'long-skill',
      description: 'A'.repeat(100),
      pricing: { credits_per_call: 3 },
    }];
    writeFileSync(soulPath, '# Agent\n', 'utf-8');

    appendSoulMdTradingSection(soulPath, longDescSkills, '/dir');

    const content = readFileSync(soulPath, 'utf-8');
    // Description should be truncated to 60 chars
    expect(content).toContain('long-skill');
    expect(content).not.toContain('A'.repeat(61));
  });
});

describe('updateSoulMdSkillsTable', () => {
  let tempDir: string;
  let soulPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    soulPath = join(tempDir, 'SOUL.md');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('no-op when AgentBnB section does not exist', () => {
    const original = '# My Agent\n\nNo section here.\n';
    writeFileSync(soulPath, original, 'utf-8');

    updateSoulMdSkillsTable(soulPath, SAMPLE_SKILLS);

    const content = readFileSync(soulPath, 'utf-8');
    expect(content).toBe(original);
  });

  it('updates the skills table without clobbering surrounding content', () => {
    // First append the section
    writeFileSync(soulPath, '# My Agent\n\nDescription.\n', 'utf-8');
    appendSoulMdTradingSection(soulPath, SAMPLE_SKILLS, '/dir');

    // Now update with a new skills list
    const newSkills: SkillEntry[] = [
      { id: 'new-skill', description: 'Brand new skill', pricing: { credits_per_call: 5 } },
    ];
    updateSoulMdSkillsTable(soulPath, newSkills);

    const content = readFileSync(soulPath, 'utf-8');
    expect(content).toContain('new-skill');
    expect(content).toContain('5 cr');
    // Header and trading rules should still be present
    expect(content).toContain('## AgentBnB Network Trading');
    expect(content).toContain('Trading Rules');
  });
});

describe('appendHeartbeatTradingSection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('no-op when HEARTBEAT.md does not exist', () => {
    // Should not throw
    appendHeartbeatTradingSection(join(tempDir, 'HEARTBEAT.md'), '/dir');
  });

  it('appends trading section to existing HEARTBEAT.md', () => {
    const hbPath = join(tempDir, 'HEARTBEAT.md');
    writeFileSync(hbPath, '# Heartbeat\n\nEvery 5 min check status.\n', 'utf-8');

    appendHeartbeatTradingSection(hbPath, '/home/agent/.agentbnb');

    const content = readFileSync(hbPath, 'utf-8');
    expect(content).toContain('AgentBnB Trading Cycle');
    expect(content).toContain('/home/agent/.agentbnb');
  });

  it('is idempotent', () => {
    const hbPath = join(tempDir, 'HEARTBEAT.md');
    writeFileSync(hbPath, '# Heartbeat\n', 'utf-8');

    appendHeartbeatTradingSection(hbPath, '/dir');
    appendHeartbeatTradingSection(hbPath, '/dir');

    const content = readFileSync(hbPath, 'utf-8');
    const count = (content.match(/AgentBnB Trading Cycle/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('writeBootstrapMd', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes BOOTSTRAP.md with setup command', () => {
    const bootstrapPath = join(tempDir, 'BOOTSTRAP.md');

    writeBootstrapMd(bootstrapPath, '/home/agent/.agentbnb');

    const content = readFileSync(bootstrapPath, 'utf-8');
    expect(content).toContain('AgentBnB First-Run Setup');
    expect(content).toContain('AGENTBNB_DIR=/home/agent/.agentbnb agentbnb openclaw setup');
    expect(content).toContain('delete this file');
  });
});
