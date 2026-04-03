/**
 * Verifiable Credentials engine for AgentBnB.
 *
 * Provides W3C-aligned credential issuance and verification
 * with Ed25519 signatures for agent reputation, skill milestones,
 * and team participation.
 *
 * @module credentials
 */

export { issueCredential, verifyCredential } from './vc.js';
export type { VerifiableCredential } from './vc.js';

export { buildReputationCredential } from './reputation-vc.js';
export type { ReputationSubject } from './reputation-vc.js';

export { buildSkillCredential } from './skill-vc.js';
export type { SkillMilestone } from './skill-vc.js';

export { buildTeamCredential } from './team-vc.js';

export {
  createPresentation,
  verifyPresentation,
  createSelectivePresentation,
} from './vc-presentation.js';
export type { VerifiablePresentation } from './vc-presentation.js';
