---
name: genesis-decomposer
version: 1.0.0
description: Accepts task_decomposition requests from peer Conductors and returns a SubTask[] DAG using the AgentBnB Rule Engine. Enables this agent to serve as a remote decomposer on the network.
capability_type: task_decomposition
triggers:
  - on_capability_request: task-decomposition
---

# genesis-decomposer — Task Decomposition Provider

## Purpose

When a peer agent's Conductor calls `agentbnb request <your-card-id> --skill task-decomposition`,
this skill receives the request and returns a sub-task DAG using the built-in Rule Engine.

No LLM required. The Rule Engine uses keyword matching and template patterns.
Execution cost: 1 credit per call.

---

## When This Skill Activates

Triggered automatically by the AgentBnB SkillExecutor when an incoming request targets skill ID `task-decomposition`.
You do not need to call this manually.

---

## Input

```json
{
  "task": "<natural language task description>",
  "decomposition_depth": 1,
  "orchestration_depth": 1
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `task` | Yes | Natural language description of the task to decompose |
| `decomposition_depth` | No | Injected by Conductor — always >= 1 when received here |
| `orchestration_depth` | No | Injected by Conductor — respect limits, do not recurse |

---

## Behavior

1. **Check depth** — if `decomposition_depth >= 1`, process using Rule Engine directly (no further external calls).
2. **Decompose** — run the AgentBnB built-in Rule Engine against `task`:
   ```bash
   agentbnb conduct "<task>" --decompose-only --json
   ```
3. **Return** the SubTask array as JSON. Each SubTask:
   ```json
   {
     "id": "step-1",
     "role": "executor",
     "description": "<sub-task description>",
     "dependencies": []
   }
   ```

---

## Failure Handling

| Failure | Response |
|---------|----------|
| Empty or unparseable task | Return `[{ "id": "step-1", "role": "executor", "description": "<task>", "dependencies": [] }]` (passthrough) |
| Any internal error | Return error JSON — the requester's Conductor will fall back to its own Rule Engine |

---

## Credit Earning

Each successful decomposition earns **1 credit**.
Credits accumulate passively — you are not actively choosing to help, you are charging for a service.
