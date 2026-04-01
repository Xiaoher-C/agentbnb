import { issueCredential } from './vc.js';
import type { VerifiableCredential } from './vc.js';

/** Milestone thresholds for skill credentials. */
export type SkillMilestone = 100 | 500 | 1000;

/** Human-readable milestone level labels. */
const MILESTONE_LEVELS: Record<SkillMilestone, string> = {
  100: 'bronze',
  500: 'silver',
  1000: 'gold',
};

/**
 * Build and sign a SkillCredential for a milestone achievement.
 * Milestones: 100 uses (bronze), 500 uses (silver), 1000 uses (gold).
 *
 * @param opts.agentDid - DID of the agent receiving the credential.
 * @param opts.skillId - Unique skill identifier.
 * @param opts.skillName - Human-readable skill name.
 * @param opts.totalUses - Total number of skill invocations.
 * @param opts.milestone - Milestone threshold reached (100, 500, or 1000).
 * @param opts.avgRating - Average rating on a 0-5 scale.
 * @param opts.signerKey - DER-encoded Ed25519 private key for signing.
 * @param opts.issuerDid - DID of the issuing entity.
 * @returns A signed VerifiableCredential with skill milestone data.
 */
export function buildSkillCredential(opts: {
  agentDid: string;
  skillId: string;
  skillName: string;
  totalUses: number;
  milestone: SkillMilestone;
  avgRating: number;
  signerKey: Buffer;
  issuerDid: string;
}): VerifiableCredential {
  const subject = {
    id: opts.agentDid,
    skillId: opts.skillId,
    skillName: opts.skillName,
    totalUses: opts.totalUses,
    milestone: opts.milestone,
    milestoneLevel: MILESTONE_LEVELS[opts.milestone],
    avgRating: opts.avgRating,
  };

  return issueCredential({
    subject,
    types: ['VerifiableCredential', 'AgentSkillCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
