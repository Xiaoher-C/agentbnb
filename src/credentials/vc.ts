import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';

/**
 * W3C Verifiable Credential with Ed25519 proof.
 */
export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: Record<string, unknown>;
  proof: {
    type: 'Ed25519Signature2020';
    created: string;
    verificationMethod: string;
    proofPurpose: 'assertionMethod';
    proofValue: string;
  };
}

const VC_CONTEXTS = [
  'https://www.w3.org/2018/credentials/v1',
  'https://agentbnb.dev/credentials/v1',
] as const;

/**
 * Extracts the credential payload (everything except `proof`) for signing.
 */
function credentialPayload(vc: VerifiableCredential): Record<string, unknown> {
  const { proof: _proof, ...rest } = vc;
  return rest as Record<string, unknown>;
}

/**
 * Issues a signed Verifiable Credential.
 *
 * @param opts.subject - The credentialSubject fields.
 * @param opts.types - Additional VC types (e.g., ['AgentReputationCredential']).
 * @param opts.issuerDid - DID of the issuer (e.g., 'did:agentbnb:platform').
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.expirationDate - Optional ISO 8601 expiration date.
 * @returns A fully signed VerifiableCredential.
 */
export function issueCredential(opts: {
  subject: Record<string, unknown>;
  types: string[];
  issuerDid: string;
  signerKey: Buffer;
  expirationDate?: string;
}): VerifiableCredential {
  const now = new Date().toISOString();

  const vc: VerifiableCredential = {
    '@context': [...VC_CONTEXTS],
    type: ['VerifiableCredential', ...opts.types],
    issuer: opts.issuerDid,
    issuanceDate: now,
    ...(opts.expirationDate ? { expirationDate: opts.expirationDate } : {}),
    credentialSubject: opts.subject,
    proof: {
      type: 'Ed25519Signature2020',
      created: now,
      verificationMethod: `${opts.issuerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: '', // placeholder — filled below
    },
  };

  const payload = credentialPayload(vc);
  vc.proof.proofValue = signEscrowReceipt(payload, opts.signerKey);

  return vc;
}

/**
 * Verifies a VerifiableCredential's Ed25519 proof.
 *
 * @param vc - The credential to verify.
 * @param issuerPublicKey - DER-encoded Ed25519 public key of the issuer.
 * @returns true if the proof is valid, false otherwise.
 */
export function verifyCredential(
  vc: VerifiableCredential,
  issuerPublicKey: Buffer,
): boolean {
  const payload = credentialPayload(vc);
  return verifyEscrowReceipt(payload, vc.proof.proofValue, issuerPublicKey);
}

/**
 * Decodes a JSON string into a VerifiableCredential without verifying the proof.
 *
 * @param vcJson - JSON-encoded VerifiableCredential string.
 * @returns The parsed VerifiableCredential.
 */
export function decodeCredential(vcJson: string): VerifiableCredential {
  return JSON.parse(vcJson) as VerifiableCredential;
}
