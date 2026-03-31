import { describe, it, expect } from 'vitest';
import { parseResource, matchResource } from './ucan-resources.js';
import type { ParsedResource } from './ucan-resources.js';

describe('parseResource', () => {
  it('parses a kb resource', () => {
    const result = parseResource('agentbnb://kb/portfolio/TSMC');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: 'portfolio/TSMC',
    });
  });

  it('parses a skill resource', () => {
    const result = parseResource('agentbnb://skill/web-crawl-cf');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'skill',
      path: 'web-crawl-cf',
    });
  });

  it('parses an escrow resource', () => {
    const result = parseResource('agentbnb://escrow/esc_abc123');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'escrow',
      path: 'esc_abc123',
    });
  });

  it('parses a resource with wildcard', () => {
    const result = parseResource('agentbnb://kb/portfolio/*');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: 'portfolio/*',
    });
  });

  it('parses a resource with globstar', () => {
    const result = parseResource('agentbnb://kb/**');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'kb',
      path: '**',
    });
  });

  it('parses resource type with no path', () => {
    const result = parseResource('agentbnb://agent');
    expect(result).toEqual<ParsedResource>({
      scheme: 'agentbnb',
      resourceType: 'agent',
      path: '',
    });
  });

  it('throws on missing scheme', () => {
    expect(() => parseResource('http://kb/test')).toThrow('must start with "agentbnb://"');
  });

  it('throws on empty URI after scheme', () => {
    expect(() => parseResource('agentbnb://')).toThrow('missing resource type');
  });

  it('throws on completely wrong URI', () => {
    expect(() => parseResource('foobar')).toThrow('must start with "agentbnb://"');
  });
});

describe('matchResource', () => {
  describe('exact matches', () => {
    it('matches identical URIs', () => {
      expect(
        matchResource('agentbnb://kb/portfolio/TSMC', 'agentbnb://kb/portfolio/TSMC'),
      ).toBe(true);
    });

    it('does not match different paths', () => {
      expect(
        matchResource('agentbnb://kb/portfolio/TSMC', 'agentbnb://kb/portfolio/NVDA'),
      ).toBe(false);
    });
  });

  describe('single wildcard (*)', () => {
    it('matches one segment', () => {
      expect(
        matchResource('agentbnb://kb/portfolio/*', 'agentbnb://kb/portfolio/TSMC'),
      ).toBe(true);
    });

    it('does NOT match deeper paths (single-layer only)', () => {
      expect(
        matchResource('agentbnb://kb/portfolio/*', 'agentbnb://kb/portfolio/TSMC/Q4'),
      ).toBe(false);
    });

    it('matches skill wildcard', () => {
      expect(
        matchResource('agentbnb://skill/*', 'agentbnb://skill/web-crawl-cf'),
      ).toBe(true);
    });

    it('does not match across resource types', () => {
      expect(
        matchResource('agentbnb://skill/*', 'agentbnb://kb/anything'),
      ).toBe(false);
    });

    it('matches wildcard in middle of path', () => {
      expect(
        matchResource('agentbnb://kb/*/TSMC', 'agentbnb://kb/portfolio/TSMC'),
      ).toBe(true);
    });

    it('does not match empty segment for *', () => {
      expect(
        matchResource('agentbnb://kb/portfolio/*', 'agentbnb://kb/portfolio'),
      ).toBe(false);
    });
  });

  describe('globstar (**)', () => {
    it('matches multiple segments', () => {
      expect(
        matchResource('agentbnb://kb/**', 'agentbnb://kb/portfolio/TSMC/Q4'),
      ).toBe(true);
    });

    it('matches single segment', () => {
      expect(
        matchResource('agentbnb://kb/**', 'agentbnb://kb/portfolio'),
      ).toBe(true);
    });

    it('matches zero segments (just resource type)', () => {
      expect(
        matchResource('agentbnb://kb/**', 'agentbnb://kb'),
      ).toBe(true);
    });

    it('matches deeply nested paths', () => {
      expect(
        matchResource('agentbnb://kb/**', 'agentbnb://kb/a/b/c/d/e'),
      ).toBe(true);
    });

    it('does not match different resource types', () => {
      expect(
        matchResource('agentbnb://kb/**', 'agentbnb://skill/something'),
      ).toBe(false);
    });

    it('matches globstar followed by literal', () => {
      expect(
        matchResource('agentbnb://kb/**/Q4', 'agentbnb://kb/portfolio/TSMC/Q4'),
      ).toBe(true);
    });

    it('matches globstar followed by literal at one level', () => {
      expect(
        matchResource('agentbnb://kb/**/Q4', 'agentbnb://kb/Q4'),
      ).toBe(true);
    });
  });

  describe('no path matching', () => {
    it('matches when both have no path', () => {
      expect(
        matchResource('agentbnb://agent', 'agentbnb://agent'),
      ).toBe(true);
    });

    it('does not match when pattern has no path but target does', () => {
      expect(
        matchResource('agentbnb://agent', 'agentbnb://agent/foo'),
      ).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('escrow exact match', () => {
      expect(
        matchResource('agentbnb://escrow/esc_abc123', 'agentbnb://escrow/esc_abc123'),
      ).toBe(true);
    });

    it('escrow wildcard', () => {
      expect(
        matchResource('agentbnb://escrow/*', 'agentbnb://escrow/esc_abc123'),
      ).toBe(true);
    });
  });
});
