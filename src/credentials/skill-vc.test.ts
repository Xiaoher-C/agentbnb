import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildSkillCredential, SkillMilestone } from './skill-vc.js';

describe('skill-vc', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';
  const agentDid = 'did:agentbnb:agent-skill-001';

  function makeSkillVc(milestone: SkillMilestone) {
    return buildSkillCredential({
      agentDid,
      skillId: 'tts-elevenlabs',
      skillName: 'ElevenLabs TTS',
      totalUses: milestone + 50,
      milestone,
      avgRating: 4.7,
      signerKey: keys.privateKey,
      issuerDid,
    });
  }

  it('builds a valid skill credential with correct types', () => {
    const vc = makeSkillVc(100);
    expect(vc.type).toEqual(['VerifiableCredential', 'AgentSkillCredential']);
    expect(vc.issuer).toBe(issuerDid);
  });

  it('includes skill subject fields', () => {
    const vc = makeSkillVc(100);
    const subject = vc.credentialSubject;
    expect(subject.id).toBe(agentDid);
    expect(subject['skillId']).toBe('tts-elevenlabs');
    expect(subject['skillName']).toBe('ElevenLabs TTS');
    expect(subject['totalUses']).toBe(150);
    expect(subject['avgRating']).toBe(4.7);
  });

  it('maps milestone 100 to bronze', () => {
    const vc = makeSkillVc(100);
    expect(vc.credentialSubject['milestoneLevel']).toBe('bronze');
    expect(vc.credentialSubject['milestone']).toBe(100);
  });

  it('maps milestone 500 to silver', () => {
    const vc = makeSkillVc(500);
    expect(vc.credentialSubject['milestoneLevel']).toBe('silver');
    expect(vc.credentialSubject['milestone']).toBe(500);
  });

  it('maps milestone 1000 to gold', () => {
    const vc = makeSkillVc(1000);
    expect(vc.credentialSubject['milestoneLevel']).toBe('gold');
    expect(vc.credentialSubject['milestone']).toBe(1000);
  });

  it('is cryptographically verifiable', () => {
    const vc = makeSkillVc(500);
    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });
});
