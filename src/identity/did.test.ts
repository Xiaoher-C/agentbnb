import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { deriveAgentId } from './identity.js';
import {
  toDIDKey,
  toDIDAgentBnB,
  parseDID,
  buildDIDDocument,
  type DIDDocument,
} from './did.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a fresh keypair and return hex strings + agent_id. */
function freshIdentity() {
  const keys = generateKeyPair();
  const publicKeyHex = keys.publicKey.toString('hex');
  const agentId = deriveAgentId(publicKeyHex);
  return { keys, publicKeyHex, agentId };
}

// ---------------------------------------------------------------------------
// toDIDKey
// ---------------------------------------------------------------------------

describe('toDIDKey', () => {
  it('returns did:key with z prefix and z6Mk start for Ed25519', () => {
    const { publicKeyHex } = freshIdentity();
    const did = toDIDKey(publicKeyHex);
    expect(did).toMatch(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);
    // Ed25519 multicodec 0xed01 always encodes to base58btc starting with 6Mk
    expect(did).toMatch(/^did:key:z6Mk/);
  });

  it('accepts DER SPKI hex (44 bytes) — the default format in AgentBnB', () => {
    const { publicKeyHex } = freshIdentity();
    expect(Buffer.from(publicKeyHex, 'hex').length).toBe(44);
    const did = toDIDKey(publicKeyHex);
    expect(did).toMatch(/^did:key:z6Mk/);
  });

  it('accepts raw 32-byte hex key', () => {
    const { publicKeyHex } = freshIdentity();
    // Strip 12-byte SPKI header to get raw 32 bytes
    const rawHex = publicKeyHex.slice(24); // 12 bytes = 24 hex chars
    expect(Buffer.from(rawHex, 'hex').length).toBe(32);
    const did = toDIDKey(rawHex);
    expect(did).toMatch(/^did:key:z6Mk/);
  });

  it('produces the same DID for SPKI and raw of the same key', () => {
    const { publicKeyHex } = freshIdentity();
    const rawHex = publicKeyHex.slice(24);
    expect(toDIDKey(publicKeyHex)).toBe(toDIDKey(rawHex));
  });

  it('produces different DIDs for different keys', () => {
    const a = freshIdentity();
    const b = freshIdentity();
    expect(toDIDKey(a.publicKeyHex)).not.toBe(toDIDKey(b.publicKeyHex));
  });

  it('throws on invalid key length', () => {
    expect(() => toDIDKey('abcd')).toThrow('Invalid Ed25519 public key');
  });
});

// ---------------------------------------------------------------------------
// toDIDAgentBnB
// ---------------------------------------------------------------------------

describe('toDIDAgentBnB', () => {
  it('wraps a valid 16-char hex agent_id', () => {
    const { agentId } = freshIdentity();
    expect(toDIDAgentBnB(agentId)).toBe(`did:agentbnb:${agentId}`);
  });

  it('throws on invalid agent_id (too short)', () => {
    expect(() => toDIDAgentBnB('abc')).toThrow('Invalid agent_id');
  });

  it('throws on invalid agent_id (uppercase)', () => {
    expect(() => toDIDAgentBnB('6DF74745403944C4')).toThrow('Invalid agent_id');
  });

  it('throws on invalid agent_id (non-hex)', () => {
    expect(() => toDIDAgentBnB('zzzzzzzzzzzzzzzz')).toThrow('Invalid agent_id');
  });
});

// ---------------------------------------------------------------------------
// parseDID
// ---------------------------------------------------------------------------

