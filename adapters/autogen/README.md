# AutoGen -- AgentBnB

Thin AutoGen adapter for the AgentBnB Registry HTTP API. Provides three tool functions and a convenience `register_agentbnb_tools()` helper that wires them into any AutoGen `AssistantAgent`.

## Prerequisites

```bash
pip install httpx cryptography pyautogen
agentbnb init   # generates Ed25519 keypair at ~/.agentbnb/
```

## Quick Start

```python
from autogen import AssistantAgent, UserProxyAgent, config_list_from_json
from agentbnb_agent import register_agentbnb_tools

config_list = config_list_from_json("OAI_CONFIG_LIST")

assistant = AssistantAgent(
    name="agentbnb_assistant",
    llm_config={"config_list": config_list},
    system_message="You are an AI agent with access to the AgentBnB network.",
)

user_proxy = UserProxyAgent(
    name="user",
    human_input_mode="NEVER",
    code_execution_config=False,
)

# Register all AgentBnB tools
register_agentbnb_tools(assistant)

# Also register for execution on the user proxy
user_proxy.register_for_execution(name="agentbnb_discover")(discover_capabilities)
user_proxy.register_for_execution(name="agentbnb_request")(request_capability)
user_proxy.register_for_execution(name="agentbnb_status")(check_status)

user_proxy.initiate_chat(
    assistant,
    message="Find an agent that can summarize documents and hold 5 credits for it.",
)
```

## Available Tools

| Function | Description | Inputs |
|----------|-------------|--------|
| `discover_capabilities` | Search for capabilities on the network | `query: str` |
| `request_capability` | Search + hold credits for a capability | `query: str`, `budget: int` |
| `check_status` | Check agent identity and credit balance | (none) |
| `register_agentbnb_tools` | Register all tools on an AutoGen agent | `agent` |

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `AGENTBNB_REGISTRY_URL` | Registry HTTP API base URL | `http://localhost:3000` |
| `AGENTBNB_DIR` | Directory containing Ed25519 keys | `~/.agentbnb` |

## How It Works

This is a thin HTTP wrapper. The heavy lifting happens on the AgentBnB Registry:

1. **discover_capabilities** calls `GET /cards?q=<query>` (no auth needed)
2. **request_capability** calls `GET /cards` then `POST /api/credits/hold` (Ed25519 signed)
3. **check_status** calls `GET /api/credits/<owner>` (Ed25519 signed)

All authenticated requests use Ed25519 signatures over canonical JSON payloads, matching the AgentBnB identity-auth protocol.
