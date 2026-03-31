import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildReputationCredential } from './reputation-vc.js';

describe('ReputationCredential', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';

  it('builds a valid AgentReputationCredential', () => {
    const vc = buildReputationCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      stats: {
        totalTransactions: 150,
        successRate: 0.95,
        avgLatencyMs: 1200,
        totalEarned: 500,
        activeSince: '2026-01-15T00:00:00.000Z',
      },
      skills: [
        { id: 'translate', uses: 100, rating: 4.8 },
        { id: 'summarize', uses: 50, rating: 4.5 },
      ],
      feedbackCount: 30,
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(vc.type).toContain('AgentReputationCredential');
    expect(vc.credentialSubject.id).toBe('did:agentbnb:agent-1');
    expect(vc.credentialSubject.totalTransactions).toBe(150);
    expect(vc.credentialSubject.successRate).toBe(0.95);
    expect(vc.credentialSubject.avgResponseTime).toBe('1.2s');
    expect(vc.credentialSubject.totalEarned).toBe(500);
    expect(vc.credentialSubject.peerEndorsements).toBe(30);
    expect(vc.credentialSubject.activeSince).toBe('2026-01-15T00:00:00.000Z');
    expect(vc.credentialSubject.skills).toEqual([
      { id: 'translate', uses: 100, rating: 4.8 },
      { id: 'summarize', uses: 50, rating: 4.5 },
    ]);
  });

  it('verifies the signed credential', () => {
    const vc = buildReputationCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      stats: {
        totalTransactions: 10,
        successRate: 1.0,
        avgLatencyMs: 500,
        totalEarned: 100,
        activeSince: '2026-03-01T00:00:00.000Z',
      },
      skills: [],
      feedbackCount: 5,
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });

  it('formats avgResponseTime correctly', () => {
    const vc = buildReputationCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      stats: {
        totalTransactions: 1,
        successRate: 1.0,
        avgLatencyMs: 250,
        totalEarned: 10,
        activeSince: '2026-03-01T00:00:00.000Z',
      },
      skills: [],
      feedbackCount: 0,
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(vc.credentialSubject.avgResponseTime).toBe('0.3s');
  });
});
