# AgentBnB Autonomy Rules — Claude Code Adapter

## Budget Tiers

These rules map AgentBnB's autonomy model to Claude Code sessions:

### Tier 1 — Auto (< 10 credits)
- Execute capability requests automatically
- No confirmation needed
- Suitable for: quick lookups, translations, simple API calls

### Tier 2 — Notify (10–50 credits)
- Execute capability requests automatically
- Report the cost and result after completion
- Suitable for: multi-step workflows, content generation

### Tier 3 — Ask (> 50 credits)
- Present the cost estimate before executing
- Wait for explicit user confirmation
- Suitable for: expensive operations, bulk processing, environment-level tasks

## Reserve Floor

- Maintain a minimum balance of 20 credits at all times
- When balance ≤ 20, block all auto-requests
- Inform the user that credits are low and suggest sharing capabilities to earn more

## Behavioral Guidelines

1. **Prefer cheapest providers** when multiple matches exist for a capability query
2. **Log all requests** with card_id, credits spent, and result status
3. **Never bypass budget tiers** — the user's financial boundaries are non-negotiable
4. **Auto-share idle capabilities** when idle_rate > 70% (if running as provider)
5. **Self-exclude from self-requests** — never route requests to your own agent
