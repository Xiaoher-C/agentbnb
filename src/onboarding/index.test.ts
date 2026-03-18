import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectCapabilities, capabilitiesToV2Card } from './index.js';
import { CapabilityCardV2Schema } from '../types/index.js';

describe('detectCapabilities', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-onboard-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns source=none when no docs or env vars found', () => {
    // Clear known API key env vars so env detection doesn't fire
    const keysToClean = [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY',
      'KLING_API_KEY', 'STABILITY_API_KEY', 'REPLICATE_API_TOKEN',
      'GOOGLE_API_KEY', 'AZURE_OPENAI_API_KEY', 'COHERE_API_KEY', 'MISTRAL_API_KEY',
    ];
    const saved: Record<string, string | undefined> = {};
    for (const k of keysToClean) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const result = detectCapabilities({ cwd: tmpDir });
      expect(result.source).toBe('none');
      expect(result.capabilities).toEqual([]);
    } finally {
      for (const k of keysToClean) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
      }
    }
  });

  it('detects SOUL.md and returns source=soul with content', () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), '# TestAgent\nDescription\n## TTS\nText to speech');
    const result = detectCapabilities({ cwd: tmpDir });
    expect(result.source).toBe('soul');
    expect(result.soulContent).toContain('TestAgent');
    expect(result.sourceFile).toContain('SOUL.md');
  });

  it('detects CLAUDE.md with API mentions', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# My Agent\nUses GPT-4 and ElevenLabs for voice.');
    const result = detectCapabilities({ cwd: tmpDir });
    expect(result.source).toBe('docs');
    expect(result.capabilities).toHaveLength(2);
    const keys = result.capabilities.map((c) => c.key);
    expect(keys).toContain('openai');
    expect(keys).toContain('elevenlabs');
  });

  it('falls through to AGENTS.md when CLAUDE.md absent', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'), 'This agent uses Recraft for image generation.');
    const result = detectCapabilities({ cwd: tmpDir });
    expect(result.source).toBe('docs');
    expect(result.capabilities[0]!.key).toBe('recraft');
  });

  it('falls through to README.md when no other docs found', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'Built with Puppeteer for web scraping.');
    const result = detectCapabilities({ cwd: tmpDir });
    expect(result.source).toBe('docs');
    expect(result.capabilities[0]!.key).toBe('puppeteer');
  });

  it('SOUL.md takes priority over CLAUDE.md', () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), '# Agent\nDesc\n## Skill\nSomething');
    writeFileSync(join(tmpDir, 'CLAUDE.md'), 'Uses GPT-4 for code review');
    const result = detectCapabilities({ cwd: tmpDir });
    expect(result.source).toBe('soul');
  });

  it('skips docs with no detectable patterns', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), 'A simple todo app with no AI.');
    const result = detectCapabilities({ cwd: tmpDir });
    // Falls through to env or none
    expect(result.source === 'env' || result.source === 'none').toBe(true);
  });

  it('--from flag reads specified file', () => {
    const customFile = join(tmpDir, 'custom-skills.md');
    writeFileSync(customFile, 'Uses ElevenLabs and FFmpeg for media pipeline.');
    const result = detectCapabilities({ fromFile: customFile });
    expect(result.source).toBe('docs');
    expect(result.capabilities).toHaveLength(2);
    const keys = result.capabilities.map((c) => c.key);
    expect(keys).toContain('elevenlabs');
    expect(keys).toContain('ffmpeg');
  });

  it('--from flag returns none when file has no patterns', () => {
    const customFile = join(tmpDir, 'empty.md');
    writeFileSync(customFile, 'Nothing useful here.');
    const result = detectCapabilities({ fromFile: customFile });
    expect(result.source).toBe('none');
  });

  it('--from flag returns none when file does not exist', () => {
    const result = detectCapabilities({ fromFile: join(tmpDir, 'nonexistent.md') });
    expect(result.source).toBe('none');
  });
});

describe('capabilitiesToV2Card', () => {
  it('produces a valid v2.0 card from a single capability', () => {
    const card = capabilitiesToV2Card(
      [{ key: 'openai', name: 'OpenAI Text Generation', category: 'Text Gen', credits_per_call: 3, tags: ['llm'] }],
      'test-owner',
    );
    expect(card.spec_version).toBe('2.0');
    expect(card.owner).toBe('test-owner');
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]!.id).toBe('openai');
    expect(card.skills[0]!.pricing.credits_per_call).toBe(3);
    // Must pass Zod validation
    expect(() => CapabilityCardV2Schema.parse(card)).not.toThrow();
  });

  it('produces multiple skills from multiple capabilities', () => {
    const card = capabilitiesToV2Card(
      [
        { key: 'openai', name: 'OpenAI', category: 'Text Gen', credits_per_call: 3, tags: ['llm'] },
        { key: 'elevenlabs', name: 'ElevenLabs TTS', category: 'TTS', credits_per_call: 5, tags: ['tts'] },
        { key: 'ffmpeg', name: 'FFmpeg', category: 'Media Processing', credits_per_call: 3, tags: ['media'] },
      ],
      'multi-agent',
      'My Multi Agent',
    );
    expect(card.skills).toHaveLength(3);
    expect(card.agent_name).toBe('My Multi Agent');
    expect(card.skills.map((s) => s.id)).toEqual(['openai', 'elevenlabs', 'ffmpeg']);
    expect(() => CapabilityCardV2Schema.parse(card)).not.toThrow();
  });

  it('defaults agent_name to owner when not provided', () => {
    const card = capabilitiesToV2Card(
      [{ key: 'openai', name: 'OpenAI', category: 'Text Gen', credits_per_call: 3, tags: [] }],
      'my-owner',
    );
    expect(card.agent_name).toBe('my-owner');
  });

  it('sets availability to online', () => {
    const card = capabilitiesToV2Card(
      [{ key: 'openai', name: 'OpenAI', category: 'Text Gen', credits_per_call: 3, tags: [] }],
      'owner',
    );
    expect(card.availability.online).toBe(true);
  });

  it('normalizes category to snake_case', () => {
    const card = capabilitiesToV2Card(
      [{ key: 'test', name: 'Test', category: 'Media Processing', credits_per_call: 3, tags: [] }],
      'owner',
    );
    expect(card.skills[0]!.category).toBe('media_processing');
  });
});
