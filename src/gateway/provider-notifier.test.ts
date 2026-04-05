import { describe, it, expect } from 'vitest';
import { formatEventMessage } from './provider-notifier.js';
import type { ProviderEvent } from '../registry/provider-events.js';

function makeEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id: 'evt-1',
    event_type: 'skill.executed',
    skill_id: 'kb-search',
    session_id: null,
    requester: 'agent-test',
    credits: 2,
    duration_ms: 1500,
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('formatEventMessage', () => {
  it('formats skill.received', () => {
    const msg = formatEventMessage(makeEvent({ event_type: 'skill.received', credits: 3 }));
    expect(msg).toContain('📥');
    expect(msg).toContain('Incoming request');
    expect(msg).toContain('kb-search');
    expect(msg).toContain('agent-test');
    expect(msg).toContain('3 credits');
  });

  it('formats skill.executed with balance', () => {
    const msg = formatEventMessage(makeEvent({ event_type: 'skill.executed', credits: 5 }), 100);
    expect(msg).toContain('✅');
    expect(msg).toContain('Skill executed');
    expect(msg).toContain('+5 credits');
    expect(msg).toContain('Balance: 100');
    expect(msg).toContain('1500ms');
  });

  it('formats skill.executed without balance', () => {
    const msg = formatEventMessage(makeEvent({ event_type: 'skill.executed' }));
    expect(msg).not.toContain('Balance');
  });

  it('formats skill.failed', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'skill.failed',
      metadata: { failure_reason: 'timeout', error: 'Process timed out' },
    }));
    expect(msg).toContain('❌');
    expect(msg).toContain('Skill failed');
    expect(msg).toContain('timeout');
    expect(msg).toContain('Process timed out');
  });

  it('formats skill.rejected', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'skill.rejected',
      metadata: { reason: 'daily_limit' },
    }));
    expect(msg).toContain('🚫');
    expect(msg).toContain('rejected');
    expect(msg).toContain('daily_limit');
  });

  it('formats session.opened', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'session.opened',
      session_id: 'abcdefgh-1234',
      credits: 20,
      metadata: { pricing_model: 'per_message' },
    }));
    expect(msg).toContain('🔗');
    expect(msg).toContain('Session opened');
    expect(msg).toContain('abcdefgh');
    expect(msg).toContain('per_message');
    expect(msg).toContain('20 credits');
  });

  it('formats session.message', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'session.message',
      session_id: 'abcdefgh-1234',
      metadata: { message_count: 5, running_cost: 5 },
    }));
    expect(msg).toContain('💬');
    expect(msg).toContain('#5');
    expect(msg).toContain('5 credits');
  });

  it('formats session.ended', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'session.ended',
      session_id: 'abcdefgh-1234',
      credits: 8,
      duration_ms: 720000,
      metadata: { total_messages: 10, refunded: 12 },
    }));
    expect(msg).toContain('🏁');
    expect(msg).toContain('Session ended');
    expect(msg).toContain('10 messages');
    expect(msg).toContain('8 credits');
    expect(msg).toContain('12 minutes');
    expect(msg).toContain('Refunded: 12');
  });

  it('formats session.failed with last_messages', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'session.failed',
      session_id: 'abcdefgh-1234',
      metadata: {
        reason: 'error',
        last_messages: [
          { sender: 'requester', content: 'Analyze this code' },
          { sender: 'provider', content: 'Looking at the file...' },
          { sender: 'requester', content: 'What about the bug?' },
        ],
      },
    }));
    expect(msg).toContain('💥');
    expect(msg).toContain('Session failed');
    expect(msg).toContain('Last messages:');
    expect(msg).toContain('requester: Analyze this code');
    expect(msg).toContain('provider: Looking at the file');
  });

  it('formats session.failed without last_messages', () => {
    const msg = formatEventMessage(makeEvent({
      event_type: 'session.failed',
      session_id: 'abcdefgh-1234',
      metadata: { reason: 'timeout' },
    }));
    expect(msg).toContain('💥');
    expect(msg).toContain('timeout');
    expect(msg).not.toContain('Last messages');
  });
});
