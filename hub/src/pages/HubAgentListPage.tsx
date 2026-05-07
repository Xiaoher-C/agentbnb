/**
 * HubAgentListPage — legacy "Hub Agents" listing.
 *
 * @deprecated v10 — the `/agents/hub` route now redirects to `/dashboard`
 * (see `hub/src/main.tsx`). This component is kept on disk for historical
 * reference but is unreachable from the live router and must not be
 * re-mounted. v10 uses `ProviderDashboardPage` for managing rentable agents.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useHubAgents } from '../hooks/useHubAgents.js';
import HubAgentCard from '../components/HubAgentCard.js';

let warnedHubAgentListPage = false;

/**
 * Renders the Hub Agent list page with responsive card grid.
 *
 * @deprecated v10 — orphan route; see file header.
 */
export default function HubAgentListPage(): JSX.Element {
  const navigate = useNavigate();
  const { agents, loading, error } = useHubAgents();

  useEffect(() => {
    if (warnedHubAgentListPage) return;
    warnedHubAgentListPage = true;
    console.warn(
      '[AgentBnB] HubAgentListPage is deprecated as of v10 and is no longer reachable via routing. ' +
        'Use /dashboard (ProviderDashboardPage) to manage rentable agents.',
    );
  }, []);

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-hub-text-primary">Hub Agents</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.06] animate-pulse rounded-card h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-hub-text-primary mb-6">Hub Agents</h2>
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-hub-text-primary">Hub Agents</h2>
        <button
          onClick={() => void navigate('/agents/hub/new')}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Create Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-hub-text-muted mb-4">No Hub Agents yet. Create your first agent to get started.</p>
          <button
            onClick={() => void navigate('/agents/hub/new')}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Create Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <HubAgentCard
              key={agent.agent_id}
              agent={agent}
              onClick={() => void navigate(`/agents/hub/${agent.agent_id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
