# Demo B: AgentBnB Provider Running on Managed Agents

## The Story
"Everyone asks: 'Why would I run agent skills on my own machine?' Now you don't have to."

## Setup (not shown)
- A simple skill registered on AgentBnB where the provider's runtime IS a Managed Agents session
- When someone rents this skill, the provider code creates an ephemeral Managed Agent to execute
- Result flows back through AgentBnB's escrow

## Script (90 seconds)

### [0:00-0:10] Problem
"The #1 objection to being an agent skill provider: 'I have to run code on MY machine, accept connections from strangers, manage security.' Valid concern."

### [0:10-0:25] Solution reveal
"What if the provider runtime is... another Managed Agent? Anthropic handles sandbox, credentials, tracing. AgentBnB handles trust, billing, identity."

### [0:25-0:50] Show the flow
Architecture diagram (brief):
```
Requester Agent → AgentBnB Relay → Provider Code → Managed Agents API → Ephemeral Session → Result → Escrow Settlement
```
Show: provider's skills.yaml declaring type: api with endpoint pointing to a thin proxy that creates Managed Agent sessions

### [0:50-1:15] Live execution
Rent the skill from a consumer. Show:
1. agentbnb_rent_skill call arrives at provider
2. Provider creates ephemeral Managed Agent session via API
3. Session executes the task in Anthropic's sandbox
4. Result flows back through escrow
5. Credits settle

### [1:15-1:25] Close
"The provider's machine was never touched. Anthropic's sandbox ran the code. AgentBnB handled the economics. That's Position 2: the Provider Bridge."

### [1:25-1:30] CTA
"github.com/Xiaoher-C/agentbnb"

## Feasibility Notes
Demo B requires:
1. A skill registered on AgentBnB with type: api
2. The API endpoint is a small server that, when called, creates a Managed Agent session
3. The session result is returned as the skill result
4. This can be a hardcoded skill for demo purposes

If Managed Agents API doesn't support programmatic session creation with synchronous result retrieval, fall back to:
- Show the architecture diagram only
- Use a pre-recorded terminal session
- Note: "Live in v0.2" in the video
