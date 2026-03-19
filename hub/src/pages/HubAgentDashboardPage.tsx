/**
 * HubAgentDashboardPage — Single Hub Agent operations dashboard at /agents/hub/:agentId.
 *
 * Shows agent header, stats row, skill routes, recent jobs, and delete button.
 * Polls agent data every 30s and jobs every 10s.
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import Avatar from 'boring-avatars';
import { useHubAgent, useHubAgentJobs } from '../hooks/useHubAgents.js';
import type { HubAgentJob } from '../types.js';

/**
 * Converts a date string to a human-readable relative time string.
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
 * Returns Tailwind classes for a job status badge.
 */
function jobStatusClass(status: HubAgentJob['status']): string {
  switch (status) {
    case 'queued':
      return 'bg-amber-500/15 text-amber-400';
    case 'dispatched':
      return 'bg-blue-500/15 text-blue-400';
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-400';
    case 'failed':
      return 'bg-red-500/15 text-red-400';
  }
}

/** Mode badge label + color */
function modeBadge(mode: string): { label: string; classes: string } {
  switch (mode) {
    case 'direct_api':
      return { label: 'API', classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
    case 'relay':
      return { label: 'Relay', classes: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
    case 'queue':
      return { label: 'Queue', classes: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
    default:
      return { label: mode, classes: 'bg-white/[0.06] text-hub-text-secondary border-hub-border' };
  }
}

/**
 * Renders the Hub Agent operations dashboard.
 */
export default function HubAgentDashboardPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agent, loading: agentLoading, error: agentError } = useHubAgent(agentId ?? '');
  const { jobs, loading: jobsLoading } = useHubAgentJobs(agentId ?? '');

  // Redirect if no agentId
  useEffect(() => {
    if (!agentId) {
      void navigate('/agents/hub');
    }
  }, [agentId, navigate]);

  // --- Delete handler ---
  async function handleDelete(): Promise<void> {
    if (!agentId) return;
    const confirmed = window.confirm('Are you sure you want to delete this Hub Agent? This action cannot be undone.');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/hub-agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      void navigate('/agents/hub');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to delete agent: ${msg}`);
    }
  }

  // --- Loading state ---
  if (agentLoading) {
    return (
      <div>
        <Link to="/agents/hub" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
          &larr; Back to Hub Agents
        </Link>
        <div className="space-y-4 mt-4">
          <div className="bg-white/[0.06] animate-pulse rounded h-16" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white/[0.06] animate-pulse rounded-lg h-20" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Error / not found ---
  if (agentError || !agent) {
    return (
      <div className="py-12 text-center">
        <Link to="/agents/hub" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
          &larr; Back to Hub Agents
        </Link>
        <p className="text-red-400 mt-4">{agentError ?? 'Hub Agent not found'}</p>
      </div>
    );
  }

  // --- Compute stats ---
  const completedJobs = jobs.filter((j) => j.status === 'completed').length;
  const failedJobs = jobs.filter((j) => j.status === 'failed').length;
  const finishedJobs = completedJobs + failedJobs;
  const successRate = finishedJobs > 0 ? Math.round((completedJobs / finishedJobs) * 100) : null;
  const isActive = agent.status === 'active';
  const recentJobs = jobs.slice(0, 20);

  return (
    <div>
      {/* Back link */}
      <Link to="/agents/hub" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
        &larr; Back to Hub Agents
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4 mb-6">
        <Avatar
          size={48}
          name={agent.agent_id}
          variant="beam"
          colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
        />
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-hub-text-primary">{agent.name}</h2>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-white/[0.06] text-hub-text-tertiary'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isActive ? 'bg-emerald-400' : 'bg-hub-text-tertiary'
                }`}
              />
              {isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <p className="text-hub-text-tertiary text-sm mt-1">
            <span className="font-mono">{agent.public_key.slice(0, 16)}...</span>
            <span className="mx-2 text-hub-text-tertiary">|</span>
            Created {new Date(agent.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="rounded-lg border border-hub-border px-4 py-3" style={{ backgroundColor: '#111117' }}>
          <p className="text-hub-text-tertiary text-xs uppercase tracking-wider mb-1">Skills</p>
          <p className="text-hub-text-primary text-lg font-semibold">{agent.skill_routes.length}</p>
        </div>
        <div className="rounded-lg border border-hub-border px-4 py-3" style={{ backgroundColor: '#111117' }}>
          <p className="text-hub-text-tertiary text-xs uppercase tracking-wider mb-1">Status</p>
          <p className={`text-lg font-semibold ${isActive ? 'text-emerald-400' : 'text-hub-text-tertiary'}`}>
            {isActive ? 'Active' : 'Paused'}
          </p>
        </div>
        <div className="rounded-lg border border-hub-border px-4 py-3" style={{ backgroundColor: '#111117' }}>
          <p className="text-hub-text-tertiary text-xs uppercase tracking-wider mb-1">Total Jobs</p>
          <p className="text-hub-text-primary text-lg font-semibold">
            {jobsLoading ? '...' : jobs.length}
          </p>
        </div>
        <div className="rounded-lg border border-hub-border px-4 py-3" style={{ backgroundColor: '#111117' }}>
          <p className="text-hub-text-tertiary text-xs uppercase tracking-wider mb-1">Success Rate</p>
          <p className="text-hub-text-primary text-lg font-semibold">
            {successRate !== null ? `${successRate}%` : '---'}
          </p>
        </div>
      </div>

      {/* Skills section */}
      <h3 className="text-lg font-medium text-hub-text-primary mb-4">
        Skills ({agent.skill_routes.length})
      </h3>
      <div className="space-y-2 mb-8">
        {agent.skill_routes.map((route) => {
          const badge = modeBadge(route.mode);
          return (
            <div
              key={route.skill_id}
              className="flex items-center gap-3 bg-white/[0.02] rounded-lg px-4 py-3"
            >
              <span className="text-hub-text-primary font-medium text-sm">{route.skill_id}</span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${badge.classes}`}>
                {badge.label}
              </span>
              {route.mode === 'direct_api' && 'endpoint' in route.config && (
                <span className="text-hub-text-tertiary text-xs">
                  {(route.config as { method?: string }).method ?? 'POST'}{' '}
                  {(route.config as { endpoint: string }).endpoint}
                </span>
              )}
              {(route.mode === 'relay' || route.mode === 'queue') && (
                <span className="text-hub-text-tertiary text-xs">
                  via @{(route.config as { relay_owner: string }).relay_owner}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Jobs section */}
      <h3 className="text-lg font-medium text-hub-text-primary mb-4">Recent Jobs</h3>
      {jobsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.06] animate-pulse rounded h-12" />
          ))}
        </div>
      ) : recentJobs.length === 0 ? (
        <p className="text-hub-text-muted mb-8">No jobs yet.</p>
      ) : (
        <div className="space-y-2 mb-8">
          {recentJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.02]"
            >
              {/* Left: skill + requester */}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-hub-text-primary text-sm truncate">{job.skill_id}</span>
                <span className="text-hub-text-tertiary text-xs truncate">
                  from @{job.requester_owner}
                </span>
              </div>

              {/* Center: status badge */}
              <div className="mx-4 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded capitalize ${jobStatusClass(job.status)}`}>
                  {job.status}
                </span>
              </div>

              {/* Right: result preview + time */}
              <div className="flex flex-col items-end flex-shrink-0">
                {job.result && (
                  <span className="text-hub-text-secondary text-xs truncate max-w-[200px]">
                    {job.result.slice(0, 80)}{job.result.length > 80 ? '...' : ''}
                  </span>
                )}
                <span className="text-hub-text-tertiary text-xs">{timeAgo(job.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete button */}
      <div className="border-t border-hub-border pt-6 mt-8">
        <button
          onClick={() => void handleDelete()}
          className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Delete Agent
        </button>
      </div>
    </div>
  );
}
