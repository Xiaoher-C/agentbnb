import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';
import { VC_CONTEXT } from './vc.js';
import type { VerifiableCredential } from './vc.js';

/**
 * A W3C-aligned Verifiable Presentation with Ed25519 proof.
 * Allows agents to selectively present credentials to external platforms.
 */
export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  holder: string;
  verifiableCredential: VerifiableCredential[];
  proof: {
    type: 'Ed25519Signature2020';
    created: string;
    verificationMethod: string;
    proofPurpose: 'authentication';
    challenge?: string;
    proofValue: string;
  };
}

/**
 * Build a VP object without the proof field, suitable for signing.
 */
function buildUnsignedVp(opts: {
  holderDid: string;
  credentials: VerifiableCredential[];
  challenge?: string;
}): Record<string, unknown> {
  const vp: Record<string, unknown> = {
    '@context': VC_CONTEXT,
    type: ['VerifiablePresentation'],
    holder: opts.holderDid,
    verifiableCredential: opts.credentials,
  };
  if (opts.challenge !== undefined) {
    vp['challenge'] = opts.challenge;
  }
  return vp;
}

/**
 * Create a Verifiable Presentation wrapping one or more VCs.
 * The holder signs the presentation to prove they control the DID.
 *
 * @param opts.holderDid - DID of the presenting agent.
 * @param opts.credentials - Array of VCs to include.
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.challenge - Optional verifier-provided challenge for replay protection.
 * @returns A signed VerifiablePresentation.
 */
export function createPresentation(opts: {
  holderDid: string;
  credentials: VerifiableCredential[];
  signerKey: Buffer;
  challenge?: string;
}): VerifiablePresentation {
  const now = new Date().toISOString();

  const unsigned = buildUnsignedVp({
    holderDid: opts.holderDid,
    credentials: opts.credentials,
    challenge: opts.challenge,
  });

  const proofValue = signEscrowReceipt(unsigned, opts.signerKey);

  return {
    ...unsigned,
    proof: {
      type: 'Ed25519Signature2020',
      created: now,
      verificationMethod: `${opts.holderDid}#key-1`,
      proofPurpose: 'authentication',
      ...(opts.challenge !== undefined ? { challenge: opts.challenge } : {}),
      proofValue,
    },
  } as VerifiablePresentation;
}

/**
 * Verify a Verifiable Presentation's holder signature.
 * Does NOT verify the embedded VCs -- caller should verify those separately.
 *
 * @param vp - The Verifiable Presentation to verify.
 * @param holderPublicKey - DER-encoded Ed25519 public key of the holder.
 * @returns true if the holder's signature is valid, false otherwise.
 */
export function verifyPresentation(
  vp: VerifiablePresentation,
  holderPublicKey: Buffer,
): boolean {
  const unsigned = buildUnsignedVp({
    holderDid: vp.holder,
    credentials: vp.verifiableCredential,
    challenge: vp.proof.challenge,
  });

  return verifyEscrowReceipt(unsigned, vp.proof.proofValue, holderPublicKey);
}

/**
 * Create a selective disclosure presentation -- only include specified credential types.
 * Filters the input credentials array by type before creating the VP.
 *
 * @param opts.holderDid - DID of the presenting agent.
 * @param opts.credentials - Full set of VCs the agent holds.
 * @param opts.disclosedTypes - Type strings to include, e.g. ['AgentReputationCredential'].
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.challenge - Optional verifier-provided challenge for replay protection.
 * @returns A signed VerifiablePresentation containing only matching VCs.
 */
export function createSelectivePresentation(opts: {
  holderDid: string;
  credentials: VerifiableCredential[];
  disclosedTypes: string[];
  signerKey: Buffer;
  challenge?: string;
}): VerifiablePresentation {
  const filtered = opts.credentials.filter((vc) =>
    vc.type.some((t) => opts.disclosedTypes.includes(t)),
  );

  return createPresentation({
    holderDid: opts.holderDid,
    credentials: filtered,
    signerKey: opts.signerKey,
    challenge: opts.challenge,
  });
}
