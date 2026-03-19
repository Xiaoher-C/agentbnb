import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../registry/store.js';
import { CapabilityCardV2Schema } from '../types/index.js';
import { parseSoulMdV2, publishFromSoulV2 } from './soul-sync.js';
import type Database from 'better-sqlite3';

describe('parseSoulMdV2', () => {
  it('maps H2 sections to Skill[] with sanitized IDs', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\n## OCR\nOptical char recognition';
    const result = parseSoulMdV2(content);
    expect(result.agentName).toBe('Agent');
    expect(result.description).toBe('Desc');
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]!.id).toBe('tts');
    expect(result.skills[0]!.name).toBe('TTS');
    expect(result.skills[1]!.id).toBe('ocr');
    expect(result.skills[1]!.name).toBe('OCR');
  });

  it('sanitizes special characters in H2 headings', () => {
    const content = '# Agent\nDesc\n## TTS / Audio (v2)\nAudio processing skill';
    const result = parseSoulMdV2(content);
    expect(result.skills).toHaveLength(1);
    // Non-alphanumeric-dash chars stripped, spaces become dashes
    expect(result.skills[0]!.id).toBe('tts--audio-v2');
  });

  it('returns empty skills array with zero H2 sections', () => {
    const content = '# Agent\nDescription only, no skills';
    const result = parseSoulMdV2(content);
    expect(result.skills).toHaveLength(0);
    expect(result.agentName).toBe('Agent');
  });

  it('produces skills with correct defaults', () => {
    const content = '# MyAgent\nMy description\n## Code Review\nReviews code';
    const result = parseSoulMdV2(content);
    const skill = result.skills[0]!;
    expect(skill.level).toBe(2);
    expect(skill.pricing.credits_per_call).toBe(10);
    expect(skill.availability?.online).toBe(true);
    expect(skill.inputs).toHaveLength(1);
    expect(skill.outputs).toHaveLength(1);
    expect(skill.inputs[0]!.type).toBe('text');
  });

  it('uses UUID fallback for empty sanitized id', () => {
    // All special chars with no alphanumeric or dash chars - only symbols that get stripped
    const content = '# Agent\nDesc\n## !!!()\nSkill with no valid id chars';
    const result = parseSoulMdV2(content);
    expect(result.skills).toHaveLength(1);
    // Should be a UUID (36 chars) when sanitized id is empty
    expect(result.skills[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('truncates long descriptions to 500 chars', () => {
    const longDesc = 'x'.repeat(600);
    const content = `# Agent\nDesc\n## Skill\n${longDesc}`;
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.description.length).toBeLessThanOrEqual(500);
  });

  it('sets credits_per_call from pricing: N in skill body', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: 25';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(25);
  });

  it('keeps default 10 when no pricing line present', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(10);
  });

  it('sets credits_per_call to 0 for free skills', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: 0';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(0);
  });

  it('ignores invalid non-numeric pricing value', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: abc';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(10);
  });

  it('ignores negative pricing value', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: -5';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(10);
  });

  it('supports different pricing per skill in multi-skill SOUL.md', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: 25\n## OCR\nOCR service\npricing: 5';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.pricing.credits_per_call).toBe(25);
    expect(result.skills[1]!.pricing.credits_per_call).toBe(5);
  });

  it('does not include pricing line in skill description', () => {
    const content = '# Agent\nDesc\n## TTS\nText to speech\npricing: 25';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.description).not.toContain('pricing:');
    expect(result.skills[0]!.description).toBe('Text to speech');
  });
});

describe('publishFromSoulV2', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('inserts a valid CapabilityCardV2 (spec_version 2.0) into SQLite', () => {
    const soul = '# TestAgent\nAgent for testing\n## TTS\nText to speech skill';
    const card = publishFromSoulV2(db, soul, 'owner-1');
    expect(card.spec_version).toBe('2.0');
    expect(card.owner).toBe('owner-1');
    expect(card.skills).toHaveLength(1);
    // CapabilityCardV2Schema.parse should not throw
    expect(() => CapabilityCardV2Schema.parse(card)).not.toThrow();
  });

  it('upserts on second call — no duplicate cards', () => {
    const soul = '# TestAgent\nAgent for testing\n## TTS\nText to speech skill';
    publishFromSoulV2(db, soul, 'owner-1');
    publishFromSoulV2(db, soul, 'owner-1');
    // Should still only have one card in the DB
    const rows = db.prepare('SELECT COUNT(*) as count FROM capability_cards WHERE owner = ?').get('owner-1') as { count: number };
    expect(rows.count).toBe(1);
  });

  it('throws VALIDATION_ERROR when SOUL.md has no H2 sections', () => {
    const soul = '# TestAgent\nNo skills here';
    expect(() => publishFromSoulV2(db, soul, 'owner-1')).toThrow('SOUL.md has no H2 sections');
  });

  it('preserves existing card id on upsert', () => {
    const soul = '# TestAgent\nAgent for testing\n## TTS\nText to speech skill';
    const firstCard = publishFromSoulV2(db, soul, 'owner-1');
    const secondCard = publishFromSoulV2(db, soul, 'owner-1');
    expect(secondCard.id).toBe(firstCard.id);
  });
});
