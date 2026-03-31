import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildReputationCredential } from './reputation-vc.js';

describe('reputation-vc', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';
  const agentDid = 'did:agentbnb:agent-rep-001';

  function makeRepVc() {
    return buildReputationCredential({
      agentDid,
      stats: {
        totalTransactions: 250,
        successRate: 0.95,
        avgLatencyMs: 1200,
        totalEarned: 500,
        activeSince: '2026-01-15T00:00:00.000Z',
      },
      skills: [
        { id: 'tts-elevenlabs', uses: 120, rating: 4.8 },
        { id: 'code-review', uses: 80, rating: 4.5 },
      ],
      feedbackCount: 42,
      signerKey: keys.privateKey,
      issuerDid,
    });
  }

  it('builds a valid reputation credential with correct types', () => {
    const vc = makeRepVc();
    expect(vc.type).toEqual(['VerifiableCredential', 'AgentReputationCredential']);
    expect(vc.issuer).toBe(issuerDid);
  });

  it('includes correct credential subject fields', () => {
    const vc = makeRepVc();
    const subject = vc.credentialSubject;
    expect(subject.id).toBe(agentDid);
    expect(subject['totalTransactions']).toBe(250);
    expect(subject['successRate']).toBe(0.95);
    expect(subject['totalEarned']).toBe(500);
    expect(subject['peerEndorsements']).toBe(42);
    expect(subject['activeSince']).toBe('2026-01-15T00:00:00.000Z');
  });

  it('formats avgLatencyMs as human-readable string (1200 -> "1.2s")', () => {
    const vc = makeRepVc();
    expect(vc.credentialSubject['avgResponseTime']).toBe('1.2s');
  });

  it('formats sub-second latency correctly (450 -> "0.5s")', () => {
    const vc = buildReputationCredential({
      agentDid,
      stats: {
        totalTransactions: 10,
        successRate: 1.0,
        avgLatencyMs: 450,
        totalEarned: 20,
        activeSince: '2026-03-01T00:00:00.000Z',
      },
      skills: [],
      feedbackCount: 0,
      signerKey: keys.privateKey,
      issuerDid,
    });
    expect(vc.credentialSubject['avgResponseTime']).toBe('0.5s');
  });

  it('includes skills array in subject', () => {
    const vc = makeRepVc();
    const skills = vc.credentialSubject['skills'] as Array<{ id: string; uses: number; rating: number }>;
    expect(skills).toHaveLength(2);
    expect(skills[0]!.id).toBe('tts-elevenlabs');
    expect(skills[1]!.uses).toBe(80);
  });

  it('is cryptographically verifiable', () => {
    const vc = makeRepVc();
    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });
});
