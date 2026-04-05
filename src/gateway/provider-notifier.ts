import type Database from 'better-sqlite3';
import { loadConfig } from '../cli/config.js';
import { getBalance } from '../credit/ledger.js';
import type { ProviderEvent, ProviderEventType } from '../registry/provider-events.js';

/**
 * Unified provider event notifier.
 *
 * Sends Telegram messages for provider events, respecting:
 * - telegram_notifications config (must be true)
 * - provider_gate config ('notify' enables pre-execution alerts)
 * - notification_filters config (suppresses specified event types)
 *
 * Designed to be the single Telegram integration point for all provider events
 * (skill + session). Consumers (Kizuna, Hub) read from provider_events table directly.
 */

/** Emoji prefix for each event type. */
const EVENT_EMOJI: Record<ProviderEventType, string> = {
  'skill.received': '📥',
  'skill.executed': '✅',
  'skill.failed': '❌',
  'skill.rejected': '🚫',
  'session.opened': '🔗',
  'session.message': '💬',
  'session.ended': '🏁',
  'session.failed': '💥',
};

/**
 * Format a provider event into a Telegram notification message.
 *
 * @param event - The provider event to format.
 * @param balance - Current credit balance (optional, shown when available).
 * @returns Formatted message string.
 */
export function formatEventMessage(event: ProviderEvent, balance?: number): string {
  const emoji = EVENT_EMOJI[event.event_type] ?? '📋';
  const meta = event.metadata ?? {};
  const skillLabel = event.skill_id ?? 'unknown';

  switch (event.event_type) {
    case 'skill.received':
      return [
        `${emoji} [AgentBnB] Incoming request`,
        `Skill: ${skillLabel}`,
        `Requester: ${event.requester}`,
        `Cost: ${event.credits} credits`,
        `Status: Executing...`,
      ].join('\n');

    case 'skill.executed':
      return [
        `${emoji} [AgentBnB] Skill executed`,
        `Skill: ${skillLabel}`,
        `Requester: ${event.requester}`,
        `Earned: +${event.credits} credits`,
        ...(balance !== undefined ? [`Balance: ${balance} credits`] : []),
        `Latency: ${event.duration_ms}ms`,
      ].join('\n');

    case 'skill.failed':
      return [
        `${emoji} [AgentBnB] Skill failed`,
        `Skill: ${skillLabel}`,
        `Requester: ${event.requester}`,
        `Reason: ${meta['failure_reason'] ?? 'unknown'}`,
        ...(meta['error'] ? [`Error: ${String(meta['error']).slice(0, 200)}`] : []),
        ...(balance !== undefined ? [`Balance: ${balance} credits`] : []),
        `Latency: ${event.duration_ms}ms`,
      ].join('\n');

    case 'skill.rejected':
      return [
        `${emoji} [AgentBnB] Request rejected`,
        `Skill: ${skillLabel}`,
        `Requester: ${event.requester}`,
        `Reason: ${meta['reason'] ?? 'unknown'}`,
      ].join('\n');

    case 'session.opened':
      return [
        `${emoji} [AgentBnB] Session opened`,
        `Session: ${event.session_id?.slice(0, 8)}...`,
        `Requester: ${event.requester}`,
        `Skill: ${skillLabel}`,
        `Pricing: ${meta['pricing_model'] ?? 'unknown'}`,
        `Budget: ${event.credits} credits`,
      ].join('\n');

    case 'session.message': {
      const msgCount = meta['message_count'] ?? '?';
      const runningCost = meta['running_cost'] ?? event.credits;
      return [
        `${emoji} [AgentBnB] Session message #${msgCount}`,
        `Session: ${event.session_id?.slice(0, 8)}...`,
        `Running cost: ${runningCost} credits`,
      ].join('\n');
    }

    case 'session.ended': {
      const totalMsgs = meta['total_messages'] ?? '?';
      const durationMin = Math.round(event.duration_ms / 60000);
      const refunded = Number(meta['refunded'] ?? 0);
      return [
        `${emoji} [AgentBnB] Session ended`,
        `Session: ${event.session_id?.slice(0, 8)}...`,
        `Total: ${totalMsgs} messages, ${event.credits} credits`,
        `Duration: ${durationMin} minutes`,
        ...(refunded > 0 ? [`Refunded: ${refunded} credits`] : []),
      ].join('\n');
    }

    case 'session.failed': {
      const lastMsgs = Array.isArray(meta['last_messages']) ? meta['last_messages'] as Array<{ sender: string; content: string }> : [];
      const lines = [
        `${emoji} [AgentBnB] Session failed`,
        `Session: ${event.session_id?.slice(0, 8)}...`,
        `Reason: ${meta['reason'] ?? 'error'}`,
        `Cost: ${event.credits} credits`,
      ];
      if (lastMsgs.length > 0) {
        lines.push('', 'Last messages:');
        for (const m of lastMsgs) {
          lines.push(`  ${m.sender}: ${m.content.slice(0, 100)}`);
        }
      }
      return lines.join('\n');
    }

    default:
      return `${emoji} [AgentBnB] ${event.event_type}: ${skillLabel}`;
  }
}

/**
 * Sends a Telegram notification for a provider event.
 *
 * Checks:
 * 1. telegram_notifications must be true (or provider_gate === 'notify' for skill.received)
 * 2. Event type must not be in notification_filters
 * 3. Bot token and chat ID must be configured
 *
 * Fire-and-forget — never throws or rejects.
 *
 * @param event - The provider event to notify about.
 * @param creditDb - Credit database for balance lookup (optional).
 * @param owner - Owner identifier for balance lookup.
 */
export async function notifyProviderEvent(
  event: ProviderEvent,
  creditDb?: Database.Database,
  owner?: string,
): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;

  // Gate check: telegram_notifications OR provider_gate 'notify'
  const telegramEnabled = cfg.telegram_notifications === true;
  const gateNotify = cfg.provider_gate === 'notify';
  if (!telegramEnabled && !gateNotify) return;

  // Filter check: skip events the user doesn't want
  const filters = cfg.notification_filters ?? ['session.message'];
  if (filters.includes(event.event_type)) return;

  const token = cfg.telegram_bot_token ?? process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = cfg.telegram_chat_id ?? process.env['TELEGRAM_CHAT_ID'];
  if (!token || !chatId) return;

  // Get balance for events that show it
  let balance: number | undefined;
  if (creditDb && owner && (event.event_type === 'skill.executed' || event.event_type === 'skill.failed')) {
    try { balance = getBalance(creditDb, owner); } catch { /* silent */ }
  }

  const text = formatEventMessage(event, balance);

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
