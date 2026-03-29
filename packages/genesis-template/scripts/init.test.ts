// Test that templates compile and produce expected output
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { renderTemplate } from './template-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../templates');

const sampleVars = {
  agentName: 'test-bot',
  ownerName: 'TestOwner',
  domain: 'software dev',
  language: 'English',
  layer0Model: 'claude-haiku-4-5',
  layer1Model: 'claude-sonnet-4-6',
  layer1DailyCap: 100000,
  layer2DailyCap: 50,
  tier1Threshold: 10,
  tier2Threshold: 50,
  reserveFloor: 20,
  joinNetwork: true,
};

describe('Genesis Template rendering', () => {
  it('SOUL.md template renders agent name', () => {
    const src = readFileSync(join(TEMPLATES_DIR, 'SOUL.md.hbs'), 'utf8');
    const result = renderTemplate(src, sampleVars);
    expect(result).toContain('test-bot');
    expect(result).toContain('claude-haiku-4-5');
    expect(result).toContain('100000 tokens/day');
  });

  it('HEARTBEAT.md template renders thresholds', () => {
    const src = readFileSync(join(TEMPLATES_DIR, 'HEARTBEAT.md.hbs'), 'utf8');
    const result = renderTemplate(src, sampleVars);
    expect(result).toContain('10');
    expect(result).toContain('50');
    expect(result).toContain('20 credits');
  });

  it('openclaw.plugin.json template renders valid JSON', () => {
    const src = readFileSync(join(TEMPLATES_DIR, 'openclaw.plugin.json.hbs'), 'utf8');
    const result = renderTemplate(src, sampleVars);
    const parsed = JSON.parse(result) as { name: string; network: { agentbnb: boolean } };
    expect(parsed.name).toBe('test-bot');
    expect(parsed.network.agentbnb).toBe(true);
  });
});
