import { issueCredential } from './vc.js';
import type { VerifiableCredential } from './vc.js';

/**
 * Build and sign a TeamCredential for successful team task completion.
 *
 * @param opts.agentDid - DID of the agent receiving the credential.
 * @param opts.teamId - Unique team identifier.
 * @param opts.role - Role the agent played (e.g. "analyst", "orchestrator").
 * @param opts.taskDescription - Description of the completed task.
 * @param opts.teamSize - Number of agents on the team.
 * @param opts.completedAt - ISO 8601 timestamp of task completion.
 * @param opts.signerKey - DER-encoded Ed25519 private key for signing.
 * @param opts.issuerDid - DID of the issuing entity.
 * @returns A signed VerifiableCredential with team participation data.
 */
export function buildTeamCredential(opts: {
  agentDid: string;
  teamId: string;
  role: string;
  taskDescription: string;
  teamSize: number;
  completedAt: string;
  signerKey: Buffer;
  issuerDid: string;
}): VerifiableCredential {
  const subject = {
    id: opts.agentDid,
    teamId: opts.teamId,
    role: opts.role,
    taskDescription: opts.taskDescription,
    teamSize: opts.teamSize,
    completedAt: opts.completedAt,
  };

  return issueCredential({
    subject,
    types: ['VerifiableCredential', 'AgentTeamCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
