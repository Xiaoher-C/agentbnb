/**
 * HubAgentCard — Card component for the Hub Agent grid.
 *
 * Shows agent name, status badge, skill count with routing mode badges,
 * and creation date. Uses the same dark SaaS aesthetic as CapabilityCard.
 */
import Avatar from 'boring-avatars';
import type { HubAgentSummary } from '../types.js';

interface HubAgentCardProps {
  agent: HubAgentSummary;
  onClick: () => void;
}

/** Mode badge color mapping */
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
 * Renders a Hub Agent card for the list/grid view.
 * Clicking navigates to the agent's dashboard page.
 */
export default function HubAgentCard({ agent, onClick }: HubAgentCardProps): JSX.Element {
  const isActive = agent.status === 'active';

  return (
    <article
      onClick={onClick}
      className="bg-hub-surface border border-hub-border rounded-card p-6 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
    >
      {/* Header: identicon + name + status */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar
            size={32}
            name={agent.agent_id}
            variant="beam"
            colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold text-hub-text-primary truncate leading-tight">
              {agent.name}
            </p>
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
          <p className="text-[13px] text-hub-text-tertiary mt-0.5">
            {agent.skill_routes.length} skill{agent.skill_routes.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Routing mode badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.skill_routes.map((route) => {
          const badge = modeBadge(route.mode);
          return (
            <span
              key={route.skill_id}
              className={`text-[11px] font-medium px-2 py-0.5 rounded border ${badge.classes}`}
            >
              {badge.label}
            </span>
          );
        })}
      </div>

      {/* Footer: created date */}
      <div className="mt-3 text-xs text-hub-text-tertiary">
        Created {new Date(agent.created_at).toLocaleDateString()}
      </div>
    </article>
  );
}
