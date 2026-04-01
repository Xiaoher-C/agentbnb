import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';

/**
 * W3C Verifiable Credentials context URLs.
 */
const VC_CONTEXT = [
  'https://www.w3.org/2018/credentials/v1',
  'https://agentbnb.dev/credentials/v1',
];

/**
 * A W3C-aligned Verifiable Credential with Ed25519 proof.
 */
export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: Record<string, unknown> & { id: string };
  proof: {
    type: 'Ed25519Signature2020';
    created: string;
    verificationMethod: string;
    proofPurpose: 'assertionMethod';
    proofValue: string;
  };
}

/**
 * Builds a VC object without the proof field, suitable for signing.
 */
function buildUnsignedVc(opts: {
  subject: Record<string, unknown> & { id: string };
  types: string[];
  issuerDid: string;
  issuanceDate: string;
  expirationDate?: string;
}): Record<string, unknown> {
  const vc: Record<string, unknown> = {
    '@context': VC_CONTEXT,
    type: opts.types,
    issuer: opts.issuerDid,
    issuanceDate: opts.issuanceDate,
    credentialSubject: opts.subject,
  };
  if (opts.expirationDate) {
    vc['expirationDate'] = opts.expirationDate;
  }
  return vc;
}

/**
 * Issue a Verifiable Credential signed with Ed25519.
 * Signs the canonical JSON of the credential WITHOUT the proof field.
 *
 * @param opts.subject - The credential subject (must include `id`).
 * @param opts.types - VC type array, e.g. ['VerifiableCredential', 'AgentReputationCredential'].
 * @param opts.issuerDid - DID of the issuer, e.g. "did:agentbnb:platform".
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.expirationDate - Optional ISO 8601 expiration date.
 * @returns A signed VerifiableCredential.
 */
export function issueCredential(opts: {
  subject: Record<string, unknown> & { id: string };
  types: string[];
  issuerDid: string;
  signerKey: Buffer;
  expirationDate?: string;
}): VerifiableCredential {
  const now = new Date().toISOString();

  const unsigned = buildUnsignedVc({
    subject: opts.subject,
    types: opts.types,
    issuerDid: opts.issuerDid,
    issuanceDate: now,
    expirationDate: opts.expirationDate,
  });

  const proofValue = signEscrowReceipt(unsigned, opts.signerKey);

  return {
    ...unsigned,
    proof: {
      type: 'Ed25519Signature2020',
      created: now,
      verificationMethod: `${opts.issuerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue,
    },
  } as VerifiableCredential;
}

/**
 * Verify a Verifiable Credential's Ed25519 signature.
 * Reconstructs the signing payload (VC without proof), then verifies.
 *
 * @param vc - The Verifiable Credential to verify.
 * @param issuerPublicKey - DER-encoded Ed25519 public key.
 * @returns true if signature is valid, false otherwise.
 */
export function verifyCredential(
  vc: VerifiableCredential,
  issuerPublicKey: Buffer,
): boolean {
  const unsigned = buildUnsignedVc({
    subject: vc.credentialSubject,
    types: vc.type,
    issuerDid: vc.issuer,
    issuanceDate: vc.issuanceDate,
    expirationDate: vc.expirationDate,
  });

  return verifyEscrowReceipt(unsigned, vc.proof.proofValue, issuerPublicKey);
}
