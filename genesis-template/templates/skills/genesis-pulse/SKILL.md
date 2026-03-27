---
name: genesis-pulse
version: 2.0.0
description: Self-reflection engine. Runs at the start of every heartbeat. Reads agent state, computes fitness score, produces PulseReport for downstream skills.
triggers:
  - heartbeat_start
  - on_request: status
---

# genesis-pulse — Self-Reflection Engine

## Purpose

Run at the start of every heartbeat cycle. Produce a PulseReport that all downstream skills read.
Use Layer 0 (Haiku/Flash) only. This skill should consume < 2,000 tokens per run.

---

## Procedure

### Step 1 — Read current state (all Layer 0)

```bash
# Credit balance from AgentBnB
agentbnb status --json

# Recent task results from memory
memory_recall "task result" --category events --limit 10 --since 7d

# Recent feedback received
memory_recall "feedback received" --category events --limit 10 --since 7d
```

### Step 2 — Calculate idle_rate

```
idle_rate = 1 - (active_execution_seconds_in_last_60min / 3600)
```

If no execution data available: assume idle_rate = 1.0 (safe default for new agents).

### Step 3 — Compute fitness_score

Pull 7-day data from memory (category: patterns, tag: pulse-history):

```
task_success_rate_7d   = successful_tasks / total_tasks (default 1.0 if no history)
credit_growth_rate_7d  = (balance_now - balance_7d_ago) / max(balance_7d_ago, 1)
utilization_rate       = 1 - idle_rate (how much of capacity was used productively)
feedback_avg_score     = average of all received ratings (1-5, default 3.0)

fitness_score =
  0.4 × task_success_rate_7d +
  0.3 × clamp(credit_growth_rate_7d, -1, 1) × 0.5 + 0.15 +  # normalized to 0-0.3 range
  0.2 × utilization_rate +
  0.1 × (feedback_avg_score / 5)
```

### Step 4 — Produce PulseReport

Write as structured JSON to memory (category: patterns, tag: pulse-current, importance: 0.6):

```json
{
  "timestamp": "<ISO-8601>",
  "generation": 1,
  "credit_balance": <number>,
  "idle_rate": <0.0-1.0>,
  "active_skills": ["genesis-pulse", "genesis-trader", ...],
  "recent_tasks_7d": <count>,
  "recent_failures_7d": <count>,
  "pending_incoming_requests": <count>,
  "fitness_score": <0.0-1.0>,
  "fitness_components": {
    "task_success_rate_7d": <number>,
    "credit_growth_rate_7d": <number>,
    "utilization_rate": <number>,
    "feedback_avg_score": <number>
  },
  "layer1_tokens_today": <count>,
  "layer2_credits_today": <number>,
  "alerts": [],
  "self_summary": {
    "capabilities": ["<skill_id_1>", "<skill_id_2>"],
    "success_rate": <task_success_rate_7d>,
    "credit_balance": <number>,
    "total_completed": <lifetime execution count>,
    "provider_number": <number>,
    "reliability": {
      "current_streak": <number>,
      "repeat_hire_rate": <number>,
      "avg_feedback": <feedback_avg_score>
    }
  }
}
```

### Step 4.5 — Generate self_summary (v7 Heartbeat)

Build the `self_summary` object for heartbeat consumption:

```bash
# Read reliability metrics
curl -s "{{hubUrl}}/api/providers/<your_owner>/reliability" | jq '.'

# Read provider number
agentbnb status --json | jq '.provider_number'
```

Produce:
```json
{
  "capabilities": ["<skill_id_1>", "<skill_id_2>", ...],
  "success_rate": <task_success_rate_7d from fitness>,
  "credit_balance": <from agentbnb status>,
  "total_completed": <lifetime execution count from memory>,
  "provider_number": <from agentbnb status>,
  "reliability": {
    "current_streak": <from reliability API>,
    "repeat_hire_rate": <from reliability API>,
    "avg_feedback": <from reliability API or feedback_avg_score>
  }
}
```

Store in memory (category: patterns, tag: self-summary, importance: 0.7).
This is consumed by the heartbeat system to populate relay heartbeat messages.

### Step 5 — Fitness alerts

| Condition | Action |
|-----------|--------|
| fitness_score < 0.4 | Add alert: `"fitness_low"` |
| fitness_score < 0.2 | Add alert: `"fitness_critical"` — notify owner immediately |
| layer1_tokens_today > 80% of daily cap | Add alert: `"layer1_budget_warning"` |
| layer2_credits_today > 80% of daily cap | Add alert: `"layer2_budget_warning"` |
| credit_balance ≤ reserve_floor | Add alert: `"credit_floor_reached"` |
| current_streak == 0 AND total_hires > 5 | Add alert: `"streak_broken"` — investigate recent failure |

If any `fitness_critical` alert: send Telegram message to owner with fitness score and top failure reason.

---

## Output

PulseReport stored in memory. Available to all downstream skills in same heartbeat cycle via:
```
memory_recall "pulse-current" --category patterns --limit 1
```
