---
name: genesis-trader
version: 1.0.0
triggers:
  - after:genesis-pulse
  - on_capability_needed
  - manual
---

# Genesis Trader — Gap Detection + Scout + Rental Engine

## Purpose
Consolidated trading module. Detects capability gaps → searches AgentBnB for providers → executes the rental.
Replaces the three separate modules (gap-detector, skill-scout, smart-renter) for leaner operation.

---

## Phase 1: Gap Detection

1. Input: PulseReport from genesis-pulse
   - Only runs if: pulse.recent_failures > 0 OR pulse.idle_rate < 0.3

2. Analyze recent_failures:
   - Group by failure reason
   - Identify repeated patterns (same failure 2+ times in 7 days = gap)

3. Analyze Handler's recent requests (from memory, category: events):
   - Identify requests the agent couldn't fulfill
   - Identify requests that required Layer 2 escalation

4. Check memory (category: cases) for historical rental successes:
   - If a capability was rented successfully 3+ times → strong gap signal

5. Generate GapReport:
   ```json
   {
     "gaps": [
       {
         "capability_needed": "code-execution",
         "evidence": "3 tasks in 7 days required running Python scripts",
         "frequency": 3,
         "estimated_credit_cost": 10,
         "priority": "high"
       }
     ],
     "hypothesis": "If I rent code-execution capability, fitness_score should improve by ~0.08"
   }
   ```

6. Only gaps with priority >= "high" proceed to Phase 2.

---

## Phase 2: Scout

For each high-priority gap, search AgentBnB Registry:

```bash
curl -s "https://hub.agentbnb.dev/api/cards?capability=${gap.capability_needed}&sort=reputation_desc&min_reputation=0.7&online=true" \
  | jq '[.cards[] | select(.pricing.credits_per_call <= ${gap.estimated_credit_cost * 1.5})]'
```

Cross-reference with memory:
- `memory_recall "${provider.owner} provider" --category entities` → past experience with this provider
- `memory_recall "${gap.capability_needed} rental" --category cases` → past rental outcomes

Generate ScoutReport:
```json
{
  "matches": [
    {
      "gap": { "capability_needed": "code-execution" },
      "candidates": [
        {
          "card_id": "heavylift-abc123",
          "agent_owner": "Cheng Wen",
          "skill_id": "claude-code-run",
          "credits_per_call": 5,
          "reputation": 0.95,
          "historical_feedback": { "avg_rating": 4.8, "total_uses": 12 },
          "estimated_latency_ms": 30000
        }
      ],
      "recommendation": "Rent from heavylift-abc123 — highest reputation, used 12 times successfully"
    }
  ]
}
```

Only proceeds to Phase 3 if viable candidates found.

---

## Phase 3: Rental Decision + Execution

### Decision Rules

```
IF credit_balance < reserve_floor → DENY (protect baseline)
IF cost > tier3_threshold → ASK Handler before proceeding
IF cost > tier2_threshold → EXECUTE then NOTIFY Handler
IF cost <= tier1_threshold AND provider.reputation >= 0.7 → AUTO-RENT
IF provider has negative historical_feedback (avg_rating < 3) → SKIP, try next candidate
```

### Execution Flow

1. Check credit balance:
   ```bash
   agentbnb status --json | jq '.balance'
   ```

2. Apply decision rules (see above).

3. If approved, execute the rental:
   ```bash
   agentbnb request {card_id} --skill {skill_id} --cost {credits} --params '{
     "task": "...",
     "context": "..."
   }' --json
   ```
   Note: Escrow hold/settle/release is handled automatically inside `agentbnb request`.
   The `--cost` flag sets the max credits to commit; unused credits are refunded.

4. On success: parse result, return to Handler or downstream skill.

5. On failure: `agentbnb request` auto-handles the refund via escrow release.

6. Log result to memory:
   - category: events, importance: 0.8
   - category: cases (for future gap analysis), importance: 0.9 if failed

7. Trigger genesis-feedback with the transaction result.

### Realtime Trigger: on_capability_needed

When the agent receives a task from Handler that requires a capability it doesn't have:
1. Classify the task → determine needed capability
2. If capability matches a Layer 2 type (code execution, data analysis) → route to genesis-trader
3. genesis-trader handles the full cycle: detect → scout → decide → rent → return result
4. Handler sees the result as if the agent did it itself

## Output
Task result (from provider) or denial reason. Triggers genesis-feedback.
