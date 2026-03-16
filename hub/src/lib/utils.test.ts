import { describe, it, expect } from 'vitest';
import { getLevelBadge, getStatusIndicator, formatCredits } from './utils.js';

describe('getLevelBadge', () => {
  it('level 1 returns Atomic with dot style', () => {
    const badge = getLevelBadge(1);
    expect(badge.level).toBe(1);
    expect(badge.label).toBe('Atomic');
    expect(badge.style).toMatch(/dot/i);
  });

  it('level 2 returns Pipeline with connected style', () => {
    const badge = getLevelBadge(2);
    expect(badge.level).toBe(2);
    expect(badge.label).toBe('Pipeline');
    expect(badge.style).toMatch(/connected/i);
  });

  it('level 3 returns Environment with block style', () => {
    const badge = getLevelBadge(3);
    expect(badge.level).toBe(3);
    expect(badge.label).toBe('Environment');
    expect(badge.style).toMatch(/block/i);
  });
});

describe('getStatusIndicator', () => {
  it('true returns accent (online)', () => {
    expect(getStatusIndicator(true)).toBe('accent');
  });

  it('false returns dim (offline)', () => {
    expect(getStatusIndicator(false)).toBe('dim');
  });
});

describe('formatCredits', () => {
  it('credits_per_call only returns "cr 5"', () => {
    expect(formatCredits({ credits_per_call: 5 })).toBe('cr 5');
  });

  it('both fields returns range "cr 5-120/min"', () => {
    expect(formatCredits({ credits_per_call: 5, credits_per_minute: 120 })).toBe('cr 5-120/min');
  });

  it('zero credits per call returns "cr 0"', () => {
    expect(formatCredits({ credits_per_call: 0 })).toBe('cr 0');
  });
});
