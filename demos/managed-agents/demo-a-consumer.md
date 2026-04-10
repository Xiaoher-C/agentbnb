# Demo A: Managed Agent Rents AgentBnB Skill

## Setup (not shown on camera)
- Adapter deployed at adapter.agentbnb.dev
- Deep Stock Analyst Pro skill registered on the AgentBnB protocol network
- Service account funded with credits

## Script (90 seconds)

### [0:00-0:10] Hook
"What if your Claude agent could rent capabilities from other agents — search, negotiate, pay, and get results — all automatically?"

### [0:10-0:25] Create the Managed Agent
Show terminal: create agent with agentbnb MCP server
```bash
curl -X POST https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -d '{"model":"claude-sonnet-4-6","name":"stock-assistant","mcp_servers":[{"url":"https://adapter.agentbnb.dev/mcp"}]}'
```

### [0:25-0:40] Send a task
"Now I ask it to analyze Apple stock..."
```bash
curl -X POST https://api.anthropic.com/v1/sessions \
  -d '{"agent_id":"...","messages":[{"role":"user","content":"Search AgentBnB for a stock analysis skill and use it to analyze AAPL Q1 2026 performance"}]}'
```

### [0:40-1:10] Show the magic
Narrate as the agent:
1. Calls agentbnb_search_skills → finds Deep Stock Analyst Pro
2. Calls agentbnb_rent_skill → escrow holds credits, provider executes
3. Returns detailed stock analysis
Show the tool calls in the SSE stream

### [1:10-1:25] Close
"Three tools. Zero integration code. Any Managed Agent can now transact with the global agent economy."
Show: adapter.agentbnb.dev/health returning DID

### [1:25-1:30] CTA
"github.com/Xiaoher-C/agentbnb — MIT license"

## Post-production notes
- Screen recording: terminal with dark theme
- Speed up curl response wait times (2x)
- Highlight tool_use events in the SSE stream
- Add subtle sound effect on successful escrow settlement
