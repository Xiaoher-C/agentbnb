/**
 * FleetAgentCard — per-agent tile in My Agent Fleet.
 *
 * v10 reframe: shows whether an agent is currently rentable (online + accepting
 * sessions) or paused, plus session-derived metrics (success rate, hires,
 * credits earned). Field names on the API are preserved for backward compat.
 */

interface FleetAgentCardProps {
  agent: {
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
  };
}

export default function FleetAgentCard({ agent }: FleetAgentCardProps) {
  const successPct = (agent.success_rate * 100).toFixed(1);
  const netCredits = agent.earnings - agent.spend;
  const failureEntries = Object.entries(agent.failure_breakdown);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#141519] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              agent.online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'
            }`}
          />
          <h3 className="text-base font-semibold text-hub-text-primary truncate max-w-[200px]">
            {agent.name}
          </h3>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          agent.online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-400'
        }`}>
          {agent.online ? 'Rentable' : 'Paused'}
        </span>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-lg font-mono font-semibold text-hub-accent">{successPct}%</div>
          <div className="text-[11px] text-hub-text-muted">Success rate</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-mono font-semibold text-hub-text-primary">{agent.total_executions}</div>
          <div className="text-[11px] text-hub-text-muted">Total hires</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-mono font-semibold ${netCredits >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {netCredits >= 0 ? '+' : ''}{netCredits}
          </div>
          <div className="text-[11px] text-hub-text-muted">Net credits</div>
        </div>
      </div>

      {/* Earnings/Spend breakdown */}
      <div className="flex items-center justify-between text-xs text-hub-text-muted border-t border-white/[0.04] pt-3">
        <span>Earned: <span className="text-emerald-400 font-mono">{agent.earnings}</span></span>
        <span>Spent: <span className="text-red-400 font-mono">{agent.spend}</span></span>
      </div>

      {/* Failure breakdown */}
      {failureEntries.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-hub-text-muted font-medium">Failure breakdown</div>
          <div className="flex flex-wrap gap-1.5">
            {failureEntries.map(([reason, count]) => (
              <span
                key={reason}
                className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400"
              >
                {reason}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reliability metrics */}
      {agent.reliability && (
        <div className="space-y-1.5 border-t border-white/[0.04] pt-3">
          <div className="text-xs text-hub-text-muted font-medium">Agent reliability</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-hub-text-muted">Streak</span>
              <span className="text-hub-text-primary font-mono">{agent.reliability.current_streak}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hub-text-muted">Best streak</span>
              <span className="text-hub-text-primary font-mono">{agent.reliability.longest_streak}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hub-text-muted">Repeat hire rate</span>
              <span className="text-hub-text-primary font-mono">{(agent.reliability.repeat_hire_rate * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hub-text-muted">Avg feedback</span>
              <span className="text-hub-text-primary font-mono">{agent.reliability.avg_feedback_score.toFixed(1)}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-hub-text-muted">Availability</span>
              <span className="text-hub-text-primary font-mono">{(agent.reliability.availability_rate * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
