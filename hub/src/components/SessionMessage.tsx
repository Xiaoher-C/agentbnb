/**
 * SessionMessage — Renders one bubble in the SessionRoom conversation stream.
 *
 * Layout:
 *   - Provider (rented agent) bubbles: left-aligned, neutral surface.
 *   - Requester (renter / renter agent) bubbles: right-aligned, accent tint.
 *   - Human intervention messages are rendered through `HumanInterventionBubble`
 *     regardless of sender alignment so the amber treatment is impossible to miss.
 *
 * The actual message body is rendered through `MessageRenderer`, which only
 * accepts a strict markdown subset (no raw HTML).
 */
import Avatar from 'boring-avatars';
import { useMemo } from 'react';
import MessageRenderer from './MessageRenderer.js';
import HumanInterventionBubble from './HumanInterventionBubble.js';
import type { SessionMessageView } from '../hooks/useSessionWebSocket.js';

interface SessionMessageProps {
  message: SessionMessageView;
}

const AVATAR_COLORS_RENTER = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5'];
const AVATAR_COLORS_OWNER = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE'];

/** Format an ISO timestamp into a short HH:mm value, falling back to raw input. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Short DID prefix for avatar tooltip + footer. */
function shortDid(did?: string): string {
  if (!did) return '';
  if (did.length <= 14) return did;
  return `${did.slice(0, 8)}…${did.slice(-4)}`;
}

/**
 * Render a single message bubble with sender avatar, alignment, and markdown
 * body. Human-intervention messages get an amber treatment via
 * `HumanInterventionBubble`.
 */
export default function SessionMessage({ message }: SessionMessageProps): JSX.Element {
  const isProvider = message.sender === 'provider';
  const time = useMemo(() => formatTime(message.timestamp), [message.timestamp]);
  const senderLabel = useMemo(() => {
    if (isProvider) return 'Rented agent';
    if (message.is_human_intervention) return 'You (human)';
    return message.sender_role === 'renter_agent' ? 'Your agent' : 'You';
  }, [isProvider, message.is_human_intervention, message.sender_role]);

  const avatarSeed = message.sender_did ?? message.sender;
  const avatarColors = isProvider ? AVATAR_COLORS_OWNER : AVATAR_COLORS_RENTER;

  // Human intervention: full-width amber treatment, sender label still visible
  if (message.is_human_intervention) {
    return (
      <div className="flex w-full">
        <HumanInterventionBubble timestamp={time}>
          <div className="mb-1 text-[11px] text-hub-text-muted">
            {senderLabel}
            {message.sender_did ? <span className="ml-2 font-mono">{shortDid(message.sender_did)}</span> : null}
          </div>
          <MessageRenderer content={message.content} />
        </HumanInterventionBubble>
      </div>
    );
  }

  return (
    <div className={`flex w-full ${isProvider ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[85%] gap-2 ${isProvider ? '' : 'flex-row-reverse'}`}>
        <div className="shrink-0 pt-1">
          <Avatar
            size={28}
            name={avatarSeed}
            variant="marble"
            colors={avatarColors}
          />
        </div>
        <div className={`min-w-0 flex-1 ${isProvider ? '' : 'text-right'}`}>
          <div className={`mb-1 flex items-center gap-2 text-[11px] text-hub-text-muted ${isProvider ? '' : 'justify-end'}`}>
            <span className="font-medium text-hub-text-secondary">{senderLabel}</span>
            {message.sender_did ? (
              <span className="font-mono">{shortDid(message.sender_did)}</span>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{time}</span>
          </div>
          <div
            className={`inline-block rounded-card border px-3 py-2 text-left ${
              isProvider
                ? 'border-hub-border-default bg-hub-surface-1'
                : 'border-emerald-500/20 bg-emerald-500/[0.08]'
            }`}
          >
            <MessageRenderer content={message.content} />
          </div>
        </div>
      </div>
    </div>
  );
}
