import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateHeartbeatSection, injectHeartbeatSection } from './heartbeat-writer.js';
import type { AutonomyConfig } from '../autonomy/tiers.js';
import type { BudgetConfig } from '../credit/budget.js';

function tmpPath(): string {
  return join(tmpdir(), `heartbeat-test-${randomUUID()}.md`);
}

const tmpFiles: string[] = [];

function makeTmp(): string {
  const p = tmpPath();
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tmpFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  tmpFiles.length = 0;
});

describe('generateHeartbeatSection', () => {
  const autonomy: AutonomyConfig = { tier1_max_credits: 10, tier2_max_credits: 50 };
  const budget: BudgetConfig = { reserve_credits: 20 };

  it('contains tier1 threshold', () => {
    const section = generateHeartbeatSection(autonomy, budget);
    expect(section).toContain('< 10 credits');
  });

  it('contains tier2 threshold', () => {
    const section = generateHeartbeatSection(autonomy, budget);
    expect(section).toContain('> 50 credits');
  });

  it('contains reserve credits', () => {
    const section = generateHeartbeatSection(autonomy, budget);
    expect(section).toContain('20 credits');
  });

  it('wraps content in HTML comment markers', () => {
    const section = generateHeartbeatSection(autonomy, budget);
    expect(section).toContain('<!-- agentbnb:start -->');
    expect(section).toContain('<!-- agentbnb:end -->');
    // Start marker must come before end marker
    const startIdx = section.indexOf('<!-- agentbnb:start -->');
    const endIdx = section.indexOf('<!-- agentbnb:end -->');
    expect(startIdx).toBeLessThan(endIdx);
  });

  it('reflects different tier configs', () => {
    const section = generateHeartbeatSection({ tier1_max_credits: 5, tier2_max_credits: 100 }, { reserve_credits: 50 });
    expect(section).toContain('< 5 credits');
    expect(section).toContain('> 100 credits');
    expect(section).toContain('50 credits');
  });
});

describe('injectHeartbeatSection', () => {
  const autonomy: AutonomyConfig = { tier1_max_credits: 10, tier2_max_credits: 50 };
  const budget: BudgetConfig = { reserve_credits: 20 };

  it('creates file with markers when file does not exist', () => {
    const p = makeTmp();
    const section = generateHeartbeatSection(autonomy, budget);
    injectHeartbeatSection(p, section);
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8');
    expect(content).toContain('<!-- agentbnb:start -->');
    expect(content).toContain('<!-- agentbnb:end -->');
  });

  it('replaces between markers when file has existing markers', () => {
    const p = makeTmp();
    const oldSection = '<!-- agentbnb:start -->\nOLD CONTENT\n<!-- agentbnb:end -->';
    const surrounding = `# My HEARTBEAT\nExisting content\n${oldSection}\nMore content after`;
    writeFileSync(p, surrounding, 'utf-8');

    const newSection = generateHeartbeatSection(autonomy, budget);
    injectHeartbeatSection(p, newSection);

    const content = readFileSync(p, 'utf-8');
    // Old content replaced
    expect(content).not.toContain('OLD CONTENT');
    // New section present
    expect(content).toContain('<!-- agentbnb:start -->');
    expect(content).toContain('<!-- agentbnb:end -->');
    // Surrounding content preserved
    expect(content).toContain('# My HEARTBEAT');
    expect(content).toContain('Existing content');
    expect(content).toContain('More content after');
  });

  it('appends to file without markers, preserving existing content', () => {
    const p = makeTmp();
    const existing = '# My HEARTBEAT\nSome existing content\n';
    writeFileSync(p, existing, 'utf-8');

    const section = generateHeartbeatSection(autonomy, budget);
    injectHeartbeatSection(p, section);

    const content = readFileSync(p, 'utf-8');
    // Existing content preserved
    expect(content).toContain('# My HEARTBEAT');
    expect(content).toContain('Some existing content');
    // New section appended
    expect(content).toContain('<!-- agentbnb:start -->');
    expect(content).toContain('<!-- agentbnb:end -->');
    // Section appears after existing content
    const existingIdx = content.indexOf('Some existing content');
    const sectionIdx = content.indexOf('<!-- agentbnb:start -->');
    expect(existingIdx).toBeLessThan(sectionIdx);
  });
});
