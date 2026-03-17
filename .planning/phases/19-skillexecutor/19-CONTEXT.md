# Phase 19: SkillExecutor - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning
**Source:** PRD Express Path (v3.0-milestone.md)

<domain>
## Phase Boundary

This phase delivers a config-driven execution engine (`SkillExecutor`) that replaces the empty `localhost:8080` handler URL. After this phase, agents can actually execute capabilities when they receive requests through the Gateway.

Four execution modes via `~/.agentbnb/skills.yaml`:
- **API Wrapper** (Mode A) — config-driven REST API calls
- **Pipeline** (Mode B) — chain multiple skills sequentially
- **OpenClaw Bridge** (Mode C) — forward to OpenClaw agent
- **Command** (Mode D) — run local shell commands/scripts

</domain>

<decisions>
## Implementation Decisions

### Skill Configuration
- Skills defined in `~/.agentbnb/skills.yaml` (YAML, not code)
- Parsed on AgentRuntime startup
- Auto-generate Capability Cards from skill config
- Zod schema validation for skill config

### SkillExecutor Interface
- `execute(skillId: string, params: Record<string, unknown>): Promise<ExecutionResult>`
- `ExecutionResult`: `{ success: boolean; result?: unknown; error?: string; latency_ms: number }`
- Dispatcher pattern: `Map<string, ExecutorMode>` keyed by `type` field
- New files: `src/skills/executor.ts`, `src/skills/skill-config.ts`

### API Executor (Mode A)
- Support REST APIs (GET/POST/PUT/DELETE)
- Auth types: bearer token, API key header, basic auth
- Input mapping: AgentBnB params → API request (body, query, path, header)
- Output mapping: extract result from API response
- Retry logic: configurable retries on 429/500/503
- Timeout: configurable per skill
- Environment variable expansion: `${ENV_VAR}` syntax
- New file: `src/skills/api-executor.ts`

### Pipeline Executor (Mode B)
- Sequential step execution
- `${prev.result}` to reference previous step's output
- `${steps[N].result}` to reference any step's output
- `command` steps for local shell execution (ffmpeg, imagemagick, etc.)
- Partial failure handling: if step N fails, stop pipeline
- Variable interpolation utility at `src/utils/interpolation.ts` (shared with Phase 22-01 Conductor PipelineOrchestrator)
- New file: `src/skills/pipeline-executor.ts`

### OpenClaw Bridge (Mode C)
- Translate AgentBnB `{ skill_id, params }` → OpenClaw task format
- Support Telegram, webhook, and direct process communication
- Wait for OpenClaw agent response (with timeout)
- Map OpenClaw result back to AgentBnB format
- New file: `src/skills/openclaw-bridge.ts`

### Command Executor (Mode D)
- Shell command execution with parameter substitution
- Support for `output_type: json | text | file`
- Sandboxing: configurable allowed commands list (security)
- Working directory: configurable per skill
- Timeout: kill process after N seconds
- New file: `src/skills/command-executor.ts`

### Gateway Integration
- Replace `fetch(handlerUrl, ...)` with `runtime.skillExecutor.execute(skillId, params)` in `src/gateway/server.ts` L192-198
- Add `skillExecutor` property to `AgentRuntime` in `src/runtime/agent-runtime.ts`
- Initialize SkillExecutor from skills.yaml on `runtime.start()`
- `agentbnb serve` starts Gateway + SkillExecutor together

### Claude's Discretion
- Internal error handling strategy within each executor
- Test fixture design (mock HTTP servers, test skills.yaml configs)
- Exact Zod schema field names for skill config
- Whether to use `js-yaml` or built-in YAML parsing
- Exact retry backoff strategy for API Executor

</decisions>

<specifics>
## Specific Ideas

### skills.yaml Example (from v3.0-milestone.md)
```yaml
skills:
  - id: tts-elevenlabs
    type: api
    name: "ElevenLabs TTS"
    provider: elevenlabs
    endpoint: "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    method: POST
    auth:
      type: bearer
      token: ${ELEVENLABS_API_KEY}
    input_mapping:
      text: body.text
      voice_id: path.voice_id
    output_mapping:
      audio: response.audio
    pricing:
      credits_per_call: 5

  - id: video-production
    type: pipeline
    name: "AI Video Pipeline"
    steps:
      - skill_id: text-gen-gpt4o
        input_mapping:
          prompt: "Write a 30-second video script about: ${params.topic}"
      - skill_id: tts-elevenlabs
        input_mapping:
          text: ${prev.result.text}
      - command: "ffmpeg -i ${steps[1].result.audio} output.mp4"
    pricing:
      credits_per_call: 40

  - id: creative-director
    type: openclaw
    name: "Creative Director"
    agent_name: chengwen-openclaw
    channel: telegram
    pricing:
      credits_per_call: 20

  - id: image-comfyui
    type: command
    name: "ComfyUI Image Gen"
    command: "python3 /path/to/comfyui_api.py --prompt '${params.prompt}'"
    output_type: file
    pricing:
      credits_per_call: 15
```

### Key Modification Points
- `src/gateway/server.ts` L192-198: handler dispatch replacement
- `src/runtime/agent-runtime.ts`: SkillExecutor lifecycle ownership
- `src/skills/handle-request.ts`: existing HandlerMap pattern (reference, not modify)

### Architecture Slot
```
AgentRuntime (existing)
├── Gateway          (communication — exists)
├── IdleMonitor      (detection — exists)
├── AutoRequestor    (requesting — exists)
├── BudgetManager    (budgeting — exists)
└── SkillExecutor    (execution — THIS PHASE)
    ├── APIExecutor
    ├── PipelineExecutor
    ├── CommandExecutor
    └── OpenClawBridge
```

</specifics>

<deferred>
## Deferred Ideas

- LLM-powered skill routing (v4.0)
- Skill marketplace / remote skill discovery
- Skill versioning and rollback
- Skill health monitoring and circuit breaking
- Production hardening (rate limiting, metrics) — post-launch v3.1+

</deferred>

---

*Phase: 19-skillexecutor*
*Context gathered: 2026-03-17 via PRD Express Path*
