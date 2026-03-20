import { describe, it, expect } from 'vitest';
import { TemplateEvolutionSchema } from './schema.js';

const VALID_EVOLUTION = {
  template_name: 'genesis-template',
  template_version: '1.2.3',
  publisher_agent: 'agent-alice',
  changelog: 'Improved memory consolidation logic',
  core_memory_snapshot: [
    { category: 'identity', importance: 0.9, content: 'I am a helpful assistant', scope: 'global' },
  ],
  fitness_improvement: 0.15,
  timestamp: '2026-03-21T10:00:00.000Z',
};

describe('TemplateEvolutionSchema', () => {
  it('accepts a valid evolution with all fields', () => {
    const result = TemplateEvolutionSchema.safeParse(VALID_EVOLUTION);
    expect(result.success).toBe(true);
  });

  it('accepts optional scope field absence in core_memory_snapshot', () => {
    const ev = {
      ...VALID_EVOLUTION,
      core_memory_snapshot: [
        { category: 'identity', importance: 0.5, content: 'minimal entry' },
      ],
    };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });

  it('rejects invalid semver version — missing patch segment', () => {
    const ev = { ...VALID_EVOLUTION, template_version: '1.2' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects invalid semver version — non-numeric', () => {
    const ev = { ...VALID_EVOLUTION, template_version: '1.2.beta' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects invalid semver version — extra prefix', () => {
    const ev = { ...VALID_EVOLUTION, template_version: 'v1.2.3' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects fitness_improvement below -1', () => {
    const ev = { ...VALID_EVOLUTION, fitness_improvement: -1.5 };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects fitness_improvement above 1', () => {
    const ev = { ...VALID_EVOLUTION, fitness_improvement: 1.1 };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('accepts fitness_improvement at boundary values -1 and 1', () => {
    const ev1 = { ...VALID_EVOLUTION, fitness_improvement: -1 };
    const ev2 = { ...VALID_EVOLUTION, fitness_improvement: 1 };
    expect(TemplateEvolutionSchema.safeParse(ev1).success).toBe(true);
    expect(TemplateEvolutionSchema.safeParse(ev2).success).toBe(true);
  });

  it('rejects core_memory_snapshot with more than 50 items', () => {
    const ev = {
      ...VALID_EVOLUTION,
      core_memory_snapshot: Array.from({ length: 51 }, (_, i) => ({
        category: 'cat',
        importance: 0.5,
        content: `item ${i}`,
      })),
    };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('accepts core_memory_snapshot with exactly 50 items', () => {
    const ev = {
      ...VALID_EVOLUTION,
      core_memory_snapshot: Array.from({ length: 50 }, (_, i) => ({
        category: 'cat',
        importance: 0.5,
        content: `item ${i}`,
      })),
    };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });

  it('rejects importance outside 0-1 range', () => {
    const ev = {
      ...VALID_EVOLUTION,
      core_memory_snapshot: [
        { category: 'cat', importance: 1.5, content: 'too high' },
      ],
    };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('requires timestamp to be ISO datetime', () => {
    const ev = { ...VALID_EVOLUTION, timestamp: 'not-a-datetime' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('accepts timestamp in ISO 8601 format', () => {
    const ev = { ...VALID_EVOLUTION, timestamp: '2026-03-21T00:00:00Z' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });

  it('rejects empty template_name', () => {
    const ev = { ...VALID_EVOLUTION, template_name: '' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects empty publisher_agent', () => {
    const ev = { ...VALID_EVOLUTION, publisher_agent: '' };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it('rejects changelog exceeding 1000 characters', () => {
    const ev = { ...VALID_EVOLUTION, changelog: 'x'.repeat(1001) };
    const result = TemplateEvolutionSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });
});
