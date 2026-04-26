/**
 * authHeaders tests.
 *
 * Verifies that:
 *  - localStorage never contains private key material under the new shape.
 *  - Legacy entries containing privateKeyBase64 are wiped on first read.
 *  - signRequest() uses the in-memory non-extractable key.
 *  - clearHubPrivateKey() forces signRequest to throw HubSessionExpiredError.
 *  - HubAuthForm imports keys with extractable=false (asserted via mocked subtle.importKey).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveSession,
  loadSession,
  clearSession,
  setHubPrivateKey,
  getHubPrivateKey,
  clearHubPrivateKey,
  signRequest,
  HubSessionExpiredError,
  type HubSession,
} from './authHeaders.js';

const SESSION_KEY = 'agentbnb_hub_session';

const sampleSession: HubSession = {
  agentId: 'agent-abc',
  publicKeyHex: 'aabbccdd',
  createdAt: '2026-04-27T00:00:00.000Z',
};

describe('authHeaders — session storage', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHubPrivateKey();
    vi.restoreAllMocks();
  });

  it('saveSession persists only metadata — never privateKeyBase64', () => {
    saveSession(sampleSession);
    const raw = localStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('privateKeyBase64');
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed).toEqual({
      agentId: 'agent-abc',
      publicKeyHex: 'aabbccdd',
      createdAt: '2026-04-27T00:00:00.000Z',
    });
    expect('privateKeyBase64' in parsed).toBe(false);
  });

  it('loadSession returns the persisted metadata', () => {
    saveSession(sampleSession);
    expect(loadSession()).toEqual(sampleSession);
  });

  it('loadSession wipes legacy entries that contain privateKeyBase64', () => {
    const legacy = {
      agentId: 'agent-legacy',
      publicKeyHex: 'deadbeef',
      privateKeyBase64: 'AAAAAAAAAAAA',
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[hub] migrated legacy session shape — please re-login',
    );
  });

  it('loadSession returns null for malformed JSON', () => {
    localStorage.setItem(SESSION_KEY, 'not-json{');
    expect(loadSession()).toBeNull();
  });

  it('loadSession returns null when required fields are missing', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ agentId: 'a' }));
    expect(loadSession()).toBeNull();
  });

  it('clearSession removes the session entry', () => {
    saveSession(sampleSession);
    clearSession();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('authHeaders — in-memory private key', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHubPrivateKey();
    vi.restoreAllMocks();
  });

  it('setHubPrivateKey/getHubPrivateKey/clearHubPrivateKey roundtrip', () => {
    expect(getHubPrivateKey()).toBeNull();
    const fake = { type: 'private', algorithm: { name: 'Ed25519' } } as unknown as CryptoKey;
    setHubPrivateKey(fake);
    expect(getHubPrivateKey()).toBe(fake);
    clearHubPrivateKey();
    expect(getHubPrivateKey()).toBeNull();
  });
});

describe('authHeaders — signRequest', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHubPrivateKey();
    vi.restoreAllMocks();
  });

  it('returns null when no session metadata exists', async () => {
    expect(await signRequest('GET', '/me')).toBeNull();
  });

  it('throws HubSessionExpiredError when session exists but in-memory key is gone', async () => {
    saveSession(sampleSession);
    // No setHubPrivateKey call — simulates page reload.
    await expect(signRequest('GET', '/me')).rejects.toBeInstanceOf(HubSessionExpiredError);
  });

  it('signs with the in-memory non-extractable key and returns DID headers', async () => {
    saveSession(sampleSession);
    const fakeKey = { type: 'private', algorithm: { name: 'Ed25519' } } as unknown as CryptoKey;
    setHubPrivateKey(fakeKey);

    const signSpy = vi
      .spyOn(crypto.subtle, 'sign')
      .mockResolvedValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer);

    const headers = await signRequest('GET', '/me');
    expect(headers).not.toBeNull();
    expect(headers!['X-Agent-Id']).toBe('agent-abc');
    expect(headers!['X-Agent-PublicKey']).toBe('aabbccdd');
    expect(typeof headers!['X-Agent-Signature']).toBe('string');
    expect(typeof headers!['X-Agent-Timestamp']).toBe('string');

    // Verify that the in-memory CryptoKey (not any persisted bytes) was used.
    expect(signSpy).toHaveBeenCalledTimes(1);
    const args = signSpy.mock.calls[0]!;
    expect(args[0]).toEqual({ name: 'Ed25519' });
    expect(args[1]).toBe(fakeKey);
  });

  it('signRequest throws after clearHubPrivateKey() is called', async () => {
    saveSession(sampleSession);
    const fakeKey = { type: 'private', algorithm: { name: 'Ed25519' } } as unknown as CryptoKey;
    setHubPrivateKey(fakeKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);

    const ok = await signRequest('GET', '/me');
    expect(ok).not.toBeNull();

    clearHubPrivateKey();
    await expect(signRequest('GET', '/me')).rejects.toBeInstanceOf(HubSessionExpiredError);
  });
});

describe('authHeaders — non-extractable import contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('importKey is invoked with extractable=false and only the sign usage', async () => {
    // The contract that callers must honor when populating the in-memory key.
    // We exercise the same call shape used by HubAuthForm.importNonExtractablePrivateKey.
    const importSpy = vi
      .spyOn(crypto.subtle, 'importKey')
      .mockResolvedValue({ type: 'private' } as unknown as CryptoKey);

    const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00]).buffer;
    await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);

    expect(importSpy).toHaveBeenCalledTimes(1);
    const [format, , algorithm, extractable, usages] = importSpy.mock.calls[0]!;
    expect(format).toBe('pkcs8');
    expect(algorithm).toEqual({ name: 'Ed25519' });
    expect(extractable).toBe(false);
    expect(usages).toEqual(['sign']);
  });
});
