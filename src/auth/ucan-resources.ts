/**
 * UCAN Resource URI parser and matcher for AgentBnB.
 *
 * Implements the `agentbnb://` URI scheme used to scope UCAN
 * delegation tokens to specific resources (knowledge bases, skills,
 * escrows, agents).
 *
 * URI format: `agentbnb://<resourceType>/<path>`
 *
 * Wildcard rules:
 * - `*`  matches exactly one path segment
 * - `**` matches zero or more path segments
 */

import { AgentBnBError } from '../types/index.js';

const SCHEME = 'agentbnb';
const URI_PREFIX = `${SCHEME}://`;

/**
 * Parsed representation of an `agentbnb://` resource URI.
 */
export interface ParsedResource {
  scheme: 'agentbnb';
  /** Resource type: kb, skill, escrow, agent, etc. */
  resourceType: string;
  /** Full path after the resource type (may contain wildcards). */
  path: string;
}

/**
 * Parse an `agentbnb://` URI into its components.
 *
 * @param uri - The URI string to parse.
 * @returns Parsed resource object.
 * @throws {AgentBnBError} with code 'INVALID_RESOURCE_URI' if the URI
 *         is malformed or missing required parts.
 */
export function parseResource(uri: string): ParsedResource {
  if (!uri.startsWith(URI_PREFIX)) {
    throw new AgentBnBError(
      `Invalid resource URI: must start with "${URI_PREFIX}", got "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  const body = uri.slice(URI_PREFIX.length);
  if (body.length === 0) {
    throw new AgentBnBError(
      `Invalid resource URI: missing resource type in "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  const slashIdx = body.indexOf('/');
  if (slashIdx === -1) {
    // URI like "agentbnb://skill" with no path -- resourceType only
    return { scheme: SCHEME, resourceType: body, path: '' };
  }

  const resourceType = body.slice(0, slashIdx);
  if (resourceType.length === 0) {
    throw new AgentBnBError(
      `Invalid resource URI: empty resource type in "${uri}"`,
      'INVALID_RESOURCE_URI',
    );
  }

  const path = body.slice(slashIdx + 1);

  return { scheme: SCHEME, resourceType, path };
}

/**
 * Split a path string into non-empty segments.
 */
function splitPath(path: string): string[] {
  if (path === '') return [];
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * Check if a target URI matches a pattern URI.
 *
 * Supports glob-style wildcards:
 * - `*`  matches a single path segment
 * - `**` matches zero or more path segments
 *
 * @param pattern - The pattern URI (may contain wildcards).
 * @param target  - The concrete URI to test.
 * @returns true if `target` matches `pattern`.
 */
export function matchResource(pattern: string, target: string): boolean {
  const pat = parseResource(pattern);
  const tgt = parseResource(target);

  // Resource types must match exactly
  if (pat.resourceType !== tgt.resourceType) {
    return false;
  }

  const patSegs = splitPath(pat.path);
  const tgtSegs = splitPath(tgt.path);

  return matchSegments(patSegs, 0, tgtSegs, 0);
}

/**
 * Recursive segment matcher with `*` and `**` support.
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

  // Pattern exhausted but target remains — no match
  if (pi === pattern.length) {
    return false;
  }

  const seg = pattern[pi]!;

  if (seg === '**') {
    // ** can match zero segments (advance pattern only)
    // or one-or-more segments (advance target, keep pattern)
    // Also handle consecutive ** by advancing pattern
    if (matchSegments(pattern, pi + 1, target, ti)) {
      return true;
    }
    if (ti < target.length) {
      return matchSegments(pattern, pi, target, ti + 1);
    }
    return false;
  }

  // Target exhausted but pattern still has non-** segments
  if (ti === target.length) {
    return false;
  }

  if (seg === '*') {
    // * matches exactly one segment
    return matchSegments(pattern, pi + 1, target, ti + 1);
  }

  // Literal match
  if (seg === target[ti]) {
    return matchSegments(pattern, pi + 1, target, ti + 1);
  }

  return false;
}

/**
 * Check if a narrowed scope is a valid attenuation of the original.
 *
 * A narrowed scope is an attenuation if the original pattern matches
 * every URI that the narrowed pattern would match.  In other words,
 * the narrowed pattern must be equal to or a subset of the original.
 *
 * @param original - The broader scope URI (may contain wildcards).
 * @param narrowed - The candidate narrower scope URI.
 * @returns true if `narrowed` is a valid attenuation (subset) of `original`.
 */
export function isAttenuation(original: string, narrowed: string): boolean {
  const orig = parseResource(original);
  const narr = parseResource(narrowed);

  // Resource types must match
  if (orig.resourceType !== narr.resourceType) {
    return false;
  }

  const origSegs = splitPath(orig.path);
  const narrSegs = splitPath(narr.path);

  // The original must be able to match everything the narrowed can.
  // We check: can the original pattern match the narrowed pattern
  // when treating the narrowed pattern's wildcards as literals to match against?
  //
  // More precisely: for every concrete URI C that `narrowed` matches,
  // `original` must also match C.
  //
  // A sufficient structural check:
  // Walk both patterns.  The original must be at least as permissive
  // at every position.
  return isSubPattern(origSegs, 0, narrSegs, 0);
}

/**
 * Check if `narrow` is a sub-pattern of `broad`.
 *
 * Returns true when every string matched by `narrow` is also matched
 * by `broad`.
 */
function isSubPattern(
  broad: string[],
  bi: number,
  narrow: string[],
  ni: number,
): boolean {
  // Both exhausted — the patterns align exactly
  if (bi === broad.length && ni === narrow.length) {
    return true;
  }

  // Broad has ** — it can cover any remaining narrow segments
  if (bi < broad.length && broad[bi] === '**') {
    // ** in broad can absorb zero or more narrow segments
    // Try absorbing zero (advance broad)
    if (isSubPattern(broad, bi + 1, narrow, ni)) {
      return true;
    }
    // Try absorbing one narrow segment (advance narrow, keep broad at **)
    if (ni < narrow.length) {
      return isSubPattern(broad, bi, narrow, ni + 1);
    }
    return false;
  }

  // Broad exhausted but narrow has more — not a sub-pattern
  if (bi === broad.length) {
    return false;
  }

  // Narrow exhausted but broad still has non-** segments — not a sub-pattern
  // (narrow is more specific / matches fewer things, which is fine,
  //  BUT the broad literal requires a segment that narrow doesn't produce)
  if (ni === narrow.length) {
    return false;
  }

  const bSeg = broad[bi]!;
  const nSeg = narrow[ni]!;

  // broad has * — it matches any single narrow segment (whether literal, * or **)
  if (bSeg === '*') {
    // If narrow has **, narrow is actually broader at this position
    if (nSeg === '**') {
      return false;
    }
    return isSubPattern(broad, bi + 1, narrow, ni + 1);
  }

  // broad is literal
  if (nSeg === '**') {
    // narrow ** is broader than a broad literal — not a sub-pattern
    return false;
  }
  if (nSeg === '*') {
    // narrow * is broader than a broad literal — not a sub-pattern
    return false;
  }

  // Both literals — must be equal
  if (bSeg === nSeg) {
    return isSubPattern(broad, bi + 1, narrow, ni + 1);
  }

  return false;
}
