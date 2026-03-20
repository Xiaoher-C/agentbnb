import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initEvolutionTable, insertEvolution, getLatestEvolution, getEvolutionHistory } from './store.js';
import type { TemplateEvolution } from './schema.js';

function makeEvolution(overrides?: Partial<TemplateEvolution>): TemplateEvolution {
  return {
    template_name: 'genesis-template',
    template_version: '1.0.0',
    publisher_agent: 'agent-test',
    changelog: 'Initial evolution',
    core_memory_snapshot: [
      { category: 'identity', importance: 0.9, content: 'I am a helpful agent' },
    ],
    fitness_improvement: 0.1,
    timestamp: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('evolution store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initEvolutionTable(db);
  });

  describe('insertEvolution', () => {
    it('returns a UUID string', () => {
      const id = insertEvolution(db, makeEvolution());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      // UUID v4 format
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('inserts a record that can be retrieved', () => {
      insertEvolution(db, makeEvolution());
      const latest = getLatestEvolution(db, 'genesis-template');
      expect(latest).not.toBeNull();
      expect(latest?.template_name).toBe('genesis-template');
    });

    it('serializes and deserializes core_memory_snapshot correctly', () => {
      const snapshot = [
        { category: 'values', importance: 0.8, content: 'honesty', scope: 'global' },
        { category: 'skills', importance: 0.6, content: 'coding' },
      ];
      insertEvolution(db, makeEvolution({ core_memory_snapshot: snapshot }));
      const latest = getLatestEvolution(db, 'genesis-template');
      expect(latest?.core_memory_snapshot).toEqual(snapshot);
    });
  });

  describe('getLatestEvolution', () => {
    it('returns null when no records exist', () => {
      const result = getLatestEvolution(db, 'genesis-template');
      expect(result).toBeNull();
    });

    it('returns null for an unknown template name', () => {
      insertEvolution(db, makeEvolution());
      const result = getLatestEvolution(db, 'unknown-template');
      expect(result).toBeNull();
    });

    it('returns the newest record when multiple exist', async () => {
      insertEvolution(db, makeEvolution({ template_version: '1.0.0', changelog: 'first' }));
      // Add a tiny delay to ensure different created_at timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      insertEvolution(db, makeEvolution({ template_version: '1.1.0', changelog: 'second' }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      insertEvolution(db, makeEvolution({ template_version: '1.2.0', changelog: 'third' }));

      const latest = getLatestEvolution(db, 'genesis-template');
      expect(latest?.template_version).toBe('1.2.0');
      expect(latest?.changelog).toBe('third');
    });

    it('returns correct fields', () => {
      const ev = makeEvolution({
        fitness_improvement: 0.42,
        publisher_agent: 'agent-xyz',
      });
      insertEvolution(db, ev);
      const result = getLatestEvolution(db, 'genesis-template');
      expect(result?.fitness_improvement).toBe(0.42);
      expect(result?.publisher_agent).toBe('agent-xyz');
      expect(result?.timestamp).toBe('2026-03-21T10:00:00.000Z');
    });
  });

  describe('getEvolutionHistory', () => {
    it('returns empty array when no records exist', () => {
      const history = getEvolutionHistory(db, 'genesis-template');
      expect(history).toEqual([]);
    });

    it('returns all records ordered newest first', async () => {
      for (let i = 1; i <= 3; i++) {
        insertEvolution(db, makeEvolution({ template_version: `1.${i}.0`, changelog: `v${i}` }));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const history = getEvolutionHistory(db, 'genesis-template');
      expect(history).toHaveLength(3);
      expect(history[0]?.template_version).toBe('1.3.0');
      expect(history[1]?.template_version).toBe('1.2.0');
      expect(history[2]?.template_version).toBe('1.1.0');
    });

    it('respects the limit parameter', () => {
      for (let i = 1; i <= 5; i++) {
        insertEvolution(db, makeEvolution({ template_version: `1.${i}.0` }));
      }
      const history = getEvolutionHistory(db, 'genesis-template', 3);
      expect(history).toHaveLength(3);
    });

    it('only returns records for the specified template name', () => {
      insertEvolution(db, makeEvolution({ template_name: 'genesis-template' }));
      insertEvolution(db, makeEvolution({ template_name: 'other-template' }));

      const genesisHistory = getEvolutionHistory(db, 'genesis-template');
      const otherHistory = getEvolutionHistory(db, 'other-template');

      expect(genesisHistory).toHaveLength(1);
      expect(genesisHistory[0]?.template_name).toBe('genesis-template');
      expect(otherHistory).toHaveLength(1);
      expect(otherHistory[0]?.template_name).toBe('other-template');
    });
  });
});
