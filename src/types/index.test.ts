import { describe, it, expect } from 'vitest';
import { CapabilityCardSchema } from './index.js';
import { randomUUID } from 'crypto';

describe('CapabilityCardSchema', () => {
  const validCard = {
    id: randomUUID(),
    owner: 'chengwen@leyang',
    name: 'ElevenLabs TTS',
    description: 'Text-to-speech via ElevenLabs API',
    level: 1 as const,
    inputs: [{ name: 'text', type: 'text' as const, required: true }],
    outputs: [{ name: 'audio', type: 'audio' as const, required: true }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {
      apis_used: ['elevenlabs'],
      avg_latency_ms: 2000,
      success_rate: 0.98,
    },
  };

  // spec_version tests
  describe('spec_version field', () => {
    it('Test 1: card with spec_version 1.0 validates successfully', () => {
      const card = { ...validCard, spec_version: '1.0' };
      const result = CapabilityCardSchema.safeParse(card);
      expect(result.success).toBe(true);
    });

    it('Test 2: card WITHOUT spec_version validates successfully (default fills 1.0)', () => {
      // validCard has no spec_version — legacy Phase 0 card
      const result = CapabilityCardSchema.safeParse(validCard);
      expect(result.success).toBe(true);
    });

    it('Test 3: card with spec_version 2.0 is rejected', () => {
      const card = { ...validCard, spec_version: '2.0' };
      const result = CapabilityCardSchema.safeParse(card);
      expect(result.success).toBe(false);
    });

    it('Test 4: parsed card always has spec_version 1.0 in output regardless of input', () => {
      // With spec_version provided
      const withVersion = CapabilityCardSchema.parse({ ...validCard, spec_version: '1.0' });
      expect(withVersion.spec_version).toBe('1.0');

      // Without spec_version (default fills it)
      const withoutVersion = CapabilityCardSchema.parse({ ...validCard });
      expect(withoutVersion.spec_version).toBe('1.0');
    });
  });

  it('validates a correct L1 Atomic card', () => {
    const result = CapabilityCardSchema.safeParse(validCard);
    expect(result.success).toBe(true);
  });

  it('rejects a card without owner', () => {
    const bad = { ...validCard, owner: '' };
    const result = CapabilityCardSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid level', () => {
    const bad = { ...validCard, level: 4 };
    const result = CapabilityCardSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts L2 Pipeline card', () => {
    const pipeline = {
      ...validCard,
      level: 2 as const,
      name: 'Text-to-Video Pipeline',
      description: 'Text → Voice → Video',
      inputs: [{ name: 'script', type: 'text' as const, required: true }],
      outputs: [{ name: 'video', type: 'video' as const, required: true }],
      metadata: { apis_used: ['elevenlabs', 'kling'], tags: ['creative'] },
    };
    const result = CapabilityCardSchema.safeParse(pipeline);
    expect(result.success).toBe(true);
  });

  it('validates a correct L3 Environment card', () => {
    const envCard = {
      ...validCard,
      id: randomUUID(),
      level: 3 as const,
      name: 'Full OpenClaw Environment',
      description: 'Complete deployment with all dependencies for OpenClaw agents',
      inputs: [
        { name: 'task', type: 'json' as const, required: true },
        { name: 'context', type: 'json' as const, required: false },
      ],
      outputs: [
        { name: 'result', type: 'json' as const, required: true },
        { name: 'logs', type: 'stream' as const, required: false },
      ],
      pricing: { credits_per_call: 100, credits_per_minute: 10 },
      availability: { online: true, schedule: '0 9-17 * * 1-5' },
      metadata: {
        apis_used: ['openai', 'elevenlabs', 'kling'],
        avg_latency_ms: 30000,
        success_rate: 0.95,
        tags: ['environment', 'full-stack', 'openclaw'],
      },
    };
    const result = CapabilityCardSchema.safeParse(envCard);
    expect(result.success).toBe(true);
  });

  it('rejects a card with missing id field', () => {
    const { id: _id, ...withoutId } = validCard;
    const result = CapabilityCardSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects a card with non-UUID id', () => {
    const bad = { ...validCard, id: 'not-a-uuid' };
    const result = CapabilityCardSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a card with negative credits_per_call', () => {
    const bad = { ...validCard, pricing: { credits_per_call: -5 } };
    const result = CapabilityCardSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
