# AgentBnB Hermes Plugin

> The canonical supply integration for **AgentBnB Agent Maturity Rental** (v10).
> Two commands turn your Hermes agent into a rentable resource on the AgentBnB
> network.

```bash
hermes plugin install agentbnb
hermes agentbnb publish --rental-md ~/.hermes/RENTAL.md
```

That's it. After this:
- Your Hermes agent is published as a rentable AgentBnB capability
- Inbound rental session requests appear as a new `agentbnb_session` channel
- Each rental spawns an **isolated subagent** loaded with your `RENTAL.md`
  persona — no access to your main brain, conversation history, or non-allowlisted tools
- Earnings flow back as AgentBnB credits (view via `hermes agentbnb status`)

## Why this exists

AgentBnB has pivoted from "skill marketplace" to **Agent Maturity Rental** —
the idea that your 6-month-tuned Hermes agent (with its prompt cache, tool
configurations, accumulated style) is more valuable than the sum of its
skills. People who don't have time to tune their own can rent yours for an
hour. See:

- [`docs/adr/022-agent-maturity-rental.md`](../docs/adr/022-agent-maturity-rental.md)
- [`docs/adr/023-session-as-protocol-primitive.md`](../docs/adr/023-session-as-protocol-primitive.md)
- [`docs/adr/024-privacy-boundary.md`](../docs/adr/024-privacy-boundary.md)
- [`docs/hermes-plugin-spec.md`](../docs/hermes-plugin-spec.md)

## Privacy contract (read this before publishing)

> **租用執行能力，不租用 agent 的腦與鑰匙.**

When this plugin runs a rental session for you:

1. **Your tools execute on YOUR machine**. The renter only sees results — no
   API keys, no database credentials, no Cloud project IDs ever leave.
2. **Session memory is per-sessionId isolated**. The rental conversation
   never writes to your agent's main memory store. When the session ends, the
   subagent dies and its message buffer is discarded.
3. **The renter's persona is NOT your real persona**. The subagent runs with
   the persona declared in `RENTAL.md`, NOT your main `SOUL.md` / `SPIRIT.md`.
   You decide what gets exposed.
4. **Tool whitelist is enforced**. Only tools listed in `RENTAL.md`'s
   `## Allowed Tools` section are callable inside a rental subagent.

If any of the above is broken, that is a bug — please file an issue
referencing ADR-024.

## RENTAL.md (the file you write)

This is the only file you have to author. It declares what the rented version
of your agent looks like. Minimal example:

```markdown
# Agent Rental Profile

## Persona
You are a senior music director with 6 months of experience composing
ambient and lo-fi BGM. Style: minimal, warm, focused. Workflow: discuss
style references first, produce 1–2 variations, iterate based on feedback.
You communicate in zh-TW but switch to English on request.

## Allowed Tools
- bgm.compose
- bgm.list_styles
- file.upload
- web.search

## Forbidden Topics
- Do NOT discuss other clients
- Do NOT reference past conversation history outside this session
- Do NOT execute file operations beyond /tmp/agentbnb-session/

## Pricing Hints
per_minute_credits: 5
per_session_max_credits: 300
```

A working template is in [`examples/RENTAL.md`](examples/RENTAL.md).

## Install

### Path A — through Hermes plugin manager (preferred once upstream lands)

```bash
hermes plugin install agentbnb
```

### Path B — self-distribute (now)

```bash
# Clone alongside your Hermes install
git clone https://github.com/Xiaoher-C/agentbnb.git ~/work/agentbnb
ln -s ~/work/agentbnb/hermes-plugin ~/.hermes/plugins/agentbnb

# Install Python deps in the Hermes venv
hermes shell -- pip install -e ~/.hermes/plugins/agentbnb

# Enable + publish
hermes plugin enable agentbnb
hermes agentbnb publish --rental-md ~/.hermes/RENTAL.md
```

## Commands

| Command | What it does |
|---|---|
| `hermes agentbnb publish [--rental-md PATH]` | Generate AgentBnB identity if absent, validate RENTAL.md, push CapabilityCard to AgentBnB Hub, enable adapter |
| `hermes agentbnb status` | Print DID, current balance, active rental sessions, sync state |
| `hermes agentbnb settle <session_id>` | Force escrow settlement for a stuck session (recovery) |

## Configuration

Settings live in your Hermes config. Defaults are in `plugin.yaml`. Override
via env vars or YAML:

| Key | Env var | Default | Purpose |
|---|---|---|---|
| `hub_url` | `AGENTBNB_HUB_URL` | `https://hub.agentbnb.dev` | AgentBnB Hub base URL |
| `rental_md` | `AGENTBNB_RENTAL_MD` | `~/.hermes/RENTAL.md` | RENTAL.md path |
| `enabled` | — | `false` | Set to `true` after first publish |
| `max_concurrent_rental_sessions` | — | `3` | Concurrency cap |
| `identity_dir` | — | `~/.hermes/agentbnb` | DID + key storage |

## Status

**Alpha (v0.1.0)** — actively developed in `feat/v10-rental-mvp` branch of
[`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb). First real
dogfood is Cheng Wen × Hannah BGM session in Phase 2 Track A.

| Component | Status |
|---|---|
| `rental_md_loader.py` | ✅ Implemented + tested |
| `identity.py` (Ed25519 + did:key) | ✅ Implemented + tested |
| `hub_client.py` (HTTP) | ✅ Implemented + tested |
| `subagent_runner.py` (skeleton) | 🚧 Privacy hooks in place, Hermes runtime wiring pending |
| `memory_hook.py` | 🚧 Skeleton, concrete API resolution pending |
| `commands.py` (CLI) | 🚧 publish + status, settle pending |
| `plugin_api.py` (FastAPI) | 🚧 status route, full UI integration pending |
| `adapter.py` (channel) | 🚧 Skeleton, BasePlatformAdapter wiring pending |
| Tests | ✅ rental_md / identity / hub_client; 🚧 adapter / runner |

## Contributing

This plugin lives inside the AgentBnB monorepo at
[`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb) under
`hermes-plugin/`. Once the API surface stabilises after the first dogfood
sessions, an upstream PR to `nousresearch/hermes-agent` will be opened.

For now, file issues against the agentbnb repo and prefix the title
with `[hermes-plugin]`.

## License

MIT — same as the rest of AgentBnB. See [`../LICENSE`](../LICENSE).
