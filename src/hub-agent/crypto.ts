import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AgentBnBError } from '../types/index.js';

/**
 * Reads and validates the HUB_MASTER_KEY from environment variables.
 * The key must be a 64-character hex string (representing 32 bytes for AES-256).
 *
 * @returns A 32-byte Buffer suitable for AES-256-GCM encryption.
 * @throws {AgentBnBError} with code 'MISSING_MASTER_KEY' if env var is missing or invalid length.
 */
export function getMasterKey(): Buffer {
  const hex = process.env.HUB_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new AgentBnBError(
      'HUB_MASTER_KEY must be a 64-character hex string (32 bytes)',
      'MISSING_MASTER_KEY',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt.
 * @param masterKey - A 32-byte Buffer (from getMasterKey()).
 * @returns A string in the format `iv:authTag:ciphertext` (all hex-encoded).
 */
export function encrypt(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string previously encrypted with encrypt().
 *
 * @param encrypted - The encrypted string in `iv:authTag:ciphertext` format (hex-encoded).
 * @param masterKey - The same 32-byte Buffer used for encryption.
 * @returns The original plaintext string.
 * @throws Error if the key is wrong or data has been tampered with.
 */
export function decrypt(encrypted: string, masterKey: Buffer): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format: expected iv:authTag:ciphertext');
  }
  // Length check above guarantees all three indices are defined
  const ivHex = parts[0] as string;
  const authTagHex = parts[1] as string;
  const ciphertextHex = parts[2] as string;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
