/**
 * UCAN Resource URI Parser for AgentBnB.
 *
 * AgentBnB uses `agentbnb://` URIs to identify resources in UCAN delegations.
 * This module parses those URIs and provides glob-style matching for
 * capability attenuation.
 *
 * URI format: `agentbnb://<resourceType>/<path>`
 *
 * @example
 * ```ts
 * parseResource('agentbnb://kb/portfolio/TSMC')
 * // → { scheme: 'agentbnb', resourceType: 'kb', path: 'portfolio/TSMC' }
 *
 * matchResource('agentbnb://kb/portfolio/*', 'agentbnb://kb/portfolio/TSMC')
 * // → true
 * ```
 *
 * @module
 */

import { AgentBnBError } from '../types/index.js';

/**
 * Parsed representation of an `agentbnb://` resource URI.
 */
export interface ParsedResource {
  /** Always 'agentbnb'. */
  scheme: 'agentbnb';
  /** Resource type segment (e.g. 'kb', 'skill', 'escrow', 'agent'). */
  resourceType: string;
  /** Path after the resource type, may contain wildcards (* or **). */
  path: string;
}

const SCHEME_PREFIX = 'agentbnb://';

/**
 * Parses an `agentbnb://` URI into its components.
 *
 * @param uri - The resource URI string (e.g. `agentbnb://kb/portfolio/TSMC`).
 * @returns Parsed resource with scheme, resourceType, and path.
 * @throws {AgentBnBError} with code 'INVALID_RESOURCE_URI' if the URI is malformed.
 */
export function parseResource(uri: string): ParsedResource {
  if (!uri.startsWith(SCHEME_PREFIX)) {
    throw new AgentBnBError(
      `Invalid resource URI: must start with "${SCHEME_PREFIX}", got "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  const rest = uri.slice(SCHEME_PREFIX.length);
  if (rest.length === 0) {
    throw new AgentBnBError(
      `Invalid resource URI: missing resource type in "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  const slashIndex = rest.indexOf('/');
  if (slashIndex === -1) {
    // URI like agentbnb://skill (no path)
    return { scheme: 'agentbnb', resourceType: rest, path: '' };
  }

  const resourceType = rest.slice(0, slashIndex);
  const path = rest.slice(slashIndex + 1);

  if (resourceType.length === 0) {
    throw new AgentBnBError(
      `Invalid resource URI: empty resource type in "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  return { scheme: 'agentbnb', resourceType, path };
}

/**
 * Tests whether a pattern URI matches a target URI using glob-style rules.
 *
 * - `*` matches exactly one path segment (no slashes).
 * - `**` matches zero or more path segments (including slashes).
 * - The resource type must match exactly (no wildcards in resource type).
 *
 * @param pattern - The pattern URI, e.g. `agentbnb://kb/portfolio/*`.
 * @param target - The concrete target URI, e.g. `agentbnb://kb/portfolio/TSMC`.
 * @returns true if the target matches the pattern.
 * @throws {AgentBnBError} if either URI is malformed.
 */
export function matchResource(pattern: string, target: string): boolean {
  const p = parseResource(pattern);
  const t = parseResource(target);

  // Resource type must match exactly
  if (p.resourceType !== t.resourceType) {
    return false;
  }

  return matchPath(p.path, t.path);
}

/**
 * Glob-style path matching.
 * `*` matches one segment, `**` matches zero or more segments.
 */
function matchPath(pattern: string, target: string): boolean {
  // Split into segments, filtering empty strings from leading/trailing slashes
  const patternSegs = pattern === '' ? [] : pattern.split('/');
  const targetSegs = target === '' ? [] : target.split('/');

  return matchSegments(patternSegs, 0, targetSegs, 0);
}

/**
 * Recursive segment matcher with backtracking for `**`.
 */
function matchSegments(
  pattern: string[],
  pi: number,
  target: string[],
  ti: number,
): boolean {
  // Both exhausted — match
  if (pi === pattern.length && ti === target.length) {
    return true;
  }

  // Pattern exhausted but target has more segments — no match
  if (pi === pattern.length) {
    return false;
  }

  const seg = pattern[pi];

  // ** (globstar) — match zero or more segments
  if (seg === '**') {
    // ** at end of pattern matches everything remaining
    if (pi === pattern.length - 1) {
      return true;
    }
    // Try matching ** against 0, 1, 2, ... remaining target segments
    for (let skip = ti; skip <= target.length; skip++) {
      if (matchSegments(pattern, pi + 1, target, skip)) {
        return true;
      }
    }
    return false;
  }

  // Target exhausted but pattern has non-** segments — no match
  if (ti === target.length) {
    return false;
  }

  // * (single wildcard) — match exactly one segment
  if (seg === '*') {
    return matchSegments(pattern, pi + 1, target, ti + 1);
  }

  // Literal segment — must match exactly
  if (seg === target[ti]) {
    return matchSegments(pattern, pi + 1, target, ti + 1);
  }

  return false;
}
