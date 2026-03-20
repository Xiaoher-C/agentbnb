import { describe, it, expect } from 'vitest';
import { StructuredFeedbackSchema } from './schema.js';

const validFeedback = {
  transaction_id: '00000000-0000-4000-8000-000000000001',
  provider_agent: 'agent-alpha',
  skill_id: 'tts-elevenlabs',
  requester_agent: 'agent-beta',
  rating: 5,
  latency_ms: 1200,
  result_quality: 'excellent',
  would_reuse: true,
  cost_value_ratio: 'great',
  timestamp: '2026-03-21T10:00:00.000Z',
};

describe('StructuredFeedbackSchema', () => {
  it('accepts a fully valid feedback object', () => {
    const result = StructuredFeedbackSchema.safeParse(validFeedback);
    expect(result.success).toBe(true);
  });

  it('accepts feedback with optional quality_details', () => {
    const result = StructuredFeedbackSchema.safeParse({
      ...validFeedback,
      quality_details: 'Very fast and accurate.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { transaction_id: _, ...withoutId } = validFeedback;
    const result = StructuredFeedbackSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects rating below 1', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, rating: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects rating above 5', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, rating: 6 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer rating', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, rating: 3.5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid result_quality value', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, result_quality: 'mediocre' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid result_quality values', () => {
    const qualities = ['excellent', 'good', 'acceptable', 'poor', 'failed'];
    for (const q of qualities) {
      const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, result_quality: q });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid cost_value_ratio', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, cost_value_ratio: 'cheap' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid cost_value_ratio values', () => {
    const ratios = ['great', 'fair', 'overpriced'];
    for (const r of ratios) {
      const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, cost_value_ratio: r });
      expect(result.success).toBe(true);
    }
  });

  it('rejects non-UUID transaction_id', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, transaction_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects negative latency_ms', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, latency_ms: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts latency_ms of zero', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, latency_ms: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects quality_details exceeding 500 characters', () => {
    const result = StructuredFeedbackSchema.safeParse({
      ...validFeedback,
      quality_details: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty provider_agent', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, provider_agent: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty skill_id', () => {
    const result = StructuredFeedbackSchema.safeParse({ ...validFeedback, skill_id: '' });
    expect(result.success).toBe(false);
  });
});
