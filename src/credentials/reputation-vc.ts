import { issueCredential, type VerifiableCredential } from './vc.js';

/**
 * Subject fields for an AgentReputationCredential.
 */
export interface ReputationSubject {
  id: string;
  totalTransactions: number;
  successRate: number;
  avgResponseTime: string;
  totalEarned: number;
  skills: Array<{ id: string; uses: number; rating: number }>;
  peerEndorsements: number;
  activeSince: string;
}

/**
 * Builds and signs an AgentReputationCredential from aggregated stats.
 *
 * @param opts.agentId - Agent identifier.
 * @param opts.agentDid - DID of the agent (credentialSubject.id).
 * @param opts.stats - Aggregated performance stats.
 * @param opts.skills - Per-skill usage and rating data.
 * @param opts.feedbackCount - Number of peer endorsements / feedback entries.
 * @param opts.signerKey - DER-encoded Ed25519 private key.
 * @param opts.issuerDid - DID of the issuer.
 * @returns A signed VerifiableCredential of type AgentReputationCredential.
 */
export function buildReputationCredential(opts: {
  agentId: string;
  agentDid: string;
  stats: {
    totalTransactions: number;
    successRate: number;
    avgLatencyMs: number;
    totalEarned: number;
    activeSince: string;
  };
  skills: Array<{ id: string; uses: number; rating: number }>;
  feedbackCount: number;
  signerKey: Buffer;
  issuerDid: string;
}): VerifiableCredential {
  const subject: ReputationSubject = {
    id: opts.agentDid,
    totalTransactions: opts.stats.totalTransactions,
    successRate: opts.stats.successRate,
    avgResponseTime: `${(opts.stats.avgLatencyMs / 1000).toFixed(1)}s`,
    totalEarned: opts.stats.totalEarned,
    skills: opts.skills,
    peerEndorsements: opts.feedbackCount,
    activeSince: opts.stats.activeSince,
  };

  return issueCredential({
    subject: subject as unknown as Record<string, unknown>,
    types: ['AgentReputationCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
