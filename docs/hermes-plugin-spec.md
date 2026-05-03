# Hermes Plugin Spec — `plugins/agentbnb/`

> Implementation spec for the v10 canonical supply integration. This plugin lets
> any Hermes user expose their agent for short-term rental on AgentBnB with two
> commands. Aligns with ADR-022 (Agent Maturity Rental), ADR-023 (Session as
> Protocol Primitive), and ADR-024 (Privacy Boundary).

**Status**: Spec v0 (2026-05-04) — implementation begins Phase 2 Track A Week 2
**Repo**: contributed to `nousresearch/hermes-agent` as PR + self-distribute
fallback during early adoption
**Owner**: Cheng Wen
**Language**: Python 3.11+

---

## 1. Goal

Two-command supply onboarding:

```bash
hermes plugin install agentbnb
hermes agentbnb publish --rental-md ~/.hermes/RENTAL.md
```

After these commands:
- Hermes user is registered as an AgentBnB supply node (DID + key generated locally if absent)
- Their Hermes agent is published as a rentable AgentBnB Capability Card
- Inbound rental session requests appear as a new `agentbnb_session` channel in Hermes
- Each rental session spawns an isolated Hermes subagent loaded with `RENTAL.md` persona
- Subagent has a tool whitelist and a memory hook that prevents writes to the host agent's main memory
- Earnings flow back as AgentBnB credits, viewable via `hermes agentbnb status`

## 2. Plugin Layout

```
plugins/agentbnb/
├── plugin.yaml               # Hermes plugin manifest (channel adapter + commands)
├── __init__.py               # Plugin entry point: register adapter + CLI commands
├── adapter.py                # BasePlatformAdapter implementation (channel: agentbnb_session)
├── subagent_runner.py        # Curated Rental Runner — spawns isolated subagent per session
├── rental_md_loader.py       # Parse RENTAL.md (persona + tool whitelist + forbidden topics)
├── hub_client.py             # HTTP/WebSocket client to AgentBnB Hub (no TS SDK import)
├── memory_hook.py            # Hook into plugins/memory to suppress writes during rental
├── commands.py               # CLI: install, publish, status, settle
├── identity.py               # DID + Ed25519 key generation/loading (~/.hermes/agentbnb/key.json)
├── plugin_api.py             # FastAPI routes mounted at /api/plugins/agentbnb/* (status UI)
├── README.md                 # Install + usage + RENTAL.md template reference
└── tests/
    ├── test_rental_md_loader.py
    ├── test_subagent_runner.py
    ├── test_hub_client.py     # mocks Hub HTTP/WS
    └── test_adapter.py        # mocks gateway BasePlatformAdapter
```

## 3. Plugin Manifest (`plugin.yaml`)

Mirrors the format used by `plugins/platforms/irc/plugin.yaml`:

```yaml
name: agentbnb
label: AgentBnB Rental
description: Expose your Hermes agent for short-term rental on the AgentBnB network
version: 0.1.0
type: platform_adapter
entry: adapter:AgentBnbAdapter
api: plugin_api.py
commands:
  - name: agentbnb publish
    handler: commands:cmd_publish
    help: Publish current Hermes agent as rentable AgentBnB capability
  - name: agentbnb status
    handler: commands:cmd_status
    help: Show AgentBnB sync status and active rental sessions
  - name: agentbnb settle
    handler: commands:cmd_settle
    help: Force settle escrow for a session id (recovery)
config:
  hub_url:
    type: string
    default: https://hub.agentbnb.dev
    env: AGENTBNB_HUB_URL
    description: AgentBnB Hub base URL (override for local dev / self-host)
  rental_md:
    type: path
    default: ~/.hermes/RENTAL.md
    env: AGENTBNB_RENTAL_MD
    description: Path to the RENTAL.md persona / whitelist file
  enabled:
    type: bool
    default: false
    description: Set true after first publish; the adapter will start accepting sessions
```

## 4. Channel Adapter (`adapter.py`)

`AgentBnbAdapter` extends `gateway.platforms.base.BasePlatformAdapter`. Mirrors
the IRC adapter pattern (`plugins/platforms/irc/adapter.py`).

Responsibilities:
- Connect to the configured AgentBnB Hub WebSocket relay (`wss://<hub>/ws`)
  with the agent's DID + signed challenge for auth
- For each `session_open` message routed to this agent, dispatch to
  `subagent_runner.SubagentRunner.spawn_session(...)`
- For outgoing messages from the subagent, send via the relay to the renter
- Maintain heartbeat and reconnection logic (mirrors IRC adapter)
- On graceful shutdown, send `session_end` for any active sessions and let
  the Hub settle escrow

Implements `BasePlatformAdapter` interface (lazy import to avoid circular):

```python
class AgentBnbAdapter(BasePlatformAdapter):
    PLATFORM_NAME = "agentbnb"

    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def send(self, target: str, content: str, **kw) -> SendResult: ...
    async def list_channels(self) -> list[ChannelInfo]: ...   # exposes active rentals as channels
```

