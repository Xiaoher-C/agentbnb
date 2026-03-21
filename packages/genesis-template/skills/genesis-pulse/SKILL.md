---
name: genesis-pulse
version: 1.0.0
triggers:
  - heartbeat
  - on_task_complete
  - on_error
---

# Genesis Pulse — Self-Reflection Engine

## Purpose
Run at the start of every heartbeat cycle. Produces a PulseReport that drives all downstream modules.

## Procedure

1. Read current agent state:
   - List all skills in skills/ directory
   - Query AgentBnB credit balance: `agentbnb status --json`
   - Query memory for recent task results: `memory_recall "genesis task result" --limit 10 --category events`
   - Calculate idle_rate = 1 - (active_execution_seconds_last_hour / 3600)

2. Compute fitness_score:
   ```
   fitness = 0.4 * success_rate_7d + 0.3 * credit_growth_7d + 0.2 * utilization + 0.1 * feedback_avg
   ```

3. Generate PulseReport:
   ```json
   {
     "timestamp": "ISO-8601",
     "generation": 1,
     "credit_balance": 85,
     "idle_rate": 0.72,
     "capabilities": ["genesis-pulse", "genesis-trader", "genesis-idle-sharer", "genesis-feedback", "genesis-evolution"],
     "recent_tasks": [],
     "recent_failures": [],
     "pending_feedback": 0,
     "fitness_score": 0.65,
     "layer1_tokens_today": 45000,
     "layer2_credits_today": 12
   }
   ```

4. Store PulseReport to memory:
   `memory_store` category=patterns, importance=0.6, scope=agent:pulse

5. If fitness_score < 0.4 → flag for Handler notification
6. If fitness_score < 0.2 → escalate to Handler immediately

## Output
PulseReport JSON available to downstream modules (genesis-trader, genesis-idle-sharer, genesis-evolution).
