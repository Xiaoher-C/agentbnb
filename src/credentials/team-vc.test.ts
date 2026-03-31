import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { verifyCredential } from './vc.js';
import { buildTeamCredential } from './team-vc.js';

describe('TeamCredential', () => {
  const keys = generateKeyPair();
  const issuerDid = 'did:agentbnb:platform';

  it('builds a TeamContributionCredential', () => {
    const vc = buildTeamCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      teamId: 'team-abc-123',
      role: 'translator',
      taskDescription: 'Translate product docs from EN to ZH',
      teamSize: 3,
      completedAt: '2026-04-01T12:00:00.000Z',
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(vc.type).toContain('TeamContributionCredential');
    expect(vc.credentialSubject.id).toBe('did:agentbnb:agent-1');
    expect(vc.credentialSubject.teamId).toBe('team-abc-123');
    expect(vc.credentialSubject.role).toBe('translator');
    expect(vc.credentialSubject.taskDescription).toBe('Translate product docs from EN to ZH');
    expect(vc.credentialSubject.teamSize).toBe(3);
    expect(vc.credentialSubject.completedAt).toBe('2026-04-01T12:00:00.000Z');
  });

  it('verifies the signed credential', () => {
    const vc = buildTeamCredential({
      agentId: 'agent-2',
      agentDid: 'did:agentbnb:agent-2',
      teamId: 'team-xyz-789',
      role: 'coordinator',
      taskDescription: 'Orchestrate multi-agent research pipeline',
      teamSize: 5,
      completedAt: '2026-04-01T15:30:00.000Z',
      signerKey: keys.privateKey,
      issuerDid,
    });

    expect(verifyCredential(vc, keys.publicKey)).toBe(true);
  });

  it('rejects tampered team credential', () => {
    const vc = buildTeamCredential({
      agentId: 'agent-1',
      agentDid: 'did:agentbnb:agent-1',
      teamId: 'team-abc-123',
      role: 'translator',
      taskDescription: 'Original task',
      teamSize: 3,
      completedAt: '2026-04-01T12:00:00.000Z',
      signerKey: keys.privateKey,
      issuerDid,
    });

    vc.credentialSubject.role = 'coordinator';
    expect(verifyCredential(vc, keys.publicKey)).toBe(false);
  });
});
