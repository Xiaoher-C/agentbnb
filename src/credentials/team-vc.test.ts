import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildTeamCredential } from './team-vc.js';

describe('team-vc', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';
  const agentDid = 'did:agentbnb:agent-team-001';

  function makeTeamVc() {
    return buildTeamCredential({
      agentDid,
      teamId: 'team-alpha-42',
      role: 'analyst',
      taskDescription: 'Market research for Q2 product launch',
      teamSize: 4,
      completedAt: '2026-03-25T14:30:00.000Z',
      signerKey: keys.privateKey,
      issuerDid,
    });
  }

  it('builds a valid team credential with correct types', () => {
    const vc = makeTeamVc();
    expect(vc.type).toEqual(['VerifiableCredential', 'AgentTeamCredential']);
    expect(vc.issuer).toBe(issuerDid);
  });

  it('includes team subject fields', () => {
    const vc = makeTeamVc();
    const subject = vc.credentialSubject;
    expect(subject.id).toBe(agentDid);
    expect(subject['teamId']).toBe('team-alpha-42');
    expect(subject['role']).toBe('analyst');
    expect(subject['taskDescription']).toBe('Market research for Q2 product launch');
    expect(subject['teamSize']).toBe(4);
    expect(subject['completedAt']).toBe('2026-03-25T14:30:00.000Z');
  });

  it('has valid proof structure', () => {
    const vc = makeTeamVc();
    expect(vc.proof.type).toBe('Ed25519Signature2020');
    expect(vc.proof.proofPurpose).toBe('assertionMethod');
    expect(vc.proof.verificationMethod).toBe(`${issuerDid}#key-1`);
    expect(vc.proof.proofValue).toBeTruthy();
  });

  it('is cryptographically verifiable', () => {
    const vc = makeTeamVc();
    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });

  it('fails verification when tampered', () => {
    const vc = makeTeamVc();
    vc.credentialSubject['role'] = 'orchestrator';
    expect(verifyCredential(vc, keys.publicKey)).toBe(false);
  });
});
