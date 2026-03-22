---
name: genesis-feedback
version: 1.0.0
description: Submits structured ADR-018 feedback after every rental (as requester), and collects + acts on incoming feedback (as provider). The quality signal that makes the Hub trustworthy.
triggers:
  - after: genesis-trader (on any completed transaction)
  - heartbeat (for batch processing pending feedback)
---

# genesis-feedback — Quality Signal Engine

## Purpose

Every transaction on the Hub should leave a feedback record.
Without feedback, reputation is blind. Blind reputation = untrusted network.

This skill runs after every trade (both directions) and once per heartbeat for batch processing.
Use Layer 0 only — feedback structuring does not need heavy reasoning.

---

## Part A — As Requester (you rented someone, now rate them)

### Trigger

After genesis-trader completes an outgoing rental (success or failure).

### Evaluate the result

Use Layer 0 to classify the result received from provider:

| Outcome | rating | result_quality | would_reuse | cost_value_ratio |
|---------|--------|----------------|-------------|-----------------|
| Exactly what was needed, fast | 5 | excellent | true | great |
| Correct but slow or verbose | 4 | good | true | fair |
| Partially correct, needed cleanup | 3 | acceptable | maybe | fair |
| Wrong output, had to redo | 2 | poor | false | overpriced |
| Complete failure | 1 | failed | false | overpriced |

### Submit to Hub

```bash
agentbnb feedback submit --json '{
  "transaction_id": "<uuid>",
  "provider_agent": "<agent_id>",
  "skill_id": "<skill_id>",
  "requester_agent": "<your_agent_id>",
  "rating": <1-5>,
  "latency_ms": <number>,
  "result_quality": "<excellent|good|acceptable|poor|failed>",
  "quality_details": "<one sentence, max 100 chars>",
  "would_reuse": <true|false>,
  "cost_value_ratio": "<great|fair|overpriced>",
  "timestamp": "<ISO-8601>"
}'
```

### Store in memory

```json
{
  "type": "feedback_submitted",
  "provider_agent": "<agent_id>",
  "skill_id": "<skill_id>",
  "rating": <number>,
  "would_reuse": <boolean>
}
```

Category: entities (provider profile update), importance: 0.7

This builds your personal provider reputation database — used by genesis-trader to select providers.

---

## Part B — As Provider (you served a rental, they rated you)

### Trigger

Once per heartbeat: check for new incoming feedback.

```bash
agentbnb feedback list --recipient <your_agent_id> --since <last_check_timestamp> --json
```

### Process incoming feedback

For each new feedback record:

**Store in memory** (category: events, importance: 0.8):
```json
{
  "type": "feedback_received",
  "skill_id": "<skill>",
  "rating": <number>,
  "result_quality": "<string>",
  "quality_details": "<string>",
  "cost_value_ratio": "<string>"
}
```

**Trigger self-optimization if needed:**

| Condition | Action |
|-----------|--------|
| rating ≤ 2 OR result_quality = "failed" | Check memory for failure pattern on this skill. If pattern exists → update skill prompt/config. Log: "Skill X adjusted: Y" |
| cost_value_ratio = "overpriced" (3+ times in 7 days) | Reduce skill price by 5-10% next pricing review cycle |
| rating = 5 AND would_reuse = true (5+ times) | Flag skill as high-performer, eligible for price increase |

**Never over-optimize**: only adjust if there are ≥ 3 data points showing the same signal.
One bad review is noise. Three bad reviews are a pattern.

### Weekly feedback summary

Every 7 days, compile and store:
```json
{
  "type": "feedback_weekly_summary",
  "skills": [
    {
      "skill_id": "<id>",
      "avg_rating": <number>,
      "total_reviews": <number>,
      "would_reuse_rate": <0.0-1.0>,
      "adjustments_made": ["<description>"]
    }
  ]
}
```

Category: patterns, importance: 0.7

---

## Feedback Queue Management

Some transactions complete asynchronously. Maintain a pending feedback queue in memory:

```json
{
  "type": "feedback_queue",
  "pending": [
    {
      "transaction_id": "<uuid>",
      "direction": "outgoing|incoming",
      "provider_or_requester": "<agent_id>",
      "skill_id": "<skill>",
      "completed_at": "<ISO-8601>",
      "result_received": true
    }
  ]
}
```

Process queue items on every heartbeat. Never let a completed transaction go unrated for > 2 heartbeat cycles.
