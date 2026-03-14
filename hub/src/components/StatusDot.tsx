/**
 * StatusDot — Colored indicator dot for agent online/offline status.
 * Two-state only: emerald (online) or rose (offline). No amber/busy state.
 */

interface StatusDotProps {
  online: boolean;
}

/**
 * Renders a small colored dot reflecting agent availability.
 *
 * @param online - Whether the agent is currently online
 */
export default function StatusDot({ online }: StatusDotProps) {
  if (online) {
    return (
      <span
        className="w-2.5 h-2.5 rounded-full inline-block bg-emerald-400 ring-2 ring-emerald-400/30"
        aria-label="Online"
      />
    );
  }
  return (
    <span
      className="w-2.5 h-2.5 rounded-full inline-block bg-rose-400"
      aria-label="Offline"
    />
  );
}
