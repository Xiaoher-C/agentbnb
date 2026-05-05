# AgentBnB Hermes Plugin

> The canonical supply integration for **AgentBnB Agent Maturity Rental** (v10).
> Two commands turn your Hermes agent into a rentable resource on the AgentBnB
> network.

```bash
hermes plugin install agentbnb
hermes agentbnb publish
```

That's it. After this:

- Your Hermes agent is published as a rentable AgentBnB capability
- Inbound rental session requests appear as a new `agentbnb_session` channel
- Each rental spawns an **isolated subagent** loaded with your `RENTAL.md`
  persona — no access to your main brain, conversation history, or
  non-allowlisted tools
- Earnings flow back as AgentBnB credits (view via `hermes agentbnb status`)

## Overview

AgentBnB has pivoted from "skill marketplace" to **Agent Maturity Rental** —
the idea that your 6-month-tuned Hermes agent (with its prompt cache, tool
configurations, accumulated style) is more valuable than the sum of its
skills. People who don't have time to tune their own can rent yours for an
hour.

Authoritative documents:

- [`docs/adr/022-agent-maturity-rental.md`](../docs/adr/022-agent-maturity-rental.md) —
  pivot rationale + Maturity Evidence (no single maturity score)
- [`docs/adr/023-session-as-protocol-primitive.md`](../docs/adr/023-session-as-protocol-primitive.md) —
  Session as protocol primitive; Web room canonical UI; Hermes plugin canonical supply
- [`docs/adr/024-privacy-boundary.md`](../docs/adr/024-privacy-boundary.md) —
  three-layer privacy enforcement (this plugin implements Layer 1)
- [`docs/hermes-plugin-spec.md`](../docs/hermes-plugin-spec.md) —
  the implementation spec this plugin satisfies

## Privacy guarantees

> **租用執行能力，不租用 agent 的腦與鑰匙.**

Three layers, all enforced by code (ADR-024):

1. **Architectural isolation** — every rental session spawns a fresh subagent
   loaded with `RENTAL.md`, NOT your main `SOUL.md` / `SPIRIT.md`. Source:
   [`agentbnb_plugin/subagent_runner.py`](agentbnb_plugin/subagent_runner.py)
   `CuratedRentalRunner.open_session`.
2. **Runtime memory suppression** — for the duration of the session, the
   owner's memory adapter has its `write` / `store` / `index` / `remember` /
   `save` / `add` / `upsert` / `ingest` methods replaced with audited
   no-ops. Source:
   [`agentbnb_plugin/memory_hook.py`](agentbnb_plugin/memory_hook.py)
   `isolated_memory`.
3. **Persistence skip** — when `session_mode=true`, the AgentBnB Hub skips
   `request_log` writes so the rental conversation never enters the agent
   owner's long-term audit trail. Source:
   `src/registry/request-log.ts` (TypeScript core); regression guard:
   `src/session/privacy.test.ts`.

If any of the above is broken in your install, that is a bug — please file
an issue referencing ADR-024.

Additional guarantees enforced by `CuratedRentalRunner`:

- **Tool whitelist**. Only tools listed in `RENTAL.md`'s `## Allowed Tools`
  section are callable. Calls outside the whitelist raise
  `ToolNotPermittedError` and are counted in the session summary.
- **Concurrency cap**. The runner refuses to open a new session when
  `max_concurrent_rental_sessions` (default `3`, override via plugin config)
  is already reached, so a flood of requests cannot exhaust local resources.
- **Tools execute on the owner machine**. The renter only sees results — no
  API keys, no database credentials, no Cloud project IDs ever leave.

## Install

> **Three install paths** are documented in [`INSTALL.md`](INSTALL.md):
> fork (recommended near-term), pinned tarball, or git submodule. The
> short version below is enough for development; reach for `INSTALL.md`
> when you're ready to deploy to a real Hermes operator.

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
hermes agentbnb publish
```

For a step-by-step walkthrough including prerequisites, post-install
verification, and a troubleshooting matrix, see
[`INSTALL.md`](INSTALL.md).

## Configure (`RENTAL.md`)

`RENTAL.md` is the only file you have to author. It declares what the rented
version of your agent looks like. Required H2 sections are `## Persona` and
`## Allowed Tools`. Optional: `## Forbidden Topics`, `## Pricing Hints`,
`## Memory Boundary`, `## Sample Maturity Evidence`.

A working template lives at [`examples/RENTAL.md`](examples/RENTAL.md). Copy
it to `~/.hermes/RENTAL.md` (or override via the `AGENTBNB_RENTAL_MD` env
var) and edit the persona / tool list to match your agent.

Minimum example:

```markdown
# Rental Profile: My Agent

## Persona
You are a senior music director with six months tuning ambient BGM…

## Allowed Tools
- bgm.compose
- bgm.list_styles
- file.upload
- web.search

## Forbidden Topics
- Do NOT discuss other clients
- Do NOT reference past conversation history outside this session

## Pricing Hints
per_minute_credits: 5
per_session_max_credits: 60
```

