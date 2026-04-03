import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import yaml from 'js-yaml';
import { isCommunitySkill, isCommunitySkillByNameOrPath } from './openclaw-skills.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentbnb-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a flat-array skills.yaml to a temp dir. */
function writeSkillsYaml(dir: string, skills: object[]): void {
  const comment = '# AgentBnB skills configuration\n';
  writeFileSync(join(dir, 'skills.yaml'), comment + yaml.dump(skills), 'utf-8');
}

describe('skillsList', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
  });

  afterEach(() => {
    if (originalAgentbnbDir !== undefined) process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    else delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prints message when no skills.yaml exists', async () => {
    const { skillsList } = await import('./openclaw-skills.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsList({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No skills configured'),
    );
  });

  it('reads and displays skills from skills.yaml', async () => {
    writeSkillsYaml(tempDir, [
      { id: 'web-search', name: 'Web Search', description: 'Search', pricing: { credits_per_call: 2 } },
      { id: 'voice-tts', name: 'Voice', description: 'TTS', pricing: { credits_per_call: 4 } },
    ]);

    const { skillsList } = await import('./openclaw-skills.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsList({});

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('web-search');
    expect(output).toContain('voice-tts');
  });
});

describe('skillsAdd (manual mode)', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
    writeSkillsYaml(tempDir, []);
  });

  afterEach(() => {
    if (originalAgentbnbDir !== undefined) process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    else delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('appends a new skill to skills.yaml in manual mode', async () => {
    const { skillsAdd } = await import('./openclaw-skills.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsAdd({ manual: true, name: 'my-skill', type: 'command', price: 3, description: 'Does things' });

    const content = readFileSync(join(tempDir, 'skills.yaml'), 'utf-8');
    expect(content).toContain('my-skill');
    expect(content).toContain('credits_per_call: 3');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Added skill'));
  });

  it('errors when name is missing in manual mode', async () => {
    const { skillsAdd } = await import('./openclaw-skills.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(skillsAdd({ manual: true, type: 'command', price: 3 })).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('skillsRemove', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
    writeSkillsYaml(tempDir, [
      { id: 'keep-skill', pricing: { credits_per_call: 2 } },
      { id: 'remove-me', pricing: { credits_per_call: 3 } },
    ]);
  });

  afterEach(() => {
    if (originalAgentbnbDir !== undefined) process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    else delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('removes the specified skill from skills.yaml', async () => {
    const { skillsRemove } = await import('./openclaw-skills.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsRemove('remove-me');

    const content = readFileSync(join(tempDir, 'skills.yaml'), 'utf-8');
    expect(content).not.toContain('remove-me');
    expect(content).toContain('keep-skill');
  });

  it('exits with error when skill not found', async () => {
    const { skillsRemove } = await import('./openclaw-skills.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(skillsRemove('nonexistent')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('skillsPrice', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
    writeSkillsYaml(tempDir, [
      { id: 'my-skill', pricing: { credits_per_call: 2 } },
    ]);
  });

  afterEach(() => {
    if (originalAgentbnbDir !== undefined) process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    else delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('updates the price of the specified skill', async () => {
    const { skillsPrice } = await import('./openclaw-skills.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsPrice('my-skill', 7);

    const content = readFileSync(join(tempDir, 'skills.yaml'), 'utf-8');
    expect(content).toContain('credits_per_call: 7');
  });
});

describe('skillsStats', () => {
  let tempDir: string;
  let originalAgentbnbDir: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    originalAgentbnbDir = process.env['AGENTBNB_DIR'];
    process.env['AGENTBNB_DIR'] = tempDir;
    writeSkillsYaml(tempDir, [
      { id: 'my-skill', pricing: { credits_per_call: 3 } },
    ]);
  });

  afterEach(() => {
    if (originalAgentbnbDir !== undefined) process.env['AGENTBNB_DIR'] = originalAgentbnbDir;
    else delete process.env['AGENTBNB_DIR'];
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shows no hires insight for new skills', async () => {
    const { skillsStats } = await import('./openclaw-skills.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await skillsStats({ days: 7 });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('my-skill');
    // No hires yet — should show 0 or '-'
    expect(output).toMatch(/my-skill/);
  });
});

describe('isCommunitySkill', () => {
  const home = homedir();

  it('returns true for paths under ~/.openclaw/skills/', () => {
    const skillPath = join(home, '.openclaw', 'skills', 'tavily');
    expect(isCommunitySkill(skillPath)).toBe(true);
  });

  it('returns true for paths under ~/.openclaw/extensions/', () => {
    const skillPath = join(home, '.openclaw', 'extensions', 'agentbnb');
    expect(isCommunitySkill(skillPath)).toBe(true);
  });

  it('returns false for workspace skill paths', () => {
    const skillPath = join(home, '.openclaw', 'workspace', 'brains', 'my-agent', 'skills', 'my-skill');
    expect(isCommunitySkill(skillPath)).toBe(false);
  });

  it('returns false for arbitrary paths', () => {
    expect(isCommunitySkill('/tmp/some-skill')).toBe(false);
  });
});

describe('isCommunitySkillByNameOrPath', () => {
  const home = homedir();

  it('returns true for known community skill names', () => {
    expect(isCommunitySkillByNameOrPath('gog')).toBe(true);
    expect(isCommunitySkillByNameOrPath('tavily')).toBe(true);
    expect(isCommunitySkillByNameOrPath('find-skills')).toBe(true);
    expect(isCommunitySkillByNameOrPath('skill-vetter')).toBe(true);
    expect(isCommunitySkillByNameOrPath('proactive-agent')).toBe(true);
    expect(isCommunitySkillByNameOrPath('openclaw-security-audit')).toBe(true);
  });

  it('returns false for user skill names without community path', () => {
    expect(isCommunitySkillByNameOrPath('my-custom-skill')).toBe(false);
    expect(isCommunitySkillByNameOrPath('voice-synthesis')).toBe(false);
  });

  it('returns true for unknown name with community path', () => {
    const communityPath = join(home, '.openclaw', 'skills', 'new-community-skill');
    expect(isCommunitySkillByNameOrPath('new-community-skill', communityPath)).toBe(true);
  });

  it('returns false for unknown name with non-community path', () => {
    const userPath = join(home, '.openclaw', 'workspace', 'brains', 'agent', 'skills', 'custom');
    expect(isCommunitySkillByNameOrPath('custom', userPath)).toBe(false);
  });

  it('returns true when name matches even without path', () => {
    expect(isCommunitySkillByNameOrPath('tavily', undefined)).toBe(true);
  });
});
