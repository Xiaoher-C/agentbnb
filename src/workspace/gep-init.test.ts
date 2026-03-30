import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initGepDir } from './gep-init.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentbnb-gep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('initGepDir', () => {
  let brainDir: string;

  beforeEach(() => {
    brainDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(brainDir, { recursive: true, force: true });
  });

  it('creates gep/ directory with three files', () => {
    initGepDir(brainDir);

    const gepDir = join(brainDir, 'gep');
    expect(existsSync(gepDir)).toBe(true);
    expect(existsSync(join(gepDir, 'genes.json'))).toBe(true);
    expect(existsSync(join(gepDir, 'capsules.json'))).toBe(true);
    expect(existsSync(join(gepDir, 'events.jsonl'))).toBe(true);
  });

  it('writes valid empty arrays to genes.json and capsules.json', () => {
    initGepDir(brainDir);

    const gepDir = join(brainDir, 'gep');
    const genes = JSON.parse(readFileSync(join(gepDir, 'genes.json'), 'utf-8')) as unknown;
    const capsules = JSON.parse(readFileSync(join(gepDir, 'capsules.json'), 'utf-8')) as unknown;

    expect(genes).toEqual([]);
    expect(capsules).toEqual([]);
  });

  it('writes empty events.jsonl', () => {
    initGepDir(brainDir);
    const content = readFileSync(join(brainDir, 'gep', 'events.jsonl'), 'utf-8');
    expect(content).toBe('');
  });

  it('is a no-op when gep/ already exists', () => {
    // Create gep dir with custom content
    const gepDir = join(brainDir, 'gep');
    mkdirSync(gepDir, { recursive: true });
    const customContent = '[{"trait":"strength"}]\n';
    const customPath = join(gepDir, 'genes.json');
    writeFileSync(customPath, customContent, 'utf-8');

    initGepDir(brainDir);

    // Custom content should be preserved
    const content = readFileSync(customPath, 'utf-8');
    expect(content).toBe(customContent);
  });
});
