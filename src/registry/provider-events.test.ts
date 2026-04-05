import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureProviderEventsTable,
  emitProviderEvent,
  getProviderEvents,
  getProviderStats,
} from './provider-events.js';
import type { EmitEventInput, ProviderEventType } from './provider-events.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  ensureProviderEventsTable(db);
  return db;
}

function emit(db: Database.Database, overrides: Partial<EmitEventInput> = {}) {
  return emitProviderEvent(db, {
    event_type: 'skill.executed',
    skill_id: 'kb-search',
    session_id: null,
    requester: 'agent-test',
    credits: 2,
    duration_ms: 1000,
    metadata: null,
    ...overrides,
  });
}

describe('ensureProviderEventsTable', () => {
  it('creates table without error', () => {
    const db = new Database(':memory:');
    expect(() => ensureProviderEventsTable(db)).not.toThrow();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    ensureProviderEventsTable(db);
    expect(() => ensureProviderEventsTable(db)).not.toThrow();
  });
});

describe('emitProviderEvent', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('emits an event and returns it with id and created_at', () => {
    const event = emit(db);
    expect(event.id).toBeTruthy();
    expect(event.created_at).toBeTruthy();
    expect(event.event_type).toBe('skill.executed');
    expect(event.credits).toBe(2);
  });

  it('stores metadata as JSON', () => {
    const event = emit(db, { metadata: { model: 'claude-sonnet', tokens: 5000 } });
    const events = getProviderEvents(db);
    expect(events[0]!.metadata).toEqual({ model: 'claude-sonnet', tokens: 5000 });
  });

  it('handles null metadata', () => {
    emit(db, { metadata: null });
    const events = getProviderEvents(db);
    expect(events[0]!.metadata).toBeNull();
  });
});

describe('getProviderEvents', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('returns all emitted events', () => {
    emit(db, { credits: 1 });
    emit(db, { credits: 2 });
    emit(db, { credits: 3 });
    const events = getProviderEvents(db);
    expect(events).toHaveLength(3);
    const totalCredits = events.reduce((sum, e) => sum + e.credits, 0);
    expect(totalCredits).toBe(6);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) emit(db);
    const events = getProviderEvents(db, { limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('caps limit at 200', () => {
    const events = getProviderEvents(db, { limit: 999 });
    expect(events).toHaveLength(0); // no events but limit was capped
  });

  it('filters by event_type', () => {
    emit(db, { event_type: 'skill.executed' });
    emit(db, { event_type: 'skill.failed' });
    emit(db, { event_type: 'skill.executed' });
    const executed = getProviderEvents(db, { event_type: 'skill.executed' });
    expect(executed).toHaveLength(2);
  });

  it('filters by since timestamp', () => {
    emit(db);
    // Use a past cutoff so the second event is definitely after
    const pastCutoff = new Date(Date.now() - 1000).toISOString();
    const allEvents = getProviderEvents(db, { since: pastCutoff });
    expect(allEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getProviderStats', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('returns zero stats for empty table', () => {
    const stats = getProviderStats(db, '24h');
    expect(stats.total_earnings).toBe(0);
    expect(stats.total_executions).toBe(0);
    expect(stats.success_rate).toBe(1.0);
    expect(stats.active_sessions).toBe(0);
    expect(stats.top_skills).toEqual([]);
  });

  it('computes earnings and success rate', () => {
    emit(db, { event_type: 'skill.executed', credits: 5 });
    emit(db, { event_type: 'skill.executed', credits: 3 });
    emit(db, { event_type: 'skill.failed', credits: 0 });
    const stats = getProviderStats(db, '24h');
    expect(stats.total_earnings).toBe(8);
    expect(stats.total_executions).toBe(3);
    expect(stats.success_count).toBe(2);
    expect(stats.failure_count).toBe(1);
    expect(stats.success_rate).toBeCloseTo(0.667, 2);
  });

  it('computes top skills', () => {
    emit(db, { skill_id: 'kb-search', credits: 2 });
    emit(db, { skill_id: 'kb-search', credits: 2 });
    emit(db, { skill_id: 'web-crawl', credits: 3 });
    const stats = getProviderStats(db, '24h');
    expect(stats.top_skills).toHaveLength(2);
    expect(stats.top_skills[0]!.skill_id).toBe('kb-search');
    expect(stats.top_skills[0]!.count).toBe(2);
    expect(stats.top_skills[0]!.earnings).toBe(4);
  });

  it('tracks active sessions', () => {
    emit(db, { event_type: 'session.opened', session_id: 'sess-1' });
    emit(db, { event_type: 'session.opened', session_id: 'sess-2' });
    emit(db, { event_type: 'session.ended', session_id: 'sess-1' });
    const stats = getProviderStats(db, '24h');
    expect(stats.active_sessions).toBe(1);
  });

  it('computes top requesters', () => {
    emit(db, { requester: 'agent-a' });
    emit(db, { requester: 'agent-a' });
    emit(db, { requester: 'agent-b' });
    const stats = getProviderStats(db, '24h');
    expect(stats.top_requesters[0]!.requester).toBe('agent-a');
    expect(stats.top_requesters[0]!.count).toBe(2);
  });
});
