import { describe, it, expect } from 'vitest';
import { parseSelection } from './interactive.js';
import { INTERACTIVE_TEMPLATES } from './capability-templates.js';

describe('parseSelection', () => {
  it('returns empty array for empty input', () => {
    expect(parseSelection('')).toEqual([]);
    expect(parseSelection('  ')).toEqual([]);
  });

  it('selects a single template by number', () => {
    const result = parseSelection('1');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe(INTERACTIVE_TEMPLATES[0]!.key);
  });

  it('selects multiple templates with comma-separated numbers', () => {
    const result = parseSelection('1,3,5');
    expect(result).toHaveLength(3);
    expect(result[0]!.key).toBe(INTERACTIVE_TEMPLATES[0]!.key);
    expect(result[1]!.key).toBe(INTERACTIVE_TEMPLATES[2]!.key);
    expect(result[2]!.key).toBe(INTERACTIVE_TEMPLATES[4]!.key);
  });

  it('handles spaces around numbers', () => {
    const result = parseSelection(' 1 , 2 ');
    expect(result).toHaveLength(2);
  });

  it('skips invalid numbers gracefully', () => {
    const result = parseSelection('1,abc,99,2');
    expect(result).toHaveLength(2);
    expect(result[0]!.key).toBe(INTERACTIVE_TEMPLATES[0]!.key);
    expect(result[1]!.key).toBe(INTERACTIVE_TEMPLATES[1]!.key);
  });

  it('skips out-of-range numbers', () => {
    const result = parseSelection('0,-1,100');
    expect(result).toEqual([]);
  });

  it('deduplicates when same number entered twice', () => {
    const result = parseSelection('1,1,1');
    expect(result).toHaveLength(1);
  });
});
