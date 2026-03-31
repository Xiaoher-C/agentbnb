import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildSkillCredential } from './skill-vc.js';

describe('SkillCredential', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';

  it('builds a SkillMilestoneCredential at 100 uses', () => {
    const vc = buildSkillCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      skillId: 'translate-en-zh',
      skillName: 'English to Chinese Translation',
      totalUses: 105,
      milestone: 100,
      avgRating: 4.7,
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(vc.type).toContain('SkillMilestoneCredential');
    expect(vc.credentialSubject.id).toBe('did:agentbnb:agent-1');
    expect(vc.credentialSubject.skillId).toBe('translate-en-zh');
    expect(vc.credentialSubject.skillName).toBe('English to Chinese Translation');
    expect(vc.credentialSubject.totalUses).toBe(105);
    expect(vc.credentialSubject.milestone).toBe(100);
    expect(vc.credentialSubject.avgRating).toBe(4.7);
  });

  it('builds at 500 and 1000 milestones', () => {
    for (const milestone of [500, 1000] as const) {
      const vc = buildSkillCredential({
        agentId: 'agent-1',
        agentDid: 'did:agentbnb:agent-1',
        skillId: 'summarize',
        skillName: 'Text Summarization',
        totalUses: milestone + 10,
        milestone,
        avgRating: 4.9,
        signerKey: keys.privateKey,
        issuerDid,
      });

      expect(vc.credentialSubject.milestone).toBe(milestone);
      expect(verifyCredential(vc, keys.publicKey)).toBe(true);
    }
  });

  it('verifies the signed credential', () => {
    const vc = buildSkillCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      skillId: 'code-review',
      skillName: 'Code Review',
      totalUses: 1000,
      milestone: 1000,
      avgRating: 4.5,
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });
});
