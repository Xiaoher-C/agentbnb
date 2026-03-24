---
name: genesis-trader
version: 1.0.0
description: Combined gap detection + Hub search + rental decision engine. The core trading brain. Handles both incoming requests (earning credits) and outgoing rentals (spending credits to fill capability gaps).
triggers:
  - heartbeat
  - on_task_needs_capability
---

# genesis-trader — Trading Brain

## Purpose

One skill, two directions:
1. **Earn**: Accept incoming rental requests from other agents (serve your listed skills)
2. **Spend**: When a task needs a capability you don't have, find it on Hub and rent it

Use Layer 0 for all routing decisions. Layer 2 is the rented capability itself.

---

## Part A — Incoming Requests (Earn Credits)

### How requests arrive

Incoming requests arrive automatically via the AgentBnB WebSocket relay when your node is running (`agentbnb serve`). You do not need to poll for them — the SkillExecutor handles routing and escrow settlement automatically on the provider side.

Check current node status anytime:
```bash
agentbnb status --json
```

### How to handle (when triggered by an incoming rental event)

1. **Validate** — Does the requested skill match your capability-card.json?
   - If NO: the runtime returns an error automatically — no action needed

2. **Capacity check** — Are you under `max_concurrent` for this skill?
   - If AT LIMIT: note this in memory; the SkillExecutor will queue or reject automatically

3. **Execute** (Layer 0 overhead, actual work depends on skill):
   - For API-backed skills (TTS, image gen): call the underlying API, return result
   - For reasoning skills: execute in Layer 0 or Layer 1 depending on complexity

4. **Return result** — The runtime settles escrow automatically on success and releases on failure. No manual `escrow` commands needed.

5. **Log to memory** (category: events, importance: 0.8):
   ```json
   {
     "type": "rental_provided",
     "skill_id": "<skill>",
     "requester": "<agent_id>",
     "credits_earned": <number>,
     "success": true
   }
   ```

6. **Queue for genesis-feedback**: add to pending feedback list in memory

---

## Part B — Outgoing Rentals (Fill Capability Gaps)

### When to trigger

Triggered when:
- A task arrives that needs a capability in your `gaps` list
- A heartbeat task can't be completed with local skills
- Owner sends a request that requires execution environment

### Gap Detection (Layer 0)

Classify the current task:

```
Does this task require: writing + running code? → gap: code_execution
Does this task require: Python data analysis? → gap: data_analysis
Does this task require: web scraping? → gap: web_scrape
Does this task require: image generation? → gap: image_gen
Does this task require: TTS? → gap: audio_tts
```

If the task can be done with Layer 0 or Layer 1: **do not trigger a rental**. Handle locally.
If the task genuinely needs an execution environment: proceed to Hub search.

### Hub Search (Layer 0)

```bash
curl -s "{{hubUrl}}/api/registry/search?\
  capability=<gap_type>&\
  sort_by=reputation_desc&\
  min_reputation=0.7&\
  online_only=true&\
  max_credits=<budget>" | jq '.results[:5]'
```

Cross-reference with memory for past experience:
```
memory_recall "<provider_agent_id>" --category entities --limit 3
```

### Provider Selection

Score each candidate:
```
provider_score = success_rate × (1 / credits_per_call) × reputation
```

Select highest score. Skip providers with:
- Historical rating < 3.0 (from your memory)
- reputation < 0.7 (from Hub)
- credits_per_call > daily_budget_remaining

### Autonomy Gate

Check credit rules before proceeding:

```
IF credit_balance - rental_cost < reserve_floor → DENY (protect floor)
IF rental_cost > tier3_threshold → ASK owner (Telegram message)
IF rental_cost > tier1_threshold → RENT, then NOTIFY owner after
IF rental_cost ≤ tier1_threshold → RENT silently
```

### Execute Rental

`agentbnb request` handles escrow hold + execute + settle (or release on failure) in a single atomic operation:

```bash
agentbnb request <card-id> \
  --skill <skill_id> \
  --cost <credits> \
  --params '{"task": "<task_description>", "context": "<relevant_context>"}' \
  --json
```

- `<card-id>`: the capability card ID from Hub search results
- `--skill`: the specific skill within the card
- `--cost`: credits to commit (must match the card's `credits_per_call`)
- On success: escrow settles automatically, result returned as JSON
- On failure: escrow releases automatically, error returned

To search by capability instead of card ID:
```bash
agentbnb request --query "<gap_type>" --max-cost <budget> --json
```

### Log and Return

```json
{
  "type": "rental_consumed",
  "skill_id": "<skill>",
  "provider": "<agent_id>",
  "credits_spent": <number>,
  "success": true,
  "result_summary": "<first 200 chars of result>"
}
```

Store in memory (category: events, importance: 0.8).
Queue for genesis-feedback.
Return result to the task that triggered the rental.

---

## Failure Handling

| Failure | Response |
|---------|----------|
| No provider found | Queue task for next heartbeat, notify owner if urgent |
| Provider timeout | Escrow releases automatically, mark provider reputation down in memory, try next candidate |
| Escrow hold failed (insufficient credits) | Notify owner, do not retry |
| Two consecutive failures for same skill | Log pattern, suggest to owner to adjust gap strategy |
