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

  // --- capability_types / requires_capabilities / visibility metadata ---

  it('parses capability_types from skill section bullet', () => {
    const content =
      '# Agent\nDesc\n## Deep Stock Analyst\nAnalyzes stocks.\n- capability_types: financial_analysis, data_retrieval';
    const result = parseSoulMdV2(content);
    const skill = result.skills[0]!;
    expect(skill.capability_types).toEqual(['financial_analysis', 'data_retrieval']);
  });

  it('strips capability_types bullet from description prose', () => {
    const content =
      '# Agent\nDesc\n## Deep Stock Analyst\nAnalyzes stocks.\n- capability_types: financial_analysis';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.description).toBe('Analyzes stocks.');
    expect(result.skills[0]!.description).not.toContain('capability_types');
  });

  it('parses requires bullet as requires_capabilities', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.\n- requires: web_search';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.requires_capabilities).toEqual(['web_search']);
  });

  it('parses requires_capabilities bullet', () => {
    const content =
      '# Agent\nDesc\n## Analyst\nDoes analysis.\n- requires_capabilities: web_search, data_fetch';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.requires_capabilities).toEqual(['web_search', 'data_fetch']);
  });

  it('parses visibility: public', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.\n- visibility: public';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.visibility).toBe('public');
  });

  it('parses visibility: private', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.\n- visibility: private';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.visibility).toBe('private');
  });

  it('parses all three metadata bullets together', () => {
    const content = [
      '# Agent',
      'Desc',
      '## Deep Stock Analyst',
      'Analyzes stocks using technical and fundamental data.',
      '- capability_types: financial_analysis, data_retrieval',
      '- requires: web_search',
      '- visibility: public',
    ].join('\n');
    const result = parseSoulMdV2(content);
    const skill = result.skills[0]!;
    expect(skill.capability_types).toEqual(['financial_analysis', 'data_retrieval']);
    expect(skill.requires_capabilities).toEqual(['web_search']);
    expect(skill.visibility).toBe('public');
    expect(skill.description).toBe('Analyzes stocks using technical and fundamental data.');
  });

  it('leaves fields undefined when metadata bullets absent', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.';
    const result = parseSoulMdV2(content);
    const skill = result.skills[0]!;
    expect(skill.capability_types).toBeUndefined();
    expect(skill.requires_capabilities).toBeUndefined();
    expect(skill.visibility).toBeUndefined();
  });

  it('does not treat metadata bullets in card-level preamble as skill metadata', () => {
    // preamble should not affect skill metadata fields
    const content =
      '# Agent\n- capability_types: ignored\nDesc\n## Analyst\nDoes analysis.';
    const result = parseSoulMdV2(content);
    // The preamble line becomes the card description, skill has no metadata
    expect(result.skills[0]!.capability_types).toBeUndefined();
  });

  it('keeps non-metadata bullet lines in the description', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.\n- supports Python 3';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.description).toContain('supports Python 3');
  });

  it('ignores unrecognised visibility value and leaves field undefined', () => {
    const content = '# Agent\nDesc\n## Analyst\nDoes analysis.\n- visibility: restricted';
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.visibility).toBeUndefined();
    // The unrecognised bullet should still be stripped from prose
    // (it matched the key pattern but we do not set the field)
    expect(result.skills[0]!.description).not.toContain('visibility');
  });

  it('supports metadata per-skill in multi-skill SOUL.md', () => {
    const content = [
      '# Agent',
      'Desc',
      '## TTS',
      'Text to speech.',
      '- capability_types: audio_gen',
      '- visibility: public',
      '## OCR',
      'Optical char recognition.',
      '- capability_types: vision',
      '- visibility: private',
    ].join('\n');
    const result = parseSoulMdV2(content);
    expect(result.skills[0]!.capability_types).toEqual(['audio_gen']);
    expect(result.skills[0]!.visibility).toBe('public');
    expect(result.skills[0]!.description).toBe('Text to speech.');
    expect(result.skills[1]!.capability_types).toEqual(['vision']);
    expect(result.skills[1]!.visibility).toBe('private');
    expect(result.skills[1]!.description).toBe('Optical char recognition.');
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
