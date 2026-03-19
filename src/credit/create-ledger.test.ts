import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from './create-ledger.js';
import { LocalCreditLedger } from './local-credit-ledger.js';
import { RegistryCreditLedger } from './registry-credit-ledger.js';
import type { CreditLedger } from './credit-ledger.js';
import { openCreditDb } from './ledger.js';

describe('createLedger factory', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      tmpDir = undefined;
    }
  });

  it('returns LocalCreditLedger when no registryUrl is provided', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    const dbPath = join(tmpDir, 'credits.db');
    const ledger = createLedger({ creditDbPath: dbPath });
    expect(ledger).toBeInstanceOf(LocalCreditLedger);
  });

  it('returns RegistryCreditLedger in HTTP mode when registryUrl + ownerPublicKey provided', () => {
    const ledger = createLedger({
      registryUrl: 'https://registry.agentbnb.dev',
      ownerPublicKey: 'pk-test-123',
    });
    expect(ledger).toBeInstanceOf(RegistryCreditLedger);
  });

  it('returns RegistryCreditLedger in direct mode when db is provided', () => {
    const db = openCreditDb(':memory:');
    const ledger = createLedger({ db });
    expect(ledger).toBeInstanceOf(RegistryCreditLedger);
  });

  it('returned LocalCreditLedger has all 6 CreditLedger methods', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    const dbPath = join(tmpDir, 'credits.db');
    const ledger = createLedger({ creditDbPath: dbPath });
    expect(typeof ledger.hold).toBe('function');
    expect(typeof ledger.settle).toBe('function');
    expect(typeof ledger.release).toBe('function');
    expect(typeof ledger.getBalance).toBe('function');
    expect(typeof ledger.getHistory).toBe('function');
    expect(typeof ledger.grant).toBe('function');
  });

  it('returned RegistryCreditLedger (HTTP mode) has all 6 CreditLedger methods', () => {
    const ledger = createLedger({
      registryUrl: 'https://registry.agentbnb.dev',
      ownerPublicKey: 'pk-test-456',
    });
    expect(typeof ledger.hold).toBe('function');
    expect(typeof ledger.settle).toBe('function');
    expect(typeof ledger.release).toBe('function');
    expect(typeof ledger.getBalance).toBe('function');
    expect(typeof ledger.getHistory).toBe('function');
    expect(typeof ledger.grant).toBe('function');
  });

  it('returned RegistryCreditLedger (direct mode) has all 6 CreditLedger methods', () => {
    const db = openCreditDb(':memory:');
    const ledger = createLedger({ db });
    expect(typeof ledger.hold).toBe('function');
    expect(typeof ledger.settle).toBe('function');
    expect(typeof ledger.release).toBe('function');
    expect(typeof ledger.getBalance).toBe('function');
    expect(typeof ledger.getHistory).toBe('function');
    expect(typeof ledger.grant).toBe('function');
  });

  it('createLedger exports satisfy CreditLedger interface (type check via instanceof)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    const dbPath = join(tmpDir, 'credits.db');
    const ledger: CreditLedger = createLedger({ creditDbPath: dbPath });
    // If TypeScript compiles this without error, CreditLedger interface is satisfied
    expect(ledger).toBeDefined();
  });
});
