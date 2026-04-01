/**
 * UCAN delegation chain management.
 *
 * Handles creating delegated UCANs with narrowed permissions and
 * validating complete delegation chains (root → ... → leaf).
 *
 * @see docs/adr/020-ucan-token.md
 */

import { createUCAN, decodeUCAN, verifyUCAN } from './ucan.js';
import { isAttenuation } from './ucan-resources.js';
import type { UCANAttenuation } from './ucan.js';
import { AgentBnBError } from '../types/index.js';

/** Maximum allowed delegation chain depth. */
export const MAX_CHAIN_DEPTH = 3;

/**
 * Known UCAN actions ordered by privilege (broadest → narrowest).
 * Used for action-level attenuation checks.
 */
const ACTION_HIERARCHY: Record<string, number> = {
  delegate: 4,
  write: 3,
  settle: 2,
  invoke: 1,
  read: 0,
};

/**
 * Check if a child attenuation is a valid narrowing of a parent attenuation.
 * The child's resource must be an attenuation (subset) of the parent's resource,
 * and the child's action must be equal or narrower.
 */
function isNarrowed(parent: UCANAttenuation, child: UCANAttenuation): boolean {
  // Resource URI must be a valid attenuation
  if (!isAttenuation(parent.with, child.with)) {
    return false;
  }

  // Action must be equal or narrower
  const parentLevel = ACTION_HIERARCHY[parent.can];
  const childLevel = ACTION_HIERARCHY[child.can];

  // If action not in hierarchy, require exact match
  if (parentLevel === undefined || childLevel === undefined) {
    return parent.can === child.can;
  }

  return childLevel <= parentLevel;
}

/**
 * Check if every child attenuation is covered by at least one parent attenuation.
 */
function isAttenuationSubset(
  parentAtts: UCANAttenuation[],
  childAtts: UCANAttenuation[],
): boolean {
  return childAtts.every((child) =>
    parentAtts.some((parent) => isNarrowed(parent, child)),
  );
}

/**
 * Create a delegated UCAN with narrowed permissions.
 * The new UCAN's attenuations must be a subset of the parent's.
 *
 * @param opts - Delegation options.
 * @returns Encoded delegated UCAN token string.
 * @throws {AgentBnBError} with code 'UCAN_DELEGATION_ERROR' if attenuations are not a valid narrowing.
 */
export function delegateUCAN(opts: {
  parentToken: string;
  newAudienceDid: string;
  narrowedAttenuations: UCANAttenuation[];
  signerKey: Buffer;
  expiresAt?: number;
}): string {
  const parent = decodeUCAN(opts.parentToken);

  // Validate attenuation narrowing
  if (!isAttenuationSubset(parent.payload.att, opts.narrowedAttenuations)) {
    throw new AgentBnBError(
      'Delegated UCAN attenuations must be a subset of the parent token',
      'UCAN_DELEGATION_ERROR',
    );
  }

  // Expiry must be ≤ parent's expiry
  const expiry = opts.expiresAt !== undefined
    ? Math.min(opts.expiresAt, parent.payload.exp)
    : parent.payload.exp;

  return createUCAN({
    issuerDid: parent.payload.aud,
    audienceDid: opts.newAudienceDid,
    attenuations: opts.narrowedAttenuations,
    signerKey: opts.signerKey,
    expiresAt: expiry,
    proofs: [opts.parentToken],
  });
}

/**
 * Validate a complete UCAN delegation chain.
 * Checks: signatures, attenuation narrowing, depth limit, expiry inheritance.
 *
 * @param tokens - Ordered chain from root → ... → leaf.
 * @param resolvePublicKey - Function to resolve a DID to its DER-encoded Ed25519 public key.
 * @returns Validation result with valid flag, optional reason, and chain depth.
 */
export function validateChain(
  tokens: string[],
  resolvePublicKey: (did: string) => Buffer | null,
): { valid: boolean; reason?: string; depth: number } {
  if (tokens.length === 0) {
    return { valid: false, reason: 'Empty token chain', depth: 0 };
  }

  const depth = tokens.length - 1;

  if (depth > MAX_CHAIN_DEPTH) {
    return {
      valid: false,
      reason: `Chain depth ${depth} exceeds maximum ${MAX_CHAIN_DEPTH}`,
      depth,
    };
  }

  // Decode all tokens
  const decoded = tokens.map((t) => decodeUCAN(t));

  // Verify each token's signature
  for (let i = 0; i < tokens.length; i++) {
    const payload = decoded[i]!.payload;
    const pubKey = resolvePublicKey(payload.iss);
    if (!pubKey) {
      return {
        valid: false,
        reason: `Cannot resolve public key for issuer: ${payload.iss}`,
        depth,
      };
    }

    const result = verifyUCAN(tokens[i]!, pubKey);
    if (!result.valid) {
      return {
        valid: false,
        reason: `Signature verification failed at position ${i}: ${result.reason}`,
        depth,
      };
    }
  }

  // Validate chain linkage and attenuation narrowing
  for (let i = 1; i < decoded.length; i++) {
    const parent = decoded[i - 1]!;
    const child = decoded[i]!;

    // Audience/issuer chain: parent's aud must equal child's iss
    if (parent.payload.aud !== child.payload.iss) {
      return {
        valid: false,
        reason: `Audience/issuer mismatch at position ${i}: parent aud="${parent.payload.aud}" != child iss="${child.payload.iss}"`,
        depth,
      };
    }

    // Expiry inheritance: child exp must be ≤ parent exp
    if (child.payload.exp > parent.payload.exp) {
      return {
        valid: false,
        reason: `Child expiry (${child.payload.exp}) exceeds parent expiry (${parent.payload.exp}) at position ${i}`,
        depth,
      };
    }

    // Attenuation narrowing: child's att must be a subset of parent's
    if (!isAttenuationSubset(parent.payload.att, child.payload.att)) {
      return {
        valid: false,
        reason: `Attenuation widening detected at position ${i}: child has broader scope than parent`,
        depth,
      };
    }
  }

  return { valid: true, depth };
}
