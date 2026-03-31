/**
 * CredentialBadge — displays a Verifiable Credential summary on agent profiles.
 *
 * Three variants:
 *   reputation — circular badge with success rate %
 *   skill     — shield icon with skill name + milestone medal
 *   team      — group icon with role + team size
 */

export interface CredentialBadgeProps {
  type: 'reputation' | 'skill' | 'team';
  // Reputation
  successRate?: number; // 0.0-1.0
  totalTransactions?: number;
  // Skill
  skillName?: string;
  milestone?: 100 | 500 | 1000;
  // Team
  teamRole?: string;
  teamSize?: number;
  // Common
  issuedAt?: string; // ISO 8601
  verified?: boolean;
}

const MILESTONE_MEDAL: Record<number, string> = {
  100: '🥉',
  500: '🥈',
  1000: '🥇',
};

function rateColor(rate: number): string {
  if (rate >= 0.95) return 'text-emerald-400 border-emerald-400/25';
  if (rate >= 0.85) return 'text-blue-400 border-blue-400/25';
  return 'text-amber-400 border-amber-400/25';
}

function rateBg(rate: number): string {
  if (rate >= 0.95) return 'bg-emerald-400/[0.06]';
  if (rate >= 0.85) return 'bg-blue-400/[0.06]';
  return 'bg-amber-400/[0.06]';
}

function VerifiedCheck() {
  return (
    <svg
      data-testid="verified-check"
      className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ReputationBadge({ successRate, totalTransactions, verified }: CredentialBadgeProps) {
  const rate = successRate ?? 0;
  const pct = Math.round(rate * 100);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`w-14 h-14 rounded-full border-2 flex items-center justify-center ${rateColor(rate)} ${rateBg(rate)}`}
      >
        <span className="text-sm font-bold">{pct}%</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-hub-text-muted">
          {totalTransactions?.toLocaleString() ?? 0} txns verified
        </span>
        {verified && <VerifiedCheck />}
      </div>
    </div>
  );
}

function SkillBadge({ skillName, milestone, issuedAt, verified }: CredentialBadgeProps) {
  const medal = milestone ? MILESTONE_MEDAL[milestone] : null;
  const formatted = issuedAt ? new Date(issuedAt).toLocaleDateString() : undefined;
  return (
    <div
      className="inline-flex items-center gap-2 bg-white/[0.02] border border-hub-border/60 rounded-lg px-3 py-2 hover:border-hub-accent/30 transition-colors group relative"
      title={formatted ? `Issued ${formatted}` : undefined}
    >
      {/* Shield icon */}
      <svg className="w-4 h-4 text-hub-text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944z"
          clipRule="evenodd"
        />
      </svg>
      <span className="text-[13px] text-hub-text-primary font-medium">{skillName}</span>
      {medal && <span className="text-sm">{medal}</span>}
      {verified && <VerifiedCheck />}
    </div>
  );
}

function TeamBadge({ teamRole, teamSize, verified }: CredentialBadgeProps) {
  return (
    <div className="inline-flex items-center gap-2 bg-white/[0.02] border border-hub-border/60 rounded-lg px-3 py-2 hover:border-hub-accent/30 transition-colors">
      {/* Group icon */}
      <svg className="w-4 h-4 text-hub-text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
      </svg>
      <span className="text-[13px] text-hub-text-primary font-medium">{teamRole}</span>
      {teamSize && (
        <span className="text-[11px] text-hub-text-muted">Team of {teamSize}</span>
      )}
      {verified && <VerifiedCheck />}
    </div>
  );
}

export default function CredentialBadge(props: CredentialBadgeProps) {
  switch (props.type) {
    case 'reputation':
      return <ReputationBadge {...props} />;
    case 'skill':
      return <SkillBadge {...props} />;
    case 'team':
      return <TeamBadge {...props} />;
  }
}
