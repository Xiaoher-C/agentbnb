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
});
