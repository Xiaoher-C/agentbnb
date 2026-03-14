/**
 * CapabilityCard — Main card component with expand-in-place behavior.
 * Compact view by default; expands on click to show full details.
 */
import Avatar from 'boring-avatars';
import { inferCategories } from '../lib/categories.js';
import { formatCredits } from '../lib/utils.js';
import type { HubCard } from '../types.js';
import CategoryChip from './CategoryChip.js';
import LevelBadge from './LevelBadge.js';
import StatusDot from './StatusDot.js';

interface CapabilityCardProps {
  card: HubCard;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Renders a capability card with compact and expanded states.
 *
 * @param card - The HubCard data to display
 * @param expanded - Whether the card is currently expanded
 * @param onToggle - Callback to toggle expanded state
 */
export default function CapabilityCard({ card, expanded, onToggle }: CapabilityCardProps) {
  const { categories, overflow } = inferCategories(card.metadata);
  const online = card.availability.online;
  const successRate = card.metadata?.success_rate;
  const latency = card.metadata?.avg_latency_ms;

  return (
    <article
      role="article"
      onClick={onToggle}
      className={[
        'bg-slate-800 rounded-xl border p-4 cursor-pointer transition-all duration-200',
        expanded
          ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/10'
          : 'border-slate-700 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/5',
      ].join(' ')}
    >
      {/* Header row: identicon + name/owner */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <Avatar
            size={40}
            name={card.id}
            variant="beam"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-100 truncate">{card.name}</p>
          <p className="text-sm text-slate-400">@{card.owner}</p>
          <div className="mt-1">
            <LevelBadge level={card.level} />
          </div>
        </div>
      </div>

      {/* Category chips row */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <CategoryChip key={cat.id} category={cat} />
        ))}
        {overflow > 0 && <CategoryChip category={categories[0]} overflowCount={overflow} />}
      </div>

      {/* Powered by row */}
      {card.powered_by && card.powered_by.length > 0 && (
        <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
          <span className="text-slate-600 mr-1">Powered by</span>
          {card.powered_by.map((entry, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && <span className="mx-1 text-slate-600">→</span>}
              <span className="text-slate-300">
                {entry.provider}
                {entry.model && <span className="text-slate-500 ml-0.5">{entry.model}</span>}
                {entry.tier && <span className="text-slate-500 ml-0.5">{entry.tier}</span>}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <StatusDot online={online} />
          {online ? 'Online' : 'Offline'}
        </span>
        {successRate !== undefined && (
          <>
            <span className="text-slate-600">·</span>
            <span>{Math.round(successRate * 100)}% success</span>
          </>
        )}
        <span className="text-slate-600">·</span>
        <span className="text-indigo-400">{formatCredits(card.pricing)}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
          {/* Description */}
          <p className="text-sm text-slate-300">{card.description}</p>

          {/* I/O Schema */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Inputs
              </p>
              <ul className="space-y-1">
                {card.inputs.map((input) => (
                  <li key={input.name} className="text-xs text-slate-300">
                    <span className="text-slate-100 font-mono">{input.name}</span>
                    <span className="text-slate-500 ml-1">:{input.type}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Outputs
              </p>
              <ul className="space-y-1">
                {card.outputs.map((output) => (
                  <li key={output.name} className="text-xs text-slate-300">
                    <span className="text-slate-100 font-mono">{output.name}</span>
                    <span className="text-slate-500 ml-1">:{output.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Latency */}
          <p className="text-xs text-slate-500">
            {latency !== undefined ? `${latency}ms avg latency` : 'No latency data'}
          </p>

          {/* Request via CLI */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-2"
          >
            <p className="text-xs text-slate-400 mb-1">Request via CLI:</p>
            <pre className="px-3 py-2 bg-slate-900 rounded-lg text-indigo-400 text-xs font-mono">
              agentbnb request {card.id}
            </pre>
          </div>
        </div>
      )}
    </article>
  );
}
