import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../credit/signing.js';
import { createBridgeLink, verifyBridgeLink, derivePseudoEVMAddress } from './evm-bridge.js';

describe('evm-bridge', () => {
  const keys = generateKeyPair();
  // Extract raw 32-byte public key hex from DER/SPKI encoding (last 64 hex chars)
  const pubKeyHex = keys.publicKey.toString('hex').slice(-64);
  const agentDid = 'did:agentbnb:6df74745403944c4';
  const evmAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

  describe('createBridgeLink / verifyBridgeLink', () => {
    it('create and verify round-trip', () => {
      const link = createBridgeLink({
        ed25519PrivateKey: keys.privateKey,
        ed25519PublicKeyHex: pubKeyHex,
        evmAddress,
        agentDid,
      });

      expect(link.ed25519_public_key).toBe(pubKeyHex);
      expect(link.evm_address).toBe(evmAddress);
      expect(link.agent_did).toBe(agentDid);
      expect(link.timestamp).toBeTruthy();
      expect(link.ed25519_signature).toBeTruthy();

      expect(verifyBridgeLink(link, keys.publicKey)).toBe(true);
    });

    it('tampered link fails verification', () => {
      const link = createBridgeLink({
        ed25519PrivateKey: keys.privateKey,
        ed25519PublicKeyHex: pubKeyHex,
        evmAddress,
        agentDid,
      });

      link.evm_address = '0x0000000000000000000000000000000000000000';
      expect(verifyBridgeLink(link, keys.publicKey)).toBe(false);
    });

    it('tampered agent_did fails verification', () => {
      const link = createBridgeLink({
        ed25519PrivateKey: keys.privateKey,
        ed25519PublicKeyHex: pubKeyHex,
        evmAddress,
        agentDid,
      });

      link.agent_did = 'did:agentbnb:attackeragentid';
      expect(verifyBridgeLink(link, keys.publicKey)).toBe(false);
    });

    it('wrong key fails verification', () => {
      const otherKeys = generateKeyPair();
      const link = createBridgeLink({
        ed25519PrivateKey: keys.privateKey,
        ed25519PublicKeyHex: pubKeyHex,
        evmAddress,
        agentDid,
      });

      expect(verifyBridgeLink(link, otherKeys.publicKey)).toBe(false);
    });
  });

  describe('derivePseudoEVMAddress', () => {
    it('is deterministic', () => {
      const addr1 = derivePseudoEVMAddress(pubKeyHex);
      const addr2 = derivePseudoEVMAddress(pubKeyHex);
      expect(addr1).toBe(addr2);
    });

    it('starts with 0x and is 42 characters', () => {
      const addr = derivePseudoEVMAddress(pubKeyHex);
      expect(addr.startsWith('0x')).toBe(true);
      expect(addr.length).toBe(42);
    });

    it('different keys produce different addresses', () => {
      const otherKeys = generateKeyPair();
      const otherPubKeyHex = otherKeys.publicKey.toString('hex').slice(-64);

      const addr1 = derivePseudoEVMAddress(pubKeyHex);
      const addr2 = derivePseudoEVMAddress(otherPubKeyHex);
      expect(addr1).not.toBe(addr2);
    });

    it('output is valid lowercase hex after 0x prefix', () => {
      const addr = derivePseudoEVMAddress(pubKeyHex);
      const hexPart = addr.slice(2);
      expect(/^[0-9a-f]{40}$/.test(hexPart)).toBe(true);
    });
  });
});
