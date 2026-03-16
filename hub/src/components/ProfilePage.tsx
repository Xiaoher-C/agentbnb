/**
 * ProfilePage — Individual agent profile page at /agents/:owner.
 *
 * Shows the agent's avatar, stats pills, skills grid (cards open CardModal on click),
 * and recent activity list with status badges and relative timestamps.
 *
 * Polls every 30s without flickering. Clicking a skill card opens the CardModal
 * via the AppOutletContext setSelectedCard function.
 */
import Avatar from 'boring-avatars';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { useEffect } from 'react';
import { useAgentProfile } from '../hooks/useAgents.js';
import type { AppOutletContext, ActivityEntry } from '../types.js';
import CapabilityCard from './CapabilityCard.js';

/**
 * Converts a date string to a human-readable relative time string.
 * e.g. "2m ago", "3h ago", "1d ago", "just now"
 */
function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Returns the Tailwind class for an activity entry's status badge.
 */
function statusClass(status: ActivityEntry['status']): string {
  switch (status) {
    case 'success':
      return 'text-emerald-400';
    case 'failure':
      return 'text-red-400';
    case 'timeout':
      return 'text-amber-400';
  }
}

/**
 * Renders an individual agent's full profile with skills grid and recent activity.
 */
export default function ProfilePage(): JSX.Element {
  const { owner } = useParams<{ owner: string }>();
  const navigate = useNavigate();
  const { setSelectedCard } = useOutletContext<AppOutletContext>();
  const { profile, skills, recentActivity, loading, error } = useAgentProfile(owner ?? '');

  // Redirect if no owner param
  useEffect(() => {
    if (!owner) {
      void navigate('/agents');
    }
  }, [owner, navigate]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
          ← Back to Agents
        </Link>
        <div className="bg-white/[0.06] animate-pulse rounded h-16 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.06] animate-pulse rounded h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="py-12 text-center">
        <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
          ← Back to Agents
        </Link>
        <p className="text-red-400 mt-4">{error ?? 'Agent not found'}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Back navigation */}
      <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
        ← Back to Agents
      </Link>

      {/* Profile header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4 mb-2">
        <Avatar
          size={48}
          name={profile.owner}
          variant="marble"
          colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
        />
        <div>
          <h2 className="text-xl font-semibold text-hub-text-primary">{profile.owner}</h2>
        </div>
      </div>

      {/* Stats pills */}
      <div className="flex flex-wrap gap-3 mt-3">
        <span className="bg-white/[0.04] px-3 py-1 rounded-full text-sm text-hub-text-secondary">
          {profile.success_rate != null
            ? `${Math.round(profile.success_rate * 100)}% success`
            : '— success'}
        </span>
        <span className="bg-white/[0.04] px-3 py-1 rounded-full text-sm text-hub-text-secondary">
          {profile.skill_count} skill{profile.skill_count !== 1 ? 's' : ''}
        </span>
        <span className="bg-white/[0.04] px-3 py-1 rounded-full text-sm">
          <span className="font-mono text-emerald-400">cr {profile.total_earned}</span>
          <span className="text-hub-text-secondary"> earned</span>
        </span>
        <span className="bg-white/[0.04] px-3 py-1 rounded-full text-sm text-hub-text-secondary">
          Member since {new Date(profile.member_since).toLocaleDateString()}
        </span>
      </div>

      {/* Skills section */}
      <h3 className="text-lg font-medium text-hub-text-primary mt-8 mb-4">
        Skills ({skills.length})
      </h3>
      {skills.length === 0 ? (
        <p className="text-hub-text-muted">No skills published yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map((skill) => (
            <CapabilityCard
              key={skill.id}
              card={skill}
              onClick={() => setSelectedCard(skill)}
            />
          ))}
        </div>
      )}

      {/* Recent activity section */}
      <h3 className="text-lg font-medium text-hub-text-primary mt-8 mb-4">Recent Activity</h3>
      {recentActivity.length === 0 ? (
        <p className="text-hub-text-muted">No activity yet.</p>
      ) : (
        <div className="space-y-2">
          {recentActivity.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.02]"
            >
              {/* Left: card name + requester */}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-hub-text-primary truncate">{entry.card_name}</span>
                <span className="text-hub-text-tertiary text-xs truncate">
                  from @{entry.requester}
                </span>
              </div>

              {/* Center: status badge */}
              <div className="mx-4 flex-shrink-0">
                <span className={`text-sm capitalize ${statusClass(entry.status)}`}>
                  {entry.status}
                </span>
              </div>

              {/* Right: credits + relative time */}
              <div className="flex flex-col items-end flex-shrink-0">
                <span className="font-mono text-emerald-400 text-sm">cr {entry.credits_charged}</span>
                <span className="text-hub-text-tertiary text-xs">{timeAgo(entry.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
