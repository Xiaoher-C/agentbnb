import { createHash } from 'node:crypto';
import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';

/**
 * An attestation linking an Ed25519 identity to an EVM address.
 * Signed by the Ed25519 key to prove ownership of the AgentBnB identity.
 */
export interface EVMBridgeLink {
  ed25519_public_key: string;
  evm_address: string;
  agent_did: string;
  timestamp: string;
  ed25519_signature: string;
}

/**
 * Build the canonical payload that gets signed for a bridge link.
 */
function buildLinkPayload(opts: {
  ed25519PublicKeyHex: string;
  evmAddress: string;
  agentDid: string;
  timestamp: string;
}): Record<string, unknown> {
  return {
    ed25519_public_key: opts.ed25519PublicKeyHex,
    evm_address: opts.evmAddress,
    agent_did: opts.agentDid,
    timestamp: opts.timestamp,
  };
}

/**
 * Create a bridge link between an Ed25519 identity and an EVM address.
 * The link is signed by the Ed25519 key to prove ownership.
 *
 * Note: This does NOT verify ownership of the EVM address -- that requires
 * an on-chain transaction (ERC-8004). This only creates the AgentBnB-side attestation.
 *
 * @param opts.ed25519PrivateKey - DER-encoded Ed25519 private key.
 * @param opts.ed25519PublicKeyHex - Hex-encoded Ed25519 public key.
 * @param opts.evmAddress - 0x-prefixed Ethereum address (20 bytes).
 * @param opts.agentDid - DID of the agent, e.g. "did:agentbnb:6df74745403944c4".
 * @returns A signed EVMBridgeLink.
 */
export function createBridgeLink(opts: {
  ed25519PrivateKey: Buffer;
  ed25519PublicKeyHex: string;
  evmAddress: string;
  agentDid: string;
}): EVMBridgeLink {
  const timestamp = new Date().toISOString();

  const payload = buildLinkPayload({
    ed25519PublicKeyHex: opts.ed25519PublicKeyHex,
    evmAddress: opts.evmAddress,
    agentDid: opts.agentDid,
    timestamp,
  });

  const signature = signEscrowReceipt(payload, opts.ed25519PrivateKey);

  return {
    ed25519_public_key: opts.ed25519PublicKeyHex,
    evm_address: opts.evmAddress,
    agent_did: opts.agentDid,
    timestamp,
    ed25519_signature: signature,
  };
}

/**
 * Verify an EVM bridge link's Ed25519 signature.
 *
 * @param link - The bridge link to verify.
 * @param ed25519PublicKey - DER-encoded Ed25519 public key.
 * @returns true if the signature is valid, false otherwise.
 */
export function verifyBridgeLink(link: EVMBridgeLink, ed25519PublicKey: Buffer): boolean {
  const payload = buildLinkPayload({
    ed25519PublicKeyHex: link.ed25519_public_key,
    evmAddress: link.evm_address,
    agentDid: link.agent_did,
    timestamp: link.timestamp,
  });

  return verifyEscrowReceipt(payload, link.ed25519_signature, ed25519PublicKey);
}

/**
 * Derive a deterministic "pseudo EVM address" from an Ed25519 public key.
 * Uses SHA-256(ed25519_pubkey)[-20:] as a stand-in for keccak256.
 *
 * This is NOT a real EVM address (no secp256k1 key exists), but useful as a
 * deterministic identifier for credit settlement mapping.
 *
 * NOTE: Node.js crypto doesn't include keccak256 natively. SHA-256 is used
 * as the hash function -- the result is not EVM-compatible but is sufficient
 * for AgentBnB's internal mapping.
 *
 * @param ed25519PublicKeyHex - Hex-encoded Ed25519 public key.
 * @returns 0x-prefixed 20-byte hex address (42 characters total).
 */
export function derivePseudoEVMAddress(ed25519PublicKeyHex: string): string {
  const hash = createHash('sha256')
    .update(Buffer.from(ed25519PublicKeyHex, 'hex'))
    .digest();
  const addressBytes = hash.subarray(hash.length - 20);
  return `0x${addressBytes.toString('hex')}`;
}
