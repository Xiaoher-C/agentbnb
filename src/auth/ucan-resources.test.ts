import { describe, it, expect } from 'vitest';
import { parseResource, matchResource, isAttenuation } from './ucan-resources.js';

describe('parseResource', () => {
  it('parses a full URI', () => {
    const parsed = parseResource('agentbnb://kb/portfolio/TSMC');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: 'portfolio/TSMC',
    });
  });

  it('parses a URI with wildcard', () => {
    const parsed = parseResource('agentbnb://kb/portfolio/*');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: 'portfolio/*',
    });
  });

  it('parses a URI with double wildcard', () => {
    const parsed = parseResource('agentbnb://kb/**');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: '**',
    });
  });

  it('parses a skill URI', () => {
    const parsed = parseResource('agentbnb://skill/web-crawl-cf');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'skill',
      path: 'web-crawl-cf',
    });
  });

  it('parses an escrow URI', () => {
    const parsed = parseResource('agentbnb://escrow/esc_abc123');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'escrow',
      path: 'esc_abc123',
    });
  });

  it('parses resourceType-only URI (no path)', () => {
    const parsed = parseResource('agentbnb://agent');
    expect(parsed).toEqual({
      scheme: 'agentbnb',
      resourceType: 'agent',
      path: '',
    });
  });

  it('throws on wrong scheme', () => {
    expect(() => parseResource('https://kb/test')).toThrow('Invalid resource URI');
  });

  it('throws on empty body', () => {
    expect(() => parseResource('agentbnb://')).toThrow('Invalid resource URI');
  });

  it('throws on empty resource type (leading slash)', () => {
    expect(() => parseResource('agentbnb:///something')).toThrow('Invalid resource URI');
  });

  it('throws on completely invalid string', () => {
    expect(() => parseResource('not-a-uri')).toThrow('Invalid resource URI');
  });
});

describe('matchResource', () => {
  describe('exact matches', () => {
    it('matches identical URIs', () => {
      expect(matchResource(
        'agentbnb://kb/portfolio/TSMC',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(true);
    });

    it('does not match different paths', () => {
      expect(matchResource(
        'agentbnb://kb/portfolio/TSMC',
        'agentbnb://kb/portfolio/AAPL',
      )).toBe(false);
    });

    it('does not match different resource types', () => {
      expect(matchResource(
        'agentbnb://skill/web-crawl',
        'agentbnb://kb/web-crawl',
      )).toBe(false);
    });
  });

  describe('single wildcard (*)', () => {
    it('matches a single segment', () => {
      expect(matchResource(
        'agentbnb://kb/portfolio/*',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(true);
    });

    it('does NOT match multiple segments', () => {
      expect(matchResource(
        'agentbnb://kb/portfolio/*',
        'agentbnb://kb/portfolio/TSMC/Q4',
      )).toBe(false);
    });

    it('matches all skills with *', () => {
      expect(matchResource(
        'agentbnb://skill/*',
        'agentbnb://skill/web-crawl-cf',
      )).toBe(true);
    });

    it('does not match across resource types', () => {
      expect(matchResource(
        'agentbnb://skill/*',
        'agentbnb://kb/anything',
      )).toBe(false);
    });

    it('matches wildcard in middle of path', () => {
      expect(matchResource(
        'agentbnb://kb/*/TSMC',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(true);
    });

    it('does not match empty segment for *', () => {
      expect(matchResource(
        'agentbnb://kb/portfolio/*',
        'agentbnb://kb/portfolio',
      )).toBe(false);
    });
  });

  describe('double wildcard (**)', () => {
    it('matches deeply nested paths', () => {
      expect(matchResource(
        'agentbnb://kb/**',
        'agentbnb://kb/portfolio/TSMC/Q4',
      )).toBe(true);
    });

    it('matches a single segment', () => {
      expect(matchResource(
        'agentbnb://kb/**',
        'agentbnb://kb/portfolio',
      )).toBe(true);
    });

    it('matches zero segments (type-only)', () => {
      expect(matchResource(
        'agentbnb://kb/**',
        'agentbnb://kb',
      )).toBe(true);
    });

    it('does not match different resource type', () => {
      expect(matchResource(
        'agentbnb://kb/**',
        'agentbnb://skill/web-crawl',
      )).toBe(false);
    });

    it('handles ** in middle of pattern', () => {
      expect(matchResource(
        'agentbnb://kb/**/report',
        'agentbnb://kb/portfolio/TSMC/report',
      )).toBe(true);
    });

    it('handles ** matching zero segments in middle', () => {
      expect(matchResource(
        'agentbnb://kb/**/report',
        'agentbnb://kb/report',
      )).toBe(true);
    });
  });

  describe('no-path URIs', () => {
    it('matches type-only against type-only', () => {
      expect(matchResource(
        'agentbnb://agent',
        'agentbnb://agent',
      )).toBe(true);
    });

    it('does not match type-only against type-with-path', () => {
      expect(matchResource(
        'agentbnb://agent',
        'agentbnb://agent/abc',
      )).toBe(false);
    });
  });
});

describe('isAttenuation', () => {
  describe('valid attenuations (narrowing)', () => {
    it('** narrows to single wildcard', () => {
      expect(isAttenuation(
        'agentbnb://kb/**',
        'agentbnb://kb/portfolio/*',
      )).toBe(true);
    });

    it('** narrows to exact path', () => {
      expect(isAttenuation(
        'agentbnb://kb/**',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(true);
    });

    it('* narrows to exact match', () => {
      expect(isAttenuation(
        'agentbnb://skill/*',
        'agentbnb://skill/web-crawl',
      )).toBe(true);
    });

    it('identical URIs are valid attenuation', () => {
      expect(isAttenuation(
        'agentbnb://kb/portfolio/TSMC',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(true);
    });

    it('** narrows to deeper prefix with *', () => {
      expect(isAttenuation(
        'agentbnb://kb/**',
        'agentbnb://kb/portfolio/TSMC/*',
      )).toBe(true);
    });
  });

  describe('invalid attenuations (widening)', () => {
    it('single wildcard cannot widen to **', () => {
      expect(isAttenuation(
        'agentbnb://kb/portfolio/*',
        'agentbnb://kb/**',
      )).toBe(false);
    });

    it('exact path cannot widen to wildcard', () => {
      expect(isAttenuation(
        'agentbnb://kb/portfolio/TSMC',
        'agentbnb://kb/portfolio/*',
      )).toBe(false);
    });

    it('different resource type is never attenuation', () => {
      expect(isAttenuation(
        'agentbnb://skill/*',
        'agentbnb://kb/*',
      )).toBe(false);
    });

    it('narrowed with extra depth beyond original literal', () => {
      expect(isAttenuation(
        'agentbnb://kb/portfolio',
        'agentbnb://kb/portfolio/TSMC',
      )).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('both ** is valid attenuation (equal)', () => {
      expect(isAttenuation(
        'agentbnb://kb/**',
        'agentbnb://kb/**',
      )).toBe(true);
    });

    it('both * is valid attenuation (equal)', () => {
      expect(isAttenuation(
        'agentbnb://skill/*',
        'agentbnb://skill/*',
      )).toBe(true);
    });

    it('type-only to type-only is valid', () => {
      expect(isAttenuation(
        'agentbnb://agent',
        'agentbnb://agent',
      )).toBe(true);
    });
  });
});
