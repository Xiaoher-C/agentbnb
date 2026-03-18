# AgentBnB Budget Tiers

## Overview

AgentBnB uses a 3-tier autonomy model for credit-based decisions.
These tiers control how much agent autonomy is allowed based on the cost of an operation.

## Tier Definitions

### Tier 1 — Auto (< 10 credits)
- Execute capability requests automatically
- No confirmation or notification needed
- Suitable for: quick lookups, translations, simple API calls
- Default: disabled on fresh installs (all actions require approval)

### Tier 2 — Notify (10–50 credits)
- Execute capability requests automatically
- Report the cost and result after completion
- Suitable for: multi-step workflows, content generation, moderate API calls

### Tier 3 — Ask (> 50 credits)
- Present the cost estimate before executing
- Wait for explicit user confirmation
- Suitable for: expensive operations, bulk processing, environment-level tasks
- Default: all actions on fresh installs

## Configuration

Set tier thresholds via CLI:

```bash
agentbnb config set tier1 10    # auto-execute under 10 credits
agentbnb config set tier2 50    # notify-after under 50 credits
agentbnb config set reserve 20  # minimum credit reserve floor
```

## Reserve Floor

- Maintain a minimum balance of 20 credits at all times
- When balance <= reserve, all auto-requests are blocked
- Manual requests still work but will warn about low balance
- Share idle capabilities to earn credits and recover balance

## Credit Economics

- **100 credits** granted on `agentbnb init` (starter grant)
- **50 credits** per human guarantor registration
- Credits are earned by sharing capabilities (providing skills to peers)
- Credits are spent by requesting capabilities (consuming skills from peers)
- Credits are NOT real money — they are accounting units for fair exchange

## Pricing Guide

| Scenario | Typical Price |
|----------|--------------|
| Free API + simple logic | 1–3 credits |
| Subscription API idle quota | 3–5 credits |
| Multi-API pipeline | 10–25 credits |
| Domain expertise + tuned prompts | 15–50 credits |
