import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:net';
import {
  KNOWN_API_KEYS,
  API_TEMPLATES,
  detectApiKeys,
  isPortOpen,
  detectOpenPorts,
  buildDraftCard,
} from './onboarding.js';
import { CapabilityCardSchema } from '../types/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── detectApiKeys ──────────────────────────────────────────────────────────

describe('detectApiKeys', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh env object for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns env var names that exist in process.env', () => {
    process.env['OPENAI_API_KEY'] = 'test-value';
    const result = detectApiKeys(KNOWN_API_KEYS);
    expect(result).toContain('OPENAI_API_KEY');
  });

  it('returns empty array when no known keys are set', () => {
    // Remove all known keys
    for (const key of KNOWN_API_KEYS) {
      delete process.env[key];
    }
    const result = detectApiKeys(KNOWN_API_KEYS);
    expect(result).toEqual([]);
  });

  it('returns all matching keys when multiple are set', () => {
    process.env['OPENAI_API_KEY'] = 'x';
    process.env['ANTHROPIC_API_KEY'] = 'y';
    process.env['ELEVENLABS_API_KEY'] = 'z';
    const result = detectApiKeys(KNOWN_API_KEYS);
    expect(result).toContain('OPENAI_API_KEY');
    expect(result).toContain('ANTHROPIC_API_KEY');
    expect(result).toContain('ELEVENLABS_API_KEY');
    expect(result).toHaveLength(3);
  });

  it('accepts a custom key list', () => {
    process.env['MY_CUSTOM_KEY'] = 'val';
    const result = detectApiKeys(['MY_CUSTOM_KEY', 'NONEXISTENT_KEY']);
    expect(result).toEqual(['MY_CUSTOM_KEY']);
  });
});

// ── SECURITY: onboarding.ts must NOT contain process.env[ index access ──

describe('security constraint', () => {
  it('source code of onboarding.ts does NOT contain process.env[ index access', () => {
    const source = readFileSync(
      resolve(__dirname, 'onboarding.ts'),
      'utf-8',
    );
    // Must NOT have process.env[key] or process.env['KEY'] or process.env["KEY"]
    // The only allowed pattern is `key in process.env`
    const indexAccessPattern = /process\.env\[/;
    expect(source).not.toMatch(indexAccessPattern);
  });
});

// ── isPortOpen ─────────────────────────────────────────────────────────────

describe('isPortOpen', () => {
  it('returns true for a port with a listener', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const result = await isPortOpen(port, '127.0.0.1', 300);
      expect(result).toBe(true);
    } finally {
      server.close();
    }
  });

  it('returns false for a port with no listener', async () => {
    // Port 19999 is unlikely to have a listener
    const result = await isPortOpen(19999, '127.0.0.1', 300);
    expect(result).toBe(false);
  });

  it('returns false when timeout exceeded', async () => {
    // Use a very short timeout with a non-routable address
    const result = await isPortOpen(80, '192.0.2.1', 50);
    expect(result).toBe(false);
  });
});

// ── detectOpenPorts ────────────────────────────────────────────────────────

describe('detectOpenPorts', () => {
  it('returns array of ports that are open', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const result = await detectOpenPorts([port, 19998]);
      expect(result).toEqual([port]);
    } finally {
      server.close();
    }
  });

  it('returns empty array when no ports are open', async () => {
    const result = await detectOpenPorts([19996, 19997]);
    expect(result).toEqual([]);
  });

  it('probes all ports in parallel (completes quickly for 6 ports)', async () => {
    const start = Date.now();
    await detectOpenPorts([19990, 19991, 19992, 19993, 19994, 19995]);
    const elapsed = Date.now() - start;
    // With 300ms timeout in parallel, should be well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── buildDraftCard ─────────────────────────────────────────────────────────

describe('buildDraftCard', () => {
  it('returns a valid CapabilityCard for OPENAI_API_KEY', () => {
    const card = buildDraftCard('OPENAI_API_KEY', 'alice');
    expect(card).not.toBeNull();
    expect(card!.owner).toBe('alice');
    expect(card!.level).toBe(1);
    expect(card!.name).toContain('OpenAI');
  });

  it('returns a card with apis_used for ELEVENLABS_API_KEY', () => {
    const card = buildDraftCard('ELEVENLABS_API_KEY', 'bob');
    expect(card).not.toBeNull();
    expect(card!.metadata?.apis_used).toContain('elevenlabs');
  });

  it('returns null for unknown key', () => {
    const card = buildDraftCard('RANDOM_KEY', 'alice');
    expect(card).toBeNull();
  });

  it('generated card validates against CapabilityCardSchema', () => {
    const card = buildDraftCard('OPENAI_API_KEY', 'alice');
    expect(card).not.toBeNull();
    const result = CapabilityCardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('card has unique UUID id', () => {
    const card1 = buildDraftCard('OPENAI_API_KEY', 'alice');
    const card2 = buildDraftCard('OPENAI_API_KEY', 'alice');
    expect(card1!.id).not.toBe(card2!.id);
    // UUID format check
    expect(card1!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('card has spec_version 1.0 and online true', () => {
    const card = buildDraftCard('ANTHROPIC_API_KEY', 'carol');
    expect(card!.spec_version).toBe('1.0');
    expect(card!.availability.online).toBe(true);
  });

  it('card owner comes from parameter, not hardcoded', () => {
    const card = buildDraftCard('OPENAI_API_KEY', 'custom-owner');
    expect(card!.owner).toBe('custom-owner');
  });
});

// ── KNOWN_API_KEYS constant ────────────────────────────────────────────────

describe('KNOWN_API_KEYS', () => {
  it('contains at least the required keys', () => {
    const required = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'ELEVENLABS_API_KEY',
      'KLING_API_KEY',
      'STABILITY_API_KEY',
      'REPLICATE_API_TOKEN',
    ];
    for (const key of required) {
      expect(KNOWN_API_KEYS).toContain(key);
    }
  });
});

// ── API_TEMPLATES constant ─────────────────────────────────────────────────

describe('API_TEMPLATES', () => {
  it('has entry for each key in KNOWN_API_KEYS', () => {
    for (const key of KNOWN_API_KEYS) {
      expect(API_TEMPLATES[key]).toBeDefined();
    }
  });

  it('each template has required fields', () => {
    for (const key of KNOWN_API_KEYS) {
      const template = API_TEMPLATES[key]!;
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect([1, 2, 3]).toContain(template.level);
      expect(Array.isArray(template.inputs)).toBe(true);
      expect(Array.isArray(template.outputs)).toBe(true);
      expect(template.pricing.credits_per_call).toBeGreaterThanOrEqual(0);
      expect(template.metadata.apis_used).toBeDefined();
      expect(template.metadata.tags).toBeDefined();
    }
  });
});
