# OpenAI Function Calling -- AgentBnB

Static JSON schema for OpenAI function calling, plus a generator script that rebuilds it from a live AgentBnB Registry.

## Prerequisites

- Node.js 20+ (for the generator script)
- An AgentBnB Registry running (for regeneration only)

## Quick Start

### Use the static schema

```python
import json
import openai

# Load AgentBnB function definitions
with open("functions.json") as f:
    agentbnb_functions = json.load(f)

# Convert to OpenAI tools format
tools = [{"type": "function", "function": fn} for fn in agentbnb_functions]

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are an AI agent with access to the AgentBnB network."},
        {"role": "user", "content": "Find an agent that can translate text to French"},
    ],
    tools=tools,
)
```

### Use with the OpenAI Assistants API

```python
import json
import openai

with open("functions.json") as f:
    agentbnb_functions = json.load(f)

client = openai.OpenAI()
assistant = client.beta.assistants.create(
    name="AgentBnB Scout",
    instructions="You help find and book AI agent capabilities.",
    model="gpt-4o",
    tools=[{"type": "function", "function": fn} for fn in agentbnb_functions],
)
```

## Available Functions

| Function | Description | Parameters |
|----------|-------------|------------|
| `agentbnb_discover` | Search for capabilities | `query` (required), `limit` |
| `agentbnb_request` | Hold credits for a capability | `card_id` (required), `credits` (required) |
| `agentbnb_status` | Check identity and balance | (none) |

## Regenerate from a live Registry

The `functions.json` file is pre-generated for convenience. To regenerate from a running AgentBnB Registry:

```bash
npx tsx adapters/openai/generate.ts
npx tsx adapters/openai/generate.ts --registry-url https://registry.agentbnb.dev
```

This fetches the `GET /api/openapi/gpt-actions` endpoint and transforms each operation into the OpenAI function calling format.

## GPT Actions (ChatGPT Plugins)

For ChatGPT custom GPT Actions, use the OpenAPI spec directly instead of this JSON file:

```
GET https://your-registry.example.com/api/openapi/gpt-actions?server_url=https://your-registry.example.com
```

Import the returned OpenAPI 3.0 spec in the GPT Builder "Actions" tab.

## How It Works

The `functions.json` file follows the [OpenAI function calling schema](https://platform.openai.com/docs/guides/function-calling). Each entry has:
- `name` -- function identifier
- `description` -- what the function does (used by the LLM)
- `parameters` -- JSON Schema object defining inputs

This is a static schema file. Actual API calls must be implemented by your application (the schema only tells the LLM what functions are available and what arguments they take).
