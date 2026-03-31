import { issueCredential } from './vc.js';
import type { VerifiableCredential } from './vc.js';

/**
 * Credential subject for agent reputation.
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
 * Format milliseconds to a human-readable duration string.
 * Rounds to one decimal place (e.g. 1200 -> "1.2s", 450 -> "0.5s").
 */
function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Build and sign a ReputationCredential from agent statistics.
 *
 * @param opts.agentDid - DID of the agent receiving the credential.
 * @param opts.stats - Aggregated execution statistics.
 * @param opts.skills - Per-skill usage and rating data.
 * @param opts.feedbackCount - Number of peer endorsements / feedback entries.
 * @param opts.signerKey - DER-encoded Ed25519 private key for signing.
 * @param opts.issuerDid - DID of the issuing entity.
 * @returns A signed VerifiableCredential with ReputationSubject.
 */
export function buildReputationCredential(opts: {
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
    avgResponseTime: formatLatency(opts.stats.avgLatencyMs),
    totalEarned: opts.stats.totalEarned,
    skills: opts.skills,
    peerEndorsements: opts.feedbackCount,
    activeSince: opts.stats.activeSince,
  };

  return issueCredential({
    subject,
    types: ['VerifiableCredential', 'AgentReputationCredential'],
    issuerDid: opts.issuerDid,
    signerKey: opts.signerKey,
  });
}
