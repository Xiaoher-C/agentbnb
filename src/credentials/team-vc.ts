import { issueCredential, type VerifiableCredential } from './vc.js';

/**
 * Builds and signs a TeamContributionCredential after a team task completes.
 *
 * @param opts.agentId - Agent identifier.
 * @param opts.agentDid - DID of the agent (credentialSubject.id).
 * @param opts.teamId - Unique team/session identifier.
 * @param opts.role - The role the agent played in the team.
 * @param opts.taskDescription - Description of the completed task.
 * @param opts.teamSize - Number of agents in the team.
 * @param opts.completedAt - ISO 8601 timestamp of task completion.
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.issuerDid - DID of the issuer.
 * @returns A signed VerifiableCredential of type TeamContributionCredential.
 */
export function buildTeamCredential(opts: {
  agentId: string;
  agentDid: string;
  teamId: string;
  role: string;
  taskDescription: string;
  teamSize: number;
  completedAt: string;
  signerKey: Buffer;
  issuerDid: string;
}): VerifiableCredential {
  return issueCredential({
    subject: {
      id: opts.agentDid,
      teamId: opts.teamId,
      role: opts.role,
      taskDescription: opts.taskDescription,
      teamSize: opts.teamSize,
      completedAt: opts.completedAt,
    },
    types: ['TeamContributionCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
