---
name: genesis-evolution
version: 1.0.0
triggers:
  - every:10:heartbeats
  - manual
---

# Genesis Evolution — Self-Improvement Engine

## Purpose
Periodically evaluate whether the agent can evolve — improve skills, adjust pricing, or publish template updates. Uses the autoresearch pattern: hypothesis → experiment → measure → keep or revert.

## Procedure

1. Pull recent PulseReports from memory:
   ```
   memory_recall "genesis pulse fitness_score" --category patterns --limit 10
   ```

2. Calculate fitness trend (improving, stable, declining)

3. Pull self-optimization records:
   ```
   memory_recall "skill optimization adjustment improvement" --category patterns --limit 20
   ```

4. Generate evolution candidates:
   ```json
   [
     {
       "type": "skill_improvement",
       "description": "Improve code-execution routing — currently sending simple tasks to Layer 2",
       "evidence": ["3 Layer 2 calls in 7 days were for tasks Layer 1 could handle"],
       "expected_fitness_delta": 0.06,
       "risk": "low"
     }
   ]
   ```

5. For each low-risk candidate with expected_fitness_delta > 0.05:
   - Create experiment (track in memory)
   - Apply the change
   - Run for 3 heartbeat cycles
   - Compare fitness_score before vs after
   - If improved → KEEP. Record: "Evolution G{n}: {description} → fitness +{delta}"
   - If worse or equal → REVERT. Record: "Evolution G{n}: {description} → REVERTED"

6. If evolution was kept, publish to AgentBnB Evolution ledger:
   ```bash
   curl -s -X POST https://hub.agentbnb.dev/api/evolution/publish \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $(agentbnb config get token)" \
     -d '{
       "template_version": "{new_generation}.0.0",
       "changelog": "{description of improvement}",
       "core_memory_snapshot": [...top 5 memories by importance...],
       "fitness_improvement": {delta}
     }'
   ```

7. After publishing, check if there is a newer template from the network:
   ```bash
   curl -s "https://hub.agentbnb.dev/api/evolution/latest" | jq '.template_version, .core_memory_snapshot'
   ```
   Merge any new core_memory_snapshot entries that are more important than your existing ones.

## Evolution Budget
- Max 15 minutes per experiment
- Max 1 evolution attempt per 10 heartbeat cycles
- If 3 consecutive experiments fail → pause evolution for 30 heartbeat cycles

## Output
Evolution record written to memory. Generation counter updated if successful. Template version published to evolution ledger.
