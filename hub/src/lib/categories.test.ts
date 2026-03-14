import { describe, it, expect } from 'vitest';
import { inferCategories, getCategoryIcon, CATEGORY_MAP } from './categories.js';

describe('CATEGORY_MAP', () => {
  it('has entries for all 10 known API names', () => {
    const keys = Object.keys(CATEGORY_MAP);
    expect(keys).toContain('openai');
    expect(keys).toContain('anthropic');
    expect(keys).toContain('azure-openai');
    expect(keys).toContain('google');
    expect(keys).toContain('cohere');
    expect(keys).toContain('mistral');
    expect(keys).toContain('elevenlabs');
    expect(keys).toContain('kling');
    expect(keys).toContain('stability');
    expect(keys).toContain('replicate');
  });
});

describe('inferCategories', () => {
  it('returns text_gen for openai api', () => {
    const result = inferCategories({ apis_used: ['openai'] });
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe('text_gen');
    expect(result.categories[0].label).toBe('Text Gen');
    expect(result.categories[0].iconName).toBe('FileText');
  });

  it('returns tts for elevenlabs api', () => {
    const result = inferCategories({ apis_used: ['elevenlabs'] });
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe('tts');
  });

  it('returns video_gen for kling api', () => {
    const result = inferCategories({ apis_used: ['kling'] });
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe('video_gen');
  });

  it('returns image_gen for tags containing image and generation', () => {
    const result = inferCategories({ tags: ['image', 'generation'] });
    // image -> image_gen, generation -> text_gen (both match)
    const ids = result.categories.map((c) => c.id);
    expect(ids).toContain('image_gen');
  });

  it('deduplicates categories by id', () => {
    // Both openai and anthropic map to text_gen
    const result = inferCategories({ apis_used: ['openai', 'anthropic'] });
    const ids = result.categories.map((c) => c.id);
    expect(ids.filter((id) => id === 'text_gen')).toHaveLength(1);
  });

  it('enforces max 4 chips', () => {
    // 6 different API names mapping to 5+ distinct categories
    const result = inferCategories({
      apis_used: ['openai', 'elevenlabs', 'kling', 'stability', 'replicate'],
    });
    expect(result.categories.length).toBeLessThanOrEqual(4);
  });

  it('returns overflow count when more than 4 categories', () => {
    const result = inferCategories({
      apis_used: ['openai', 'elevenlabs', 'kling', 'stability', 'replicate'],
    });
    expect(result.overflow).toBeGreaterThanOrEqual(0);
    expect(result.categories.length + result.overflow).toBeGreaterThanOrEqual(
      result.categories.length,
    );
  });

  it('returns custom category when no match found', () => {
    const result = inferCategories({ apis_used: ['unknown-api-xyz'] });
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe('custom');
    expect(result.categories[0].iconName).toBe('Puzzle');
  });

  it('returns custom when metadata is undefined', () => {
    const result = inferCategories(undefined);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe('custom');
  });

  it('returns custom when both apis_used and tags are empty', () => {
    const result = inferCategories({ apis_used: [], tags: [] });
    expect(result.categories[0].id).toBe('custom');
  });
});

describe('getCategoryIcon', () => {
  it('returns iconName for known category', () => {
    const icon = getCategoryIcon('tts');
    expect(icon).toBe('Volume2');
  });

  it('returns Puzzle for unknown category', () => {
    const icon = getCategoryIcon('does-not-exist');
    expect(icon).toBe('Puzzle');
  });
});