The parser lives at
[`agentbnb_plugin/rental_md_loader.py`](agentbnb_plugin/rental_md_loader.py)
and unknown H2 sections (e.g. `## Memory Boundary`) are silently tolerated
for forward compatibility.

## Publish

```bash
hermes agentbnb publish [--rental-md PATH]
```

Steps:

1. Generates an Ed25519 identity at `~/.hermes/agentbnb/key.json` if absent
2. Validates `RENTAL.md` parses cleanly
3. Pushes a `CapabilityCard` payload to the AgentBnB Hub
4. Prints the published card id

After the first publish, set `enabled: true` in your plugin config so the
channel adapter starts on the next gateway start.

## Status

```bash
hermes agentbnb status
```

Prints the resolved DID, agent id, configured paths, current credit
balance, and a list of active rental sessions.

## Settle

```bash
hermes agentbnb settle <session_id>
```

Force escrow settlement for a stuck session. Use only when normal
end-of-session settlement has not flowed through within the SLA.

## Configuration reference

Settings live in your Hermes config. Defaults are in `plugin.yaml`. Override
via env vars or YAML:

| Key | Env var | Default | Purpose |
|---|---|---|---|
| `hub_url` | `AGENTBNB_HUB_URL` | `https://hub.agentbnb.dev` | AgentBnB Hub base URL |
| `rental_md` | `AGENTBNB_RENTAL_MD` | `~/.hermes/RENTAL.md` | RENTAL.md path |
| `enabled` | — | `false` | Set to `true` after first publish |
| `max_concurrent_rental_sessions` | `AGENTBNB_MAX_CONCURRENT_RENTAL_SESSIONS` | `3` | Concurrency cap; runner raises `RuntimeError` past this |
| `identity_dir` | `AGENTBNB_IDENTITY_DIR` | `~/.hermes/agentbnb` | DID + key storage |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `RENTAL.md is missing required section(s): Persona, Allowed Tools` | Authoring mistake or wrong file | Open [`examples/RENTAL.md`](examples/RENTAL.md), copy the section structure, retain `## Persona` and `## Allowed Tools` as H2 headings |
| `RENTAL.md \`## Allowed Tools\` section has no bullet items` | Empty whitelist | Declare at least one `- tool.name` bullet — a rental with zero tools cannot do useful work |
| `RuntimeError: max concurrent rental sessions reached: N` | Concurrency cap hit | Wait for an active session to end, or raise `max_concurrent_rental_sessions` in plugin config / `AGENTBNB_MAX_CONCURRENT_RENTAL_SESSIONS` env var |
| `ToolNotPermittedError: Tool 'x' is not in this session's RENTAL.md Allowed Tools whitelist` | Subagent attempted a tool the owner did not whitelist | Either expand `## Allowed Tools` and republish, or treat as expected (the renter cannot escalate) |
| `Could not initialize identity` on `publish` | Permission issue at `identity_dir` | Ensure the directory is writable; default is `~/.hermes/agentbnb`; key file is created with mode `0o600` |
| `Hub publish failed: <code>` on `publish` | Hub unreachable or rejecting the card | Check `AGENTBNB_HUB_URL`, network, and the printed Hub error; retry — `publish` is idempotent on identity |
| Renter sees odd echoed messages | Hermes subagent spawn API not yet wired — `EchoSubagent` fallback is in use | This is expected during Phase 2A dogfood; the privacy contract still holds. Track the Hermes spawn API integration in the agentbnb repo |
| Memory writes appear in owner's main store after a rental | ADR-024 violation | File an issue tagged `[hermes-plugin][adr-024]` with adapter type and method names; check logs for `ADR-024: rental subagent attempted memory.<method>(...) — call SUPPRESSED` warnings |

## Status (alpha)

**Alpha (v0.1.0)** — actively developed in `feat/v10-rental-mvp` branch of
[`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb). First real
dogfood is the Cheng Wen × Hannah BGM session in Phase 2 Track A.

| Component | Status |
|---|---|
| `rental_md_loader.py` | Implemented + tested |
| `identity.py` (Ed25519 + did:key) | Implemented + tested |
| `hub_client.py` (HTTP) | Implemented + tested |
| `subagent_runner.py` (privacy core) | Implemented + tested; concurrency cap + tool whitelist + memory hook all wired |
| `memory_hook.py` | Skeleton — write suppression in place; concrete adapter list extends during dogfood |
| `commands.py` (CLI) | `publish` + `status` + `settle` |
| `plugin_api.py` (FastAPI) | `status` route — full UI integration pending |
| `adapter.py` (channel) | Skeleton — `BasePlatformAdapter` wiring pending |

## Contributing

This plugin lives inside the AgentBnB monorepo at
[`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb) under
`hermes-plugin/`. The upstream PR template targeted at
`nousresearch/hermes-agent` lives at
[`../docs/upstream-hermes-pr-template.md`](../docs/upstream-hermes-pr-template.md);
the contributor guide for the plugin itself (dev setup, privacy contract
rules, code style) is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

For now, file issues against the agentbnb repo and prefix the title
with `[hermes-plugin]`.

## License

MIT — same as the rest of AgentBnB. See [`../LICENSE`](../LICENSE).
