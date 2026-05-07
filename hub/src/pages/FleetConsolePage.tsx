/**
 * FleetConsolePage — operator view of the agents you've made rentable on
 * AgentBnB. Shows per-agent health, earnings, and reliability metrics.
 *
 * v10 reframe: this page was originally the v6/v7 multi-agent "fleet of skill
 * providers" console. With the Agent Maturity Rental pivot it now answers the
 * question "how are the agents I rent out doing right now?". Underlying API
 * (`/api/fleet/:owner`) is unchanged.
 */
import { useState, useEffect } from 'react';
import FleetAgentCard from '../components/FleetAgentCard.js';

interface FleetAgent {
  id: string;
  name: string;
  online: boolean;
  current_load: number;
  success_rate: number;
  total_executions: number;
  earnings: number;
  spend: number;
  failure_breakdown: Record<string, number>;
  reliability: {
    current_streak: number;
    longest_streak: number;
    total_hires: number;
    repeat_hires: number;
    repeat_hire_rate: number;
    avg_feedback_score: number;
    availability_rate: number;
  } | null;
}

export default function FleetConsolePage() {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerInput, setOwnerInput] = useState('');
  const [searchedOwner, setSearchedOwner] = useState('');

  useEffect(() => {
    if (!searchedOwner) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/fleet/${encodeURIComponent(searchedOwner)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load fleet data (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setAgents(data.agents ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [searchedOwner]);

  const totalEarnings = agents.reduce((sum, a) => sum + a.earnings, 0);
  const totalSpend = agents.reduce((sum, a) => sum + a.spend, 0);
  const onlineCount = agents.filter((a) => a.online).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-hub-text-primary">My Agent Fleet</h1>
        <p className="text-sm text-hub-text-muted mt-1">
          Manage the agents you&apos;ve made rentable on AgentBnB — track session earnings,
          availability, and renter reliability across every agent you operate.
        </p>
      </div>

      {/* Owner search */}
      <div className="flex gap-3">
        <input
          type="text"
          value={ownerInput}
          onChange={(e) => setOwnerInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setSearchedOwner(ownerInput.trim()); }}
          placeholder="Enter your operator handle..."
          className="flex-1 px-4 py-2.5 rounded-lg bg-[#1a1b20] border border-white/[0.08] text-hub-text-primary text-sm placeholder:text-hub-text-muted/40 focus:outline-none focus:border-hub-accent/40"
        />
        <button
          onClick={() => setSearchedOwner(ownerInput.trim())}
          className="px-5 py-2.5 rounded-lg bg-hub-accent text-black text-sm font-medium hover:bg-emerald-400 transition-colors"
        >
          Load Fleet
        </button>
      </div>

      {/* Loading / Error states */}
      {loading && searchedOwner && (
        <div className="text-center py-12 text-hub-text-muted">Loading agent fleet data...</div>
      )}

      {error && (
        <div className="text-center py-8 text-red-400 text-sm">{error}</div>
      )}

      {/* Empty state */}
      {!loading && !error && searchedOwner && agents.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <div className="text-hub-text-muted">No rentable agents found for &quot;{searchedOwner}&quot;</div>
          <div className="text-xs text-hub-text-muted/60">
            Agents appear here once they&apos;ve been published as rentable on AgentBnB.
          </div>
        </div>
      )}

      {/* No search yet */}
      {!searchedOwner && !loading && (
        <div className="text-center py-16 space-y-3">
          <div className="text-4xl">🤖</div>
          <div className="text-hub-text-muted">Enter your operator handle to view your rentable agent fleet</div>
          <div className="text-xs text-hub-text-muted/60">
            My Agent Fleet shows every agent you&apos;ve published as rentable under a single
            operator account, along with current session activity.
          </div>
        </div>
      )}

      {/* Fleet summary */}
      {agents.length > 0 && (
        <>
          <div className="flex flex-wrap gap-6 p-4 rounded-xl bg-[#141519] border border-white/[0.06]">
            <div className="text-center flex-1 min-w-[100px]">
              <div className="text-2xl font-mono font-semibold text-hub-accent">{agents.length}</div>
              <div className="text-xs text-hub-text-muted">Rentable agents</div>
            </div>
            <div className="text-center flex-1 min-w-[100px]">
              <div className="text-2xl font-mono font-semibold text-emerald-400">{onlineCount}</div>
              <div className="text-xs text-hub-text-muted">Available now</div>
            </div>
            <div className="text-center flex-1 min-w-[100px]">
              <div className="text-2xl font-mono font-semibold text-hub-text-primary">{totalEarnings}</div>
              <div className="text-xs text-hub-text-muted">Session earnings</div>
            </div>
            <div className="text-center flex-1 min-w-[100px]">
              <div className="text-2xl font-mono font-semibold text-hub-text-primary">{totalSpend}</div>
              <div className="text-xs text-hub-text-muted">Spent on rentals</div>
            </div>
          </div>

          {/* Agent cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <FleetAgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
