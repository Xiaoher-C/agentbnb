/**
 * VerifiedBadge — Green checkmark badge for guarantor-verified agents.
 *
 * Shows a green shield icon with tooltip on hover.
 * Used in AgentList and ProfilePage for agents linked to a human guarantor.
 */

interface VerifiedBadgeProps {
  /** GitHub login of the guarantor (shown in tooltip). */
  guarantor?: string;
  /** Size variant. Default 'sm'. */
  size?: 'sm' | 'md';
}

export default function VerifiedBadge({ guarantor, size = 'sm' }: VerifiedBadgeProps) {
  const sizeClasses = size === 'md' ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <span
      className="inline-flex items-center gap-1 group relative"
      title={guarantor ? `Verified by @${guarantor}` : 'Verified agent'}
    >
      <svg
        className={`${sizeClasses} text-emerald-400`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      {size === 'md' && (
        <span className="text-xs text-emerald-400 font-medium">Verified</span>
      )}
    </span>
  );
}
