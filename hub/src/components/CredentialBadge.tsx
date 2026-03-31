/**
 * CredentialBadge -- Verifiable credential badge for reputation, skill, and team credentials.
 *
 * Three badge types:
 * - reputation: Circular success-rate indicator with color-coded thresholds
 * - skill:      Shield icon with bronze/silver/gold milestone levels
 * - team:       Group icon with role and team size
 *
 * All badges optionally show a verified checkmark when VC signature is confirmed.
 */
import { Check, Shield, Users } from 'lucide-react';

interface CredentialBadgeProps {
  type: 'reputation' | 'skill' | 'team';
  /** 0.0-1.0 success rate (reputation badges) */
  successRate?: number;
  /** Total completed transactions (reputation badges) */
  totalTransactions?: number;
  /** Skill name (skill badges) */
  skillName?: string;
  /** Milestone level (skill badges) */
  milestone?: 100 | 500 | 1000;
  /** Role within team (team badges) */
  teamRole?: string;
  /** Number of agents in team (team badges) */
  teamSize?: number;
  /** ISO 8601 issuance timestamp */
  issuedAt?: string;
  /** Whether the VC signature was verified */
  verified?: boolean;
}

const BADGE_BASE = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors';
const NEUTRAL_STYLE = 'border-hub-border/60 bg-white/[0.02] text-hub-text-primary';

function reputationColor(rate: number) {
  if (rate >= 0.95) return { text: 'text-emerald-400', border: 'border-emerald-400/25', bg: 'bg-emerald-400/[0.06]' };
  if (rate >= 0.85) return { text: 'text-blue-400', border: 'border-blue-400/25', bg: 'bg-blue-400/[0.06]' };
  return { text: 'text-amber-400', border: 'border-amber-400/25', bg: 'bg-amber-400/[0.06]' };
}

function milestoneColor(ms: 100 | 500 | 1000) {
  if (ms >= 1000) return 'text-yellow-400';
  if (ms >= 500) return 'text-gray-300';
  return 'text-amber-600';
}

function VerifiedCheck() {
  return <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" strokeWidth={3} />;
}

function ReputationBadge({ successRate, totalTransactions, verified }: Pick<CredentialBadgeProps, 'successRate' | 'totalTransactions' | 'verified'>) {
  const rate = successRate ?? 0;
  const c = reputationColor(rate);

  return (
    <span className={`${BADGE_BASE} ${c.text} ${c.border} ${c.bg}`}>
      <span data-testid="reputation-pct">{Math.round(rate * 100)}%</span>
      {totalTransactions !== undefined && (
        <span className="text-hub-text-muted">{totalTransactions} txns verified</span>
      )}
      {verified && <VerifiedCheck />}
    </span>
  );
}

function SkillBadge({ skillName, milestone, verified }: Pick<CredentialBadgeProps, 'skillName' | 'milestone' | 'verified'>) {
  const ms = milestone ?? 100;

  return (
    <span className={`${BADGE_BASE} ${NEUTRAL_STYLE}`}>
      <Shield className={`w-3.5 h-3.5 ${milestoneColor(ms)}`} />
      {skillName && <span>{skillName}</span>}
      <span className="text-hub-text-muted">{ms}+ uses</span>
      {verified && <VerifiedCheck />}
    </span>
  );
}

function TeamBadge({ teamRole, teamSize, verified }: Pick<CredentialBadgeProps, 'teamRole' | 'teamSize' | 'verified'>) {
  return (
    <span className={`${BADGE_BASE} ${NEUTRAL_STYLE}`}>
      <Users className="w-3.5 h-3.5 text-hub-text-muted" />
      {teamRole && <span>{teamRole}</span>}
      {teamSize !== undefined && (
        <span className="text-hub-text-muted">Team of {teamSize}</span>
      )}
      {verified && <VerifiedCheck />}
    </span>
  );
}

/** Renders a verifiable credential badge for reputation, skill, or team credentials. */
export default function CredentialBadge(props: CredentialBadgeProps) {
  switch (props.type) {
    case 'reputation':
      return <ReputationBadge successRate={props.successRate} totalTransactions={props.totalTransactions} verified={props.verified} />;
    case 'skill':
      return <SkillBadge skillName={props.skillName} milestone={props.milestone} verified={props.verified} />;
    case 'team':
      return <TeamBadge teamRole={props.teamRole} teamSize={props.teamSize} verified={props.verified} />;
  }
}

export type { CredentialBadgeProps };
