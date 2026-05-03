/**
 * HumanInterventionBubble — Visual highlight for renter human break-ins.
 *
 * In v10 rental sessions, the renter usually speaks through their own agent
 * (mode = `proxy` / 「透過我的 agent」). When they switch to direct mode and
 * post manually, the message is flagged `is_human_intervention: true`. We
 * render those bubbles with an amber left bar + tag so the rented agent (and
 * the outcome page) can immediately tell them apart from agent traffic.
 */
import type { ReactNode } from 'react';
import { Hand } from 'lucide-react';

interface HumanInterventionBubbleProps {
  children: ReactNode;
  /** Optional timestamp displayed under the tag. */
  timestamp?: string;
}

/**
 * Wraps a message body in an amber-accent surface. Reserved for messages
 * where the renter intervened personally instead of letting their agent
 * speak.
 */
export default function HumanInterventionBubble({
  children,
  timestamp,
}: HumanInterventionBubbleProps): JSX.Element {
  return (
    <div
      className="flex items-stretch gap-3 rounded-card border border-amber-500/30 bg-amber-500/[0.06] p-3"
      role="group"
      aria-label="Human intervention"
    >
      <div
        className="w-1 self-stretch rounded-full bg-amber-400/80 shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-400">
          <Hand size={11} aria-hidden="true" />
          <span>Human intervention</span>
          {timestamp ? (
            <span className="ml-auto font-normal text-hub-text-muted normal-case tracking-normal">
              {timestamp}
            </span>
          ) : null}
        </div>
        <div className="text-sm text-hub-text-primary">{children}</div>
      </div>
    </div>
  );
}