describe('parseDID', () => {
  describe('did:key', () => {
    it('round-trips: toDIDKey → parseDID extracts the same raw pubkey', () => {
      const { publicKeyHex } = freshIdentity();
      const rawHex = publicKeyHex.slice(24); // raw 32-byte key
      const did = toDIDKey(publicKeyHex);
      const parsed = parseDID(did);

      expect(parsed.method).toBe('key');
      expect(parsed.pubkeyHex).toBe(rawHex);
    });

    it('throws on missing z prefix', () => {
      expect(() => parseDID('did:key:6MkhaXgBZ')).toThrow('must start with z');
    });

    it('throws on non-Ed25519 multicodec', () => {
      // base58btc of [0x00, 0x01, ...32 zero bytes] — wrong prefix
      expect(() => parseDID('did:key:z11111111111111111111111111111111111')).toThrow('multicodec prefix');
    });
  });

  describe('did:agentbnb', () => {
    it('parses a valid did:agentbnb', () => {
      const { agentId } = freshIdentity();
      const did = `did:agentbnb:${agentId}`;
      const parsed = parseDID(did);

      expect(parsed.method).toBe('agentbnb');
      expect(parsed.id).toBe(agentId);
      expect(parsed.pubkeyHex).toBeUndefined();
    });

    it('throws on invalid agent_id in did:agentbnb', () => {
      expect(() => parseDID('did:agentbnb:tooshort')).toThrow('16 hex characters');
    });
  });

  describe('unknown methods', () => {
    it('parses unknown DID methods without validation', () => {
      const parsed = parseDID('did:web:example.com');
      expect(parsed.method).toBe('web');
      expect(parsed.id).toBe('example.com');
      expect(parsed.pubkeyHex).toBeUndefined();
    });
  });

  describe('invalid format', () => {
    it('throws on non-DID string', () => {
      expect(() => parseDID('not-a-did')).toThrow('Invalid DID format');
    });

    it('throws on empty method', () => {
      expect(() => parseDID('did::abc')).toThrow('Invalid DID format');
    });
  });
});

// ---------------------------------------------------------------------------
// buildDIDDocument
// ---------------------------------------------------------------------------

describe('buildDIDDocument', () => {
  it('returns a valid W3C DID Document', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({ agent_id: agentId, public_key: publicKeyHex });

    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc['@context']).toContain('https://w3id.org/security/suites/ed25519-2020/v1');
    expect(doc.id).toBe(`did:agentbnb:${agentId}`);
  });

  it('includes verificationMethod with Ed25519VerificationKey2020', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({ agent_id: agentId, public_key: publicKeyHex });

    expect(doc.verificationMethod).toHaveLength(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe(`did:agentbnb:${agentId}#key-1`);
    expect(vm.type).toBe('Ed25519VerificationKey2020');
    expect(vm.controller).toBe(`did:agentbnb:${agentId}`);
    expect(vm.publicKeyMultibase).toMatch(/^z6Mk/);
  });

  it('includes authentication reference', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({ agent_id: agentId, public_key: publicKeyHex });
    expect(doc.authentication).toEqual([`did:agentbnb:${agentId}#key-1`]);
  });

  it('includes service endpoint when gateway_url is provided', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({
      agent_id: agentId,
      public_key: publicKeyHex,
      gateway_url: 'https://agent.example.com/gateway',
    });

    expect(doc.service).toHaveLength(1);
    const svc = doc.service![0];
    expect(svc.id).toBe(`did:agentbnb:${agentId}#agentbnb-gateway`);
    expect(svc.type).toBe('AgentGateway');
    expect(svc.serviceEndpoint).toBe('https://agent.example.com/gateway');
  });

  it('omits service when no gateway_url', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({ agent_id: agentId, public_key: publicKeyHex });
    expect(doc.service).toBeUndefined();
  });

  it('publicKeyMultibase round-trips through parseDID(toDIDKey())', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({ agent_id: agentId, public_key: publicKeyHex });
    const multibase = doc.verificationMethod[0].publicKeyMultibase;

    // The multibase value should produce a valid did:key
    const didKey = `did:key:${multibase}`;
    const parsed = parseDID(didKey);
    expect(parsed.pubkeyHex).toBe(publicKeyHex.slice(24)); // raw 32-byte key
  });

  it('produces valid JSON serialization', () => {
    const { publicKeyHex, agentId } = freshIdentity();
    const doc = buildDIDDocument({
      agent_id: agentId,
      public_key: publicKeyHex,
      gateway_url: 'https://gw.test',
    });
    const json = JSON.stringify(doc);
    const reparsed = JSON.parse(json) as DIDDocument;
    expect(reparsed.id).toBe(doc.id);
    expect(reparsed.verificationMethod[0].publicKeyMultibase).toBe(
      doc.verificationMethod[0].publicKeyMultibase,
    );
  });
});
