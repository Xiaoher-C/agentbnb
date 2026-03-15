/**
 * StatusDot — Colored indicator dot for agent online/offline status.
 * Two-state only: accent green with glow (online) or dim white (offline).
 */

interface StatusDotProps {
  online: boolean;
}

/**
 * Renders a small colored dot reflecting agent availability.
 * Online: 8px accent green circle with glow effect.
 * Offline: 8px dim white circle (no glow).
 *
 * @param online - Whether the agent is currently online
 */
export default function StatusDot({ online }: StatusDotProps) {
  if (online) {
    return (
      <span
        className="w-2 h-2 rounded-full inline-block bg-hub-accent shadow-[0_0_8px_rgba(16,185,129,0.4)]"
        aria-label="Online"
      />
    );
  }
  return (
    <span
      className="w-2 h-2 rounded-full inline-block bg-hub-text-tertiary"
      aria-label="Offline"
    />
  );
}
