/**
 * AgentList — Ranked agent directory for the /agents route.
 *
 * Displays all registered agents sorted by reputation (as returned by the server).
 * Each row shows identicon, agent name + join date, success rate, skill count,
 * and total credits earned. Clicking a row navigates to /agents/:owner.
 *
 * Polls every 30s without flickering (loading spinner only on first fetch).
 */
import Avatar from 'boring-avatars';
import { useNavigate } from 'react-router';
import { useAgents } from '../hooks/useAgents.js';

/**
 * Renders the ranked agent directory.
 * Uses a CSS grid for table-like layout (not <table>) for better dark-theme styling.
 */
export default function AgentList(): JSX.Element {
  const navigate = useNavigate();
  const { agents, loading, error } = useAgents();

  if (loading) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">Agent Directory</h2>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-white/[0.06] animate-pulse rounded h-12"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">Agent Directory</h2>
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-hub-text-secondary hover:text-hub-text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">Agent Directory</h2>
        <p className="text-hub-text-muted">No agents registered yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-hub-text-primary mb-6">Agent Directory</h2>
      <div className="space-y-1">
        {/* Header row */}
        <div className="grid grid-cols-[48px_1fr_100px_80px_100px] gap-4 px-4 py-2 text-xs text-hub-text-tertiary uppercase tracking-wider">
          <div />
          <div>Agent</div>
          <div>Success Rate</div>
          <div>Skills</div>
          <div>Earned</div>
        </div>

        {/* Agent rows */}
        {agents.map((agent) => (
          <div
            key={agent.owner}
            onClick={() => void navigate(`/agents/${agent.owner}`)}
            className="grid grid-cols-[48px_1fr_100px_80px_100px] gap-4 px-4 py-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors items-center"
          >
            {/* Identicon */}
            <div className="flex items-center">
              <Avatar
                size={32}
                name={agent.owner}
                variant="marble"
                colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
              />
            </div>

            {/* Name + join date */}
            <div className="flex flex-col min-w-0">
              <span className="text-hub-text-primary font-medium truncate">{agent.owner}</span>
              <span className="text-hub-text-tertiary text-xs">
                Member since {new Date(agent.member_since).toLocaleDateString()}
              </span>
            </div>

            {/* Success rate */}
            <div className="text-hub-text-secondary">
              {agent.success_rate != null
                ? `${Math.round(agent.success_rate * 100)}%`
                : '—'}
            </div>

            {/* Skill count */}
            <div className="text-hub-text-secondary">{agent.skill_count}</div>

            {/* Credits earned */}
            <div>
              <span className="font-mono text-emerald-400">cr {agent.total_earned}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
