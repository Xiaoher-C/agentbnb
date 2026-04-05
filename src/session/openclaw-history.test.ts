import { describe, it, expect } from 'vitest';
import { OpenClawConversationHistory } from './openclaw-history.js';

describe('OpenClawConversationHistory', () => {
  it('add() accumulates messages', () => {
    const history = new OpenClawConversationHistory();
    history.add('user', 'hello');
    history.add('assistant', 'hi there');
    expect(history.length).toBe(2);
  });

  it('length tracks message count', () => {
    const history = new OpenClawConversationHistory();
    expect(history.length).toBe(0);
    history.add('user', 'one');
    expect(history.length).toBe(1);
    history.add('assistant', 'two');
    expect(history.length).toBe(2);
    history.add('user', 'three');
    expect(history.length).toBe(3);
  });

  it('buildPrompt() formats as User/Assistant with double newlines', () => {
    const history = new OpenClawConversationHistory();
    history.add('user', 'What is 2+2?');
    history.add('assistant', '4');
    const prompt = history.buildPrompt();
    expect(prompt).toBe('User: What is 2+2?\n\nAssistant: 4');
  });

  it('needsCompression() returns true when over threshold', () => {
    const history = new OpenClawConversationHistory({ compressThreshold: 3 });
    history.add('user', 'a');
    history.add('assistant', 'b');
    history.add('user', 'c');
    expect(history.needsCompression()).toBe(false);
    history.add('assistant', 'd');
    expect(history.needsCompression()).toBe(true);
  });

  it('compress() replaces early messages with summary', async () => {
    const history = new OpenClawConversationHistory({ compressThreshold: 3 });
    history.add('user', 'msg1');
    history.add('assistant', 'msg2');
    history.add('user', 'msg3');
    history.add('assistant', 'msg4');

    const mockSummarizer = async (text: string): Promise<string> =>
      `Summary of ${text.split('\n').length} lines`;

    await history.compress(mockSummarizer);

    const messages = history.getMessages();
    // Split at floor(4/2) = 2, so 2 early replaced by 1 summary + 2 kept = 3
    expect(messages.length).toBe(3);
    expect(messages[0]!.role).toBe('assistant');
    expect(messages[0]!.content).toContain('[Earlier conversation summary:');
    expect(messages[0]!.content).toContain('Summary of 2 lines');
    // Last two original messages preserved
    expect(messages[1]!.content).toBe('msg3');
    expect(messages[2]!.content).toBe('msg4');
  });

  it('compress() does nothing when below threshold', async () => {
    const history = new OpenClawConversationHistory({ compressThreshold: 10 });
    history.add('user', 'hello');
    history.add('assistant', 'hi');

    const mockSummarizer = async (_text: string): Promise<string> => 'should not be called';

    await history.compress(mockSummarizer);
    expect(history.length).toBe(2);
  });

  it('getSummary() returns brief description', () => {
    const history = new OpenClawConversationHistory();
    history.add('user', 'What time is it?');
    history.add('assistant', 'It is noon.');
    const summary = history.getSummary();
    expect(summary).toBe('2 messages. Last: assistant said "It is noon."');
  });

  it('getSummary() handles empty history', () => {
    const history = new OpenClawConversationHistory();
    expect(history.getSummary()).toBe('No messages exchanged.');
  });

  it('getSummary() truncates long last message to 100 chars', () => {
    const history = new OpenClawConversationHistory();
    const longMsg = 'x'.repeat(200);
    history.add('user', longMsg);
    const summary = history.getSummary();
    expect(summary).toContain('x'.repeat(100));
    expect(summary).not.toContain('x'.repeat(101));
  });

  it('getMessages() returns copy, not reference', () => {
    const history = new OpenClawConversationHistory();
    history.add('user', 'hello');
    const messages1 = history.getMessages();
    const messages2 = history.getMessages();
    expect(messages1).toEqual(messages2);
    expect(messages1).not.toBe(messages2);
    // Mutating the returned array should not affect internal state
    (messages1 as { role: string; content: string }[]).push({
      role: 'user',
      content: 'injected',
    });
    expect(history.length).toBe(1);
  });

  it('uses default config values when none provided', () => {
    const history = new OpenClawConversationHistory();
    // Default compressThreshold is 10, so 10 messages should not trigger
    for (let i = 0; i < 10; i++) {
      history.add(i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
    }
    expect(history.needsCompression()).toBe(false);
    history.add('user', 'msg10');
    expect(history.needsCompression()).toBe(true);
  });
});
