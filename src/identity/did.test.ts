import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { deriveAgentId } from './identity.js';
import {
  toDIDKey,
  toDIDAgentBnB,
  parseDID,
  buildDIDDocument,
} from './did.js';

describe('DID Core Library', () => {
  // Generate a stable keypair for tests
  const keys = generateKeyPair();
  // DER/SPKI-encoded public key → last 32 bytes = raw Ed25519 key
  const derHex = keys.publicKey.toString('hex');
  const rawPubkeyHex = derHex.slice(-64);
  const agentId = deriveAgentId(derHex);

  describe('toDIDKey', () => {
    it('produces a valid did:key string', () => {
      const did = toDIDKey(rawPubkeyHex);
      expect(did).toMatch(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);
    });

    it('starts with the correct multicodec prefix after decoding', () => {
      const did = toDIDKey(rawPubkeyHex);
      // Round-trip via parseDID to verify multicodec prefix was applied
      const parsed = parseDID(did);
      expect(parsed.pubkeyHex).toBe(rawPubkeyHex);
    });

    it('rejects a key that is not 32 bytes', () => {
      expect(() => toDIDKey('abcd')).toThrow('Expected 32-byte');
      expect(() => toDIDKey(rawPubkeyHex + 'ff')).toThrow('Expected 32-byte');
    });

    it('produces deterministic output for the same key', () => {
      const a = toDIDKey(rawPubkeyHex);
      const b = toDIDKey(rawPubkeyHex);
      expect(a).toBe(b);
    });
  });

  describe('toDIDAgentBnB', () => {
    it('produces a valid did:agentbnb string', () => {
      const did = toDIDAgentBnB(agentId);
      expect(did).toBe(`did:agentbnb:${agentId}`);
    });

    it('rejects non-16-char-hex strings', () => {
      expect(() => toDIDAgentBnB('short')).toThrow('Invalid agent_id');
      expect(() => toDIDAgentBnB('GGGGGGGGGGGGGGGG')).toThrow('Invalid agent_id');
      expect(() => toDIDAgentBnB('0123456789abcdef0')).toThrow('Invalid agent_id');
    });

    it('rejects uppercase hex', () => {
      expect(() => toDIDAgentBnB('0123456789ABCDEF')).toThrow('Invalid agent_id');
    });
  });

  describe('parseDID', () => {
    it('parses did:key and extracts pubkeyHex', () => {
      const did = toDIDKey(rawPubkeyHex);
      const parsed = parseDID(did);
      expect(parsed.method).toBe('key');
      expect(parsed.pubkeyHex).toBe(rawPubkeyHex);
    });

    it('parses did:agentbnb', () => {
      const did = toDIDAgentBnB(agentId);
      const parsed = parseDID(did);
      expect(parsed.method).toBe('agentbnb');
      expect(parsed.id).toBe(agentId);
      expect(parsed.pubkeyHex).toBeUndefined();
    });

    it('throws on invalid DID format', () => {
      expect(() => parseDID('notadid')).toThrow('Invalid DID format');
      expect(() => parseDID('did:')).toThrow('Invalid DID format');
    });

    it('throws on unsupported DID method', () => {
      expect(() => parseDID('did:web:example.com')).toThrow('Unsupported DID method');
    });

    it('throws on did:key without z prefix', () => {
      expect(() => parseDID('did:key:abc123')).toThrow('must start with "z"');
    });

    it('throws on did:key with non-Ed25519 multicodec', () => {
      // Prefix 0x00 0x00 is not Ed25519
      expect(() => parseDID('did:key:z1111')).toThrow('Ed25519 multicodec prefix');
    });
  });

  describe('buildDIDDocument', () => {
    it('builds a valid DID document with gateway_url', () => {
      const doc = buildDIDDocument({
        agent_id: agentId,
        public_key: derHex,
        gateway_url: 'https://agent.example.com/gateway',
      });

      expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
      expect(doc['@context']).toContain('https://w3id.org/security/suites/ed25519-2020/v1');
      expect(doc.id).toBe(`did:agentbnb:${agentId}`);
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.verificationMethod[0]!.type).toBe('Ed25519VerificationKey2020');
      expect(doc.verificationMethod[0]!.controller).toBe(doc.id);
      expect(doc.verificationMethod[0]!.publicKeyMultibase).toMatch(/^z/);
      expect(doc.authentication).toEqual([`${doc.id}#key-1`]);
      expect(doc.assertionMethod).toEqual([`${doc.id}#key-1`]);
      expect(doc.service).toHaveLength(1);
      expect(doc.service![0]!.type).toBe('AgentGateway');
      expect(doc.service![0]!.serviceEndpoint).toBe('https://agent.example.com/gateway');
    });

    it('omits service array when gateway_url is not provided', () => {
      const doc = buildDIDDocument({
        agent_id: agentId,
        public_key: derHex,
      });

      expect(doc.service).toBeUndefined();
    });

    it('publicKeyMultibase decodes to the raw Ed25519 key', () => {
      const doc = buildDIDDocument({
        agent_id: agentId,
        public_key: derHex,
      });

      // The multibase key should be resolvable via parseDID on a synthetic did:key
      const multibase = doc.verificationMethod[0]!.publicKeyMultibase;
      const syntheticDid = `did:key:${multibase}`;
      const parsed = parseDID(syntheticDid);
      expect(parsed.pubkeyHex).toBe(rawPubkeyHex);
    });
  });

  describe('round-trip', () => {
    it('toDIDKey -> parseDID -> pubkeyHex matches original', () => {
      const did = toDIDKey(rawPubkeyHex);
      const parsed = parseDID(did);
      expect(parsed.pubkeyHex).toBe(rawPubkeyHex);
    });

    it('works with multiple generated keypairs', () => {
      for (let i = 0; i < 5; i++) {
        const kp = generateKeyPair();
        const raw = kp.publicKey.toString('hex').slice(-64);
        const did = toDIDKey(raw);
        const parsed = parseDID(did);
        expect(parsed.pubkeyHex).toBe(raw);
      }
    });
  });
});
