/**
 * ParticipantsPanel — Right-rail list of session participants.
 *
 * Each participant card shows their boring-avatar (seeded by DID), role label
 * in human Chinese copy where applicable, and a short DID prefix. The renter
 * is always rendered first; the rented agent second. Observers (if any) fall
 * below.
 */
import Avatar from 'boring-avatars';
import type { SessionParticipantView } from '../hooks/useSessionWebSocket.js';

interface ParticipantsPanelProps {
  participants: SessionParticipantView[];
  /** True for the participant currently considered "online" via the relay socket. */
  onlineDids?: string[];
}

const ROLE_LABEL: Record<SessionParticipantView['role'], string> = {
  renter_human: '租用人',
  renter_agent: '租用人 agent',
  rented_agent: '出租 agent',
  human_observer: '觀察員',
};

const ROLE_TONE: Record<SessionParticipantView['role'], string> = {
  renter_human: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  renter_agent: 'border-emerald-400/20 bg-emerald-400/[0.04]',
  rented_agent: 'border-violet-500/30 bg-violet-500/[0.06]',
  human_observer: 'border-hub-border-default bg-white/[0.03]',
};

const AVATAR_COLORS_RENTER = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5'];
const AVATAR_COLORS_OWNER = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE'];

/** Short DID prefix for display. */
function shortDid(did: string): string {
  if (did.length <= 14) return did;
  return `${did.slice(0, 8)}…${did.slice(-4)}`;
}

/**
 * Sort participants so the renter comes first, owner second, observers last.
 * Pure — does not mutate the input.
 */
function sortParticipants(p: SessionParticipantView[]): SessionParticipantView[] {
  const order: SessionParticipantView['role'][] = [
    'renter_human',
    'renter_agent',
    'rented_agent',
    'human_observer',
  ];
  return [...p].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

/**
 * Right-rail participant list.
 */
export default function ParticipantsPanel({
  participants,
  onlineDids = [],
}: ParticipantsPanelProps): JSX.Element {
  const sorted = sortParticipants(participants);
  const onlineSet = new Set(onlineDids);

  return (
    <aside className="rounded-card border border-hub-border-default bg-hub-surface-0 p-3">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-hub-text-muted">
        Participants ({sorted.length})
      </h3>
      <ul className="space-y-2">
        {sorted.map((p) => {
          const isOwner = p.role === 'rented_agent';
          const isOnline = onlineSet.has(p.did);
          return (
            <li
              key={`${p.did}:${p.role}`}
              className={`flex items-center gap-3 rounded-md border px-2 py-2 ${ROLE_TONE[p.role]}`}
            >
              <Avatar
                size={32}
                name={p.did}
                variant="marble"
                colors={isOwner ? AVATAR_COLORS_OWNER : AVATAR_COLORS_RENTER}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-hub-text-primary">
                    {ROLE_LABEL[p.role]}
                  </span>
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isOnline ? 'bg-hub-accent shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-hub-text-tertiary'
                    }`}
                    aria-label={isOnline ? 'Online' : 'Offline'}
                  />
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-hub-text-muted">
                  {shortDid(p.did)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
