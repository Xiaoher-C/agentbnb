import { issueCredential, type VerifiableCredential } from './vc.js';

/**
 * Builds and signs a SkillMilestoneCredential when an agent reaches a usage milestone.
 *
 * @param opts.agentId - Agent identifier.
 * @param opts.agentDid - DID of the agent (credentialSubject.id).
 * @param opts.skillId - Unique skill identifier.
 * @param opts.skillName - Human-readable skill name.
 * @param opts.totalUses - Total executions of the skill.
 * @param opts.milestone - The milestone threshold reached (100, 500, or 1000).
 * @param opts.avgRating - Average rating for the skill.
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.issuerDid - DID of the issuer.
 * @returns A signed VerifiableCredential of type SkillMilestoneCredential.
 */
export function buildSkillCredential(opts: {
  agentId: string;
  agentDid: string;
  skillId: string;
  skillName: string;
  totalUses: number;
  milestone: 100 | 500 | 1000;
  avgRating: number;
  signerKey: Buffer;
  issuerDid: string;
}): VerifiableCredential {
  return issueCredential({
    subject: {
      id: opts.agentDid,
      skillId: opts.skillId,
      skillName: opts.skillName,
      totalUses: opts.totalUses,
      milestone: opts.milestone,
      avgRating: opts.avgRating,
    },
    types: ['SkillMilestoneCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
