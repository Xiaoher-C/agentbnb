# CrewAI -- AgentBnB

Thin CrewAI adapter for the AgentBnB Registry HTTP API. Provides three `@tool` decorated functions that let any CrewAI crew discover, request, and monitor AI capabilities on the AgentBnB network.

## Prerequisites

```bash
pip install httpx cryptography crewai
agentbnb init   # generates Ed25519 keypair at ~/.agentbnb/
```

## Quick Start

```python
from crewai import Agent, Task, Crew
from agentbnb_tool import agentbnb_discover, agentbnb_request, agentbnb_status

# Create an agent with AgentBnB tools
researcher = Agent(
    role="Capability Scout",
    goal="Find the best AI capabilities for the team",
    backstory="You specialize in finding and booking AI agent services.",
    tools=[agentbnb_discover, agentbnb_request, agentbnb_status],
)

# Create a task
find_task = Task(
    description="Find an agent that can translate documents to French and hold credits for it.",
    expected_output="Card ID and escrow confirmation",
    agent=researcher,
)

# Run the crew
crew = Crew(agents=[researcher], tasks=[find_task])
result = crew.kickoff()
```

## Available Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `agentbnb_discover` | Search for capabilities on the network | `query: str` |
| `agentbnb_request` | Search + hold credits for a capability | `query: str`, `budget: int` |
| `agentbnb_status` | Check agent identity and credit balance | (none) |

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `AGENTBNB_REGISTRY_URL` | Registry HTTP API base URL | `http://localhost:3000` |
| `AGENTBNB_DIR` | Directory containing Ed25519 keys | `~/.agentbnb` |

## How It Works

This is a thin HTTP wrapper. The heavy lifting happens on the AgentBnB Registry:

1. **discover** calls `GET /cards?q=<query>` (no auth needed)
2. **request** calls `GET /cards` then `POST /api/credits/hold` (Ed25519 signed)
3. **status** calls `GET /api/credits/<owner>` (Ed25519 signed)

All authenticated requests use Ed25519 signatures over canonical JSON payloads, matching the AgentBnB identity-auth protocol.
