import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';

/**
 * A delegation token grants a server permission to act on behalf of an agent.
 * Signed by the agent's Ed25519 private key.
 */
export interface DelegationToken {
  /** Server identifier (e.g., "macmini-001") */
  server_id: string;
  /** Agent being delegated */
  agent_id: string;
  /** ISO 8601 timestamp of token creation */
  granted_at: string;
  /** ISO 8601 timestamp of token expiry */
  expires_at: string;
  /** What the server can do on behalf of the agent */
  permissions: DelegationPermission[];
  /** Base64url Ed25519 signature over the above fields */
  signature: string;
}

/** Permissions a server can be granted over an agent */
export type DelegationPermission = 'serve' | 'publish' | 'settle' | 'request';

/**
 * Creates a signed delegation token.
 *
 * @param agentId - Agent granting delegation.
 * @param serverId - Server receiving delegation.
 * @param privateKey - Agent's DER-encoded Ed25519 private key.
 * @param permissions - Granted permissions.
 * @param durationDays - Token validity in days. Defaults to 30.
 * @returns Signed DelegationToken.
 */
export function createDelegationToken(
  agentId: string,
  serverId: string,
  privateKey: Buffer,
  permissions: DelegationPermission[] = ['serve', 'publish', 'settle'],
  durationDays: number = 30,
): DelegationToken {
  const now = new Date();
  const expires = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const payload: Record<string, unknown> = {
    server_id: serverId,
    agent_id: agentId,
    granted_at: now.toISOString(),
    expires_at: expires.toISOString(),
    permissions,
  };

  const signature = signEscrowReceipt(payload, privateKey);

  return {
    server_id: serverId,
    agent_id: agentId,
    granted_at: now.toISOString(),
    expires_at: expires.toISOString(),
    permissions,
    signature,
  };
}

/**
 * Verifies a delegation token's signature and expiry.
 *
 * @param token - The delegation token to verify.
 * @param publicKey - DER-encoded Ed25519 public key of the agent.
 * @returns Object with `valid` boolean and optional `reason` string.
 */
export function verifyDelegationToken(
  token: DelegationToken,
  publicKey: Buffer,
): { valid: boolean; reason?: string } {
  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    return { valid: false, reason: 'Token expired' };
  }

  // Verify signature
  const payload: Record<string, unknown> = {
    server_id: token.server_id,
    agent_id: token.agent_id,
    granted_at: token.granted_at,
    expires_at: token.expires_at,
    permissions: token.permissions,
  };

  const isValid = verifyEscrowReceipt(payload, token.signature, publicKey);
  if (!isValid) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Checks if a delegation token grants a specific permission.
 *
 * @param token - The delegation token.
 * @param permission - Permission to check.
 * @returns true if the token includes the permission.
 */
export function hasPermission(
  token: DelegationToken,
  permission: DelegationPermission,
): boolean {
  return token.permissions.includes(permission);
}
