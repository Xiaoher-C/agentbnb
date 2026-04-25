import { describe, test, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  parseSkillsYaml,
  resolveCommandToSkillPath,
  synthesizeRegisteredSkill,
} from '../src/skills-yaml.js';
import type { SkillsYamlEntry } from '../src/types.js';

// ─── resolveCommandToSkillPath ────────────────────────────────────────────

describe('resolveCommandToSkillPath', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-inspector-test-'));

  afterAll(() => {
    try { rmSync(tmp, { recursive: true }); } catch { /* ignore */ }
  });

  test('resolves absolute path with SKILL.md 2 levels up', () => {
    // Create tmp/SkillFoo/dist/index.js and tmp/SkillFoo/SKILL.md
    const skillDir = join(tmp, 'SkillFoo');
    mkdirSync(join(skillDir, 'dist'), { recursive: true });
    writeFileSync(join(skillDir, 'dist', 'index.js'), '// entry');
    writeFileSync(join(skillDir, 'SKILL.md'), '# SkillFoo');

    const result = resolveCommandToSkillPath(
      `node ${join(skillDir, 'dist', 'index.js')}`,
      tmp,
    );
    expect(result).toBe(skillDir);
  });

  test('resolves ~ expansion using os.homedir()', () => {
    const homeSkillDir = join(homedir(), 'Skills_test_bar');
    mkdirSync(homeSkillDir, { recursive: true });
    writeFileSync(join(homeSkillDir, 'run.js'), '// entry');
    writeFileSync(join(homeSkillDir, 'SKILL.md'), '# Bar');

    const result = resolveCommandToSkillPath(
      'node ~/Skills_test_bar/run.js',
      tmp,
    );
    expect(result).toBe(homeSkillDir);

    // Cleanup
    try { rmSync(homeSkillDir, { recursive: true }); } catch { /* ignore */ }
  });

  test('resolves relative path against yamlDir', () => {
    // Create tmp/project/scripts/run.sh and tmp/project/SKILL.md
    const projectDir = join(tmp, 'project');
    mkdirSync(join(projectDir, 'scripts'), { recursive: true });
    writeFileSync(join(projectDir, 'scripts', 'run.sh'), '#!/bin/sh');
    writeFileSync(join(projectDir, 'SKILL.md'), '# Project');

    const result = resolveCommandToSkillPath('./scripts/run.sh', projectDir);
    expect(result).toBe(projectDir);
  });

  test('returns null when SKILL.md not found within 5 levels', () => {
    // Create a deep path with no SKILL.md
    const deepDir = join(tmp, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    mkdirSync(deepDir, { recursive: true });
    const deepFile = join(deepDir, 'entry.js');
    writeFileSync(deepFile, '// entry');

    const result = resolveCommandToSkillPath(`node ${deepFile}`, tmp);
    expect(result).toBeNull();
  });

  test('returns null for python -m module_name', () => {
    expect(resolveCommandToSkillPath('python -m deep_stock_analyst', tmp)).toBeNull();
  });

  test('returns null for docker run image:latest', () => {
    expect(resolveCommandToSkillPath('docker run xxx:latest', tmp)).toBeNull();
  });

  test('returns null for /usr/local/bin/custom-skill', () => {
    expect(resolveCommandToSkillPath('/usr/local/bin/custom-skill', tmp)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(resolveCommandToSkillPath('', tmp)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(resolveCommandToSkillPath(undefined, tmp)).toBeNull();
  });
});

// ─── parseSkillsYaml ──────────────────────────────────────────────────────

describe('parseSkillsYaml', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-inspector-yaml-'));

  afterAll(() => {
    try { rmSync(tmp, { recursive: true }); } catch { /* ignore */ }
  });

  test('parses valid skills.yaml with command/api/conductor entries', () => {
    const yamlPath = join(tmp, 'skills.yaml');
    writeFileSync(yamlPath, `
skills:
  - id: deep-stock-analyst
    name: Deep Stock Analyst
    type: command
    command: "node ~/Skills/deep-stock-analyst/dist/index.js"
    description: "AI-powered stock analysis"
    version: "1.0.0"
  - id: web-crawl
    name: Web Crawler
    type: api
    endpoint: "http://localhost:3000/crawl"
  - id: orchestrator
    type: conductor
`);

    const entries = parseSkillsYaml(yamlPath);
    expect(entries).toHaveLength(3);

    expect(entries[0].id).toBe('deep-stock-analyst');
    expect(entries[0].name).toBe('Deep Stock Analyst');
    expect(entries[0].type).toBe('command');
    expect(entries[0].command).toBe('node ~/Skills/deep-stock-analyst/dist/index.js');
    expect(entries[0].description).toBe('AI-powered stock analysis');
    expect(entries[0].version).toBe('1.0.0');

    expect(entries[1].id).toBe('web-crawl');
    expect(entries[1].type).toBe('api');
    expect(entries[1].endpoint).toBe('http://localhost:3000/crawl');

    expect(entries[2].id).toBe('orchestrator');
    expect(entries[2].type).toBe('conductor');
  });

  test('returns [] for nonexistent file', () => {
    expect(parseSkillsYaml(join(tmp, 'nonexistent.yaml'))).toEqual([]);
  });

  test('returns [] for malformed YAML (no throw)', () => {
    const yamlPath = join(tmp, 'bad.yaml');
    writeFileSync(yamlPath, '{{{{not yaml');
    expect(parseSkillsYaml(yamlPath)).toEqual([]);
  });

  test('handles missing optional fields gracefully', () => {
    const yamlPath = join(tmp, 'minimal.yaml');
    writeFileSync(yamlPath, `
skills:
  - id: bare-skill
`);
    const entries = parseSkillsYaml(yamlPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('bare-skill');
    expect(entries[0].name).toBe('bare-skill'); // falls back to id
    expect(entries[0].type).toBe('command'); // default type
    expect(entries[0].command).toBeUndefined();
    expect(entries[0].description).toBeUndefined();
    expect(entries[0].version).toBeUndefined();
  });
});

// ─── synthesizeRegisteredSkill ────────────────────────────────────────────

describe('synthesizeRegisteredSkill', () => {
  test('produces correct registered skill entry', () => {
    const entry: SkillsYamlEntry = {
      id: 'deep-stock-analyst',
      name: 'Deep Stock Analyst',
      type: 'command',
      command: 'node ~/foo/dist/index.js',
      description: 'AI stock analysis',
      version: '2.0.0',
    };

    const result = synthesizeRegisteredSkill(
      entry,
      '/home/user/.agentbnb/skills.yaml',
      ['host:mac-mini'],
    );

    expect(result.source).toBe('skills_yaml');
    expect(result.provenanceState).toBe('registered');
    expect(result.name).toBe('Deep Stock Analyst');
    expect(result.description).toBe('AI stock analysis');
    expect(result.path).toBe('/home/user/.agentbnb/skills.yaml');
    expect(result.canonicalPath).toBe('/home/user/.agentbnb/skills.yaml');
    expect(result.loadedBy).toEqual(['host:mac-mini']);
    expect(result.version).toBe('2.0.0');
    // skillId should be stable sha256 prefix
    expect(result.skillId).toHaveLength(16);
  });

  test('uses fallback description when missing', () => {
    const entry: SkillsYamlEntry = {
      id: 'bare',
      name: 'Bare',
      type: 'api',
    };

    const result = synthesizeRegisteredSkill(entry, '/tmp/skills.yaml', []);
    expect(result.description).toBe('Registered api skill — no SKILL.md');
  });
});
