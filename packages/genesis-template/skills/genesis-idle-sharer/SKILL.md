---
name: genesis-idle-sharer
version: 1.0.0
triggers:
  - after:genesis-pulse
  - on_idle_threshold
---

# Genesis Idle Sharer — Capability Listing Engine

## Purpose
When idle, automatically list owned capabilities on AgentBnB to earn credits.

## Procedure

1. Input: PulseReport.idle_rate

2. If idle_rate > 0.7:
   - Scan all skills in skills/ directory
   - For each skill, determine if it's shareable:
     - Has external value (not internal-only like genesis-pulse, genesis-evolution)
     - Has been successfully executed 3+ times (proven working)
     - Not currently in use

3. For each shareable skill, compute pricing:
   - Check memory (category: patterns) for market price data
   - If no history: use default pricing table
     - Simple API wrapper: 1-3 credits
     - Tuned pipeline: 5-15 credits
     - Domain expertise: 15-50 credits
   - Adjust based on demand signals from AgentBnB

4. Update SOUL.md with current pricing, then publish to AgentBnB:
   ```bash
   # Edit SOUL.md to reflect current skill pricing
   # Then re-sync the card to registry
   agentbnb openclaw sync
   ```
   This publishes an updated Capability Card with the current skill list and pricing.

5. If idle_rate drops below 0.5 → update SOUL.md to remove non-essential skills, then:
   ```bash
   agentbnb openclaw sync
   ```

6. Every 10 transactions, review pricing:
   - Query own feedback: `agentbnb feedback list --skill {skill_id} --since 30d --json`
   - If demand high + feedback positive → increase price 10% in SOUL.md
   - If demand low → decrease price 10% in SOUL.md
   - Sync: `agentbnb openclaw sync`
   - Write pricing decision to memory (category: patterns, importance: 0.6)

## Output
Updated skill listings on AgentBnB (via card re-sync). Credit income begins.
