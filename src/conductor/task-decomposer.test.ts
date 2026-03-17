import { describe, it, expect } from 'vitest';
import { decompose, TEMPLATES } from './task-decomposer.js';
import type { SubTask } from './types.js';

describe('TaskDecomposer', () => {
  describe('TEMPLATES', () => {
    it('exports 3 templates', () => {
      expect(Object.keys(TEMPLATES)).toHaveLength(3);
      expect(TEMPLATES).toHaveProperty('video-production');
      expect(TEMPLATES).toHaveProperty('deep-analysis');
      expect(TEMPLATES).toHaveProperty('content-generation');
    });
  });

  describe('decompose() — video production', () => {
    it('decomposes a video production task into 4 subtasks', () => {
      const result = decompose('Make a 30-second product demo video');
      expect(result).toHaveLength(4);
    });

    it('returns subtasks with correct required_capability types', () => {
      const result = decompose('Make a 30-second product demo video');
      const capabilities = result.map((t) => t.required_capability);
      expect(capabilities).toEqual(['text_gen', 'tts', 'video_gen', 'video_edit']);
    });

    it('models correct DAG dependencies — steps 2+3 depend on step 1, step 4 depends on 2+3', () => {
      const result = decompose('Make a 30-second product demo video');
      // Step 1 (script) has no deps
      expect(result[0].depends_on).toEqual([]);
      // Step 2 (voiceover) depends on step 1
      expect(result[1].depends_on).toEqual([result[0].id]);
      // Step 3 (video) depends on step 1
      expect(result[2].depends_on).toEqual([result[0].id]);
      // Step 4 (composite) depends on steps 2 and 3
      expect(result[3].depends_on).toEqual([result[1].id, result[2].id]);
    });

    it('returns subtasks with all required SubTask fields', () => {
      const result = decompose('Create a demo clip');
      for (const task of result) {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('required_capability');
        expect(task).toHaveProperty('params');
        expect(task).toHaveProperty('depends_on');
        expect(task).toHaveProperty('estimated_credits');
        expect(typeof task.id).toBe('string');
        expect(task.id.length).toBeGreaterThan(0);
        expect(typeof task.estimated_credits).toBe('number');
        expect(task.estimated_credits).toBeGreaterThan(0);
      }
    });
  });

  describe('decompose() — deep analysis', () => {
    it('decomposes an analysis task into 4 subtasks', () => {
      const result = decompose('Analyze AAPL stock trends in depth');
      expect(result).toHaveLength(4);
    });

    it('returns sequential dependency chain', () => {
      const result = decompose('Analyze AAPL stock trends in depth');
      expect(result[0].depends_on).toEqual([]);
      expect(result[1].depends_on).toEqual([result[0].id]);
      expect(result[2].depends_on).toEqual([result[1].id]);
      expect(result[3].depends_on).toEqual([result[2].id]);
    });

    it('uses correct capabilities for analysis pipeline', () => {
      const result = decompose('Research and evaluate market conditions');
      const capabilities = result.map((t) => t.required_capability);
      expect(capabilities).toEqual(['web_search', 'text_gen', 'text_gen', 'text_gen']);
    });
  });

  describe('decompose() — content generation', () => {
    it('decomposes a content task into 4 subtasks', () => {
      const result = decompose('Write a blog post about AI agents');
      expect(result).toHaveLength(4);
    });

    it('returns sequential dependency chain', () => {
      const result = decompose('Write a blog post about AI agents');
      expect(result[0].depends_on).toEqual([]);
      expect(result[1].depends_on).toEqual([result[0].id]);
      expect(result[2].depends_on).toEqual([result[1].id]);
      expect(result[3].depends_on).toEqual([result[2].id]);
    });

    it('matches on various content keywords', () => {
      for (const keyword of ['article', 'essay', 'post', 'content']) {
        const result = decompose(`Create a ${keyword} about testing`);
        expect(result.length).toBe(4);
      }
    });
  });

  describe('decompose() — unrecognized tasks', () => {
    it('returns empty array for unrecognized task descriptions', () => {
      expect(decompose('Something totally unrelated')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(decompose('')).toEqual([]);
    });
  });

  describe('decompose() — case insensitivity', () => {
    it('matches keywords case-insensitively', () => {
      const upper = decompose('ANALYZE the data');
      const lower = decompose('analyze the data');
      expect(upper).toHaveLength(lower.length);
    });
  });

  describe('decompose() — unique IDs', () => {
    it('generates unique IDs for each subtask', () => {
      const result = decompose('Make a video demo');
      const ids = result.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('generates different IDs across calls', () => {
      const r1 = decompose('Make a video demo');
      const r2 = decompose('Make a video demo');
      // At least the first ID should differ (UUIDs)
      expect(r1[0].id).not.toBe(r2[0].id);
    });
  });
});
