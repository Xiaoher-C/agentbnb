// ---------------------------------------------------------------------------
// OpenClaw Conversation History — standalone conversation buffer with
// compression support for long-running OpenClaw session execution.
// ---------------------------------------------------------------------------

/** A single message in an OpenClaw conversation. */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Manages conversation history for OpenClaw session execution.
 *
 * Tracks messages, builds formatted prompts, and supports compression
 * of early messages via an injected summarizer to keep context windows
 * manageable during long-running sessions.
 */
export class OpenClawConversationHistory {
  private messages: ConversationMessage[] = [];
  private maxMessages: number;
  private compressThreshold: number;

  constructor(config?: { maxMessages?: number; compressThreshold?: number }) {
    this.maxMessages = config?.maxMessages ?? 20;
    this.compressThreshold = config?.compressThreshold ?? 10;
  }

  /** Current number of messages in history. */
  get length(): number {
    return this.messages.length;
  }

  /** Add a message to the conversation history. */
  add(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
  }

  /** Format a single message as `User: ...` or `Assistant: ...`. */
  private formatMessage(m: ConversationMessage): string {
    return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
  }

  /** Check if history exceeds the compress threshold. */
  needsCompression(): boolean {
    return this.messages.length > this.compressThreshold;
  }

  /**
   * Compress early messages using an injected summarizer function.
   *
   * Keeps the last half of messages and replaces early ones with a
   * single summary message. Does nothing if below the compress threshold.
   */
  async compress(summarizer: (text: string) => Promise<string>): Promise<void> {
    if (this.messages.length <= this.compressThreshold) return;

    const splitPoint = Math.floor(this.messages.length / 2);
    const earlyMessages = this.messages.slice(0, splitPoint);
    const earlyText = earlyMessages
      .map((m) => this.formatMessage(m))
      .join('\n');

    const summary = await summarizer(earlyText);
    this.messages = [
      { role: 'assistant', content: `[Earlier conversation summary: ${summary}]` },
      ...this.messages.slice(splitPoint),
    ];
  }

  /** Build a formatted prompt string from conversation history. */
  buildPrompt(): string {
    return this.messages
      .map((m) => this.formatMessage(m))
      .join('\n\n');
  }

  /** Get a brief summary string of the conversation. */
  getSummary(): string {
    const count = this.messages.length;
    if (count === 0) return 'No messages exchanged.';
    const last = this.messages[count - 1]!;
    return `${count} messages. Last: ${last.role} said "${last.content.slice(0, 100)}"`;
  }

  /** Get all messages (read-only copy). */
  getMessages(): ReadonlyArray<ConversationMessage> {
    return [...this.messages];
  }
}
