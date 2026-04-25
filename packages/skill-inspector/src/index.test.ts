import { describe, expect, it } from 'vitest';
import { SKILL_INSPECTOR_VERSION } from './index.js';

describe('skill-inspector package', () => {
  it('exposes a version string', () => {
    expect(SKILL_INSPECTOR_VERSION).toBe('0.1.1');
  });
});