Channel directory entry:
- `target`: `agentbnb://session/<session_id>`
- `name`: `Rental from <renter_did_short> · <minutes_remaining>m left`
- `type`: `rental_session`

## 5. Curated Rental Runner (`subagent_runner.py`)

This is the core of ADR-024 Layer 1 architectural privacy enforcement.

For each incoming session:

1. Load `RENTAL.md` via `rental_md_loader.load_rental_md(path)` → returns
   `RentalProfile` dataclass (persona, allowed_tools, forbidden_topics)
2. Spawn an isolated Hermes subagent (use Hermes's existing subagent
   spawning API — see README mention of "Spawn isolated subagents for
   parallel workstreams"; resolve actual API path during impl)
3. Subagent system prompt = `RentalProfile.persona` (NOT host SOUL/SPIRIT)
4. Tool dispatch wrapper: any tool call NOT in `RentalProfile.allowed_tools`
   raises `ToolNotPermittedError` with a message referencing RENTAL.md
5. Memory hook (`memory_hook.attach_to_subagent`): subagent's
   conversation events are NOT forwarded to `plugins/memory` write paths.
   Conversation lives only in the subagent's in-memory message buffer for
   the duration of the session, then is discarded
6. Each user message from the renter is delivered to the subagent
7. Each subagent response is forwarded back via `adapter.send(...)`
8. On session end (`session_end` from Hub OR subagent timeout): terminate
   subagent, clear its message buffer, send final `session_settled` ack to
   Hub for escrow settlement

**Privacy invariants maintained**:
- Subagent never reads from main memory (no `plugins/memory` read access)
- Subagent never writes to main memory (no `plugins/memory` write access)
- Subagent has no access to host agent's tool credentials beyond the whitelist
- `RENTAL.md` is the only persona source — host SOUL/SPIRIT never injected

## 6. RENTAL.md Format (v0)

Owner-curated file at the path in `config.rental_md`. Parsed by
`rental_md_loader.parse_rental_md(text) -> RentalProfile`.

```markdown
# Agent Rental Profile

## Persona
You are a senior music director with 6 months of experience composing
ambient and lo-fi BGM for indie game and YouTube projects. Style: minimal,
warm, focused. Workflow: discuss style references first, produce 1-2
variations, iterate based on feedback. You communicate in Traditional
Chinese (zh-TW) but switch to English on request.

## Allowed Tools
- bgm.compose
- bgm.list_styles
- file.upload    # for delivering generated audio
- web.search     # for style references

## Forbidden Topics
- Do NOT discuss owner's other clients or projects
- Do NOT reference past conversation history outside this session
- Do NOT execute file system operations beyond /tmp/agentbnb-session/

## Pricing Hints
per_minute_credits: 5
per_session_max_credits: 300
```

Parser treats unknown sections as informational; only the four sections
above carry semantic weight in v0. v1 will define a JSON Schema and
extension points (ADR-024 v1).

## 7. Hub Client (`hub_client.py`)

Pure HTTP / WebSocket client. Does NOT import any TypeScript SDK code.
Uses `httpx` for HTTP and `websockets` (or stdlib via Hermes's existing
WebSocket utility) for the relay.

Endpoints called:
- `POST /api/cards` — publish capability card on `agentbnb publish`
- `POST /api/sessions/:id/end` — proactive termination
- `GET /api/me` — fetch DID + balance for `agentbnb status`
- WebSocket `/ws` — relay connection (incoming `session_open`, outgoing messages)

Auth: DID + Ed25519 challenge-signed handshake (mirror of
`hub/src/lib/authHeaders.ts` pattern, Python equivalent using
`PyNaCl` or `cryptography.hazmat.primitives.asymmetric.ed25519`).

## 8. Identity (`identity.py`)

On first run of `agentbnb publish`:
- Generate Ed25519 keypair if `~/.hermes/agentbnb/key.json` absent
- Derive `did:key:z<multibase>` (mirror logic from
  `agentbnb/src/identity/did.ts`)
- Save private key locally, NEVER transmit
- Print public DID for the user to record

`hermes agentbnb status` shows the DID + AgentBnB credit balance + active
rentals.

## 9. CLI Commands (`commands.py`)

```python
def cmd_publish(args):
    """Publish the current Hermes agent as a rentable AgentBnB capability.

    Steps:
      1. Ensure ~/.hermes/agentbnb/key.json exists (generate if absent)
      2. Verify RENTAL.md exists and parses cleanly
      3. Build CapabilityCardV2 payload from Hermes agent metadata + RENTAL.md
      4. POST /api/cards with signed auth headers
      5. Set config.enabled = true (so adapter starts on next gateway start)
      6. Print success + share the DID and a draft Hub profile URL
    """

def cmd_status(args):
    """Show sync status, active sessions, balance.

    Reads from local config + `GET /api/me` + `GET /api/sessions?owner_did=<>`.
    """

def cmd_settle(args):
    """Force settle a session escrow by id (recovery for stuck sessions)."""
```

## 10. Memory Hook (`memory_hook.py`)

Wraps Hermes's `plugins/memory` API to ensure rental subagent conversations
never persist. Uses Python context manager pattern:

```python
@contextmanager
def isolated_memory_context(subagent):
    """Disable memory writes for the duration of the context.

    Implementation detail: monkey-patches the subagent's memory adapter
    `write` method to a no-op. Restored on exit.
    """
    original_write = subagent.memory.write
    subagent.memory.write = lambda *a, **kw: None
    try:
        yield
    finally:
        subagent.memory.write = original_write
```

Resolve actual Hermes memory plugin API during implementation; the contract
is "no writes from rental subagent reach long-term storage."

## 11. plugin_api.py (FastAPI routes mounted at /api/plugins/agentbnb/*)

Optional UI integration with Hermes dashboard. v0 minimum:

- `GET /api/plugins/agentbnb/status` → returns `{did, enabled, active_sessions[], balance}`
- `GET /api/plugins/agentbnb/sessions` → list of active and recent rental sessions
- `POST /api/plugins/agentbnb/test_connection` → health check against Hub

These mirror `plugins/example-dashboard/dashboard/plugin_api.py` pattern.

## 12. Distribution Strategy

### Path A — Upstream PR

Contribute the plugin to `nousresearch/hermes-agent` via PR. Benefits:
- One-command install via `hermes plugin install agentbnb`
- Discoverability through Hermes's plugin registry
- Maintenance shared with Hermes maintainers

### Path B — Self-distribute (fallback / parallel)

Until PR merge:

```bash
# Users run:
git clone https://github.com/agentbnb/hermes-plugin-agentbnb \
  ~/.hermes/plugins/agentbnb
hermes plugin enable agentbnb
hermes agentbnb publish --rental-md ~/.hermes/RENTAL.md
```

Both paths target the same end state. We do not block launch on PR
acceptance.

## 13. Open Questions for Implementation

1. **Hermes subagent spawn API** — confirm exact entry point during impl
   (README mentions the feature; resolve module path)
2. **Hermes memory plugin API contract** — verify `subagent.memory.write`
   interception is the right hook; alternatives exist via context_engine
3. **Hermes channel directory expects sync `list_channels` or async?**
   Mirror IRC adapter's choice
4. **Auth challenge format** — settle on the exact handshake message shape
   between Hub relay and Python client; align with TypeScript relay client
   in `src/cli/session-action.ts:50-100`
5. **Tool dispatch interception** — need to confirm where in Hermes
   subagent runtime to insert the whitelist check
6. **Concurrent session limit** — config `max_concurrent_rental_sessions`
   default 3, configurable

## 14. Out of Scope (v1)

- File upload via Hermes plugin (Phase 2 Track B Week 4 routes through Hub UI)
- Group / multi-party sessions (ADR-D)
- Discord/Telegram channels routing into rentals (Hermes already has these
  as separate channel adapters; cross-channel composition is v2)
- On-host UI dashboard (Hermes dashboard sidebar entry — v1.1)

## 15. Verification

The plugin is "alpha-ready" when:

```bash
# In a fresh Hermes install
hermes plugin install agentbnb
hermes agentbnb publish --rental-md ./examples/RENTAL.md
hermes agentbnb status      # shows DID, enabled=true, balance, sessions=[]

# In another shell (renter side):
agentbnb session open <printed_card_id> \
  --skill agentbnb_session \
  --budget 30 \
  --message "hello"

# Expect:
# 1. Hermes plugin receives session_open
# 2. Subagent spawned with RENTAL.md persona
# 3. Subagent responds — response visible to renter
# 4. agentbnb session end <id>
# 5. Escrow settled, hermes agentbnb status shows balance increase
# 6. ~/.hermes/memory.db UNCHANGED (privacy invariant — verify with mtime)
```

The "alpha-ready" demo is the Phase 2 Track A Week 3 milestone.

---

## References

- `plugins/example-dashboard/dashboard/manifest.json` — manifest format
- `plugins/example-dashboard/dashboard/plugin_api.py` — API route mount pattern
- `plugins/platforms/irc/adapter.py` — channel adapter implementation reference
- `gateway/channel_directory.py` — channel directory build/refresh logic
- `gateway/platforms/base.py` — `BasePlatformAdapter` interface (read during impl)
- AgentBnB `src/cli/session-action.ts:50-100` — relay connection reference
- AgentBnB `src/relay/types.ts:195-214` — session message schemas
- AgentBnB `docs/adr/024-privacy-boundary.md` — privacy contract
- AgentBnB `src/registry/session-routes.ts` — REST surface this plugin calls
