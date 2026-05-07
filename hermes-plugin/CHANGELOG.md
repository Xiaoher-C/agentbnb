# Changelog

All notable changes to the AgentBnB Hermes plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Tag scheme for releases: `hermes-plugin-vX.Y.Z` (namespaced so the plugin can
release independently of the AgentBnB monorepo's main version tags).

## [0.1.0] — 2026-05-04

First public alpha. The canonical supply integration for **AgentBnB Agent
Maturity Rental** (v10). Two-command onboarding turns a Hermes agent into a
rentable resource on the AgentBnB network.

### Added

- **Plugin manifest** (`plugin.yaml`) — declares the `agentbnb_session`
  channel adapter, the three CLI commands (`agentbnb publish`, `agentbnb
  status`, `agentbnb settle`), and the configurable settings (`hub_url`,
  `rental_md`, `enabled`, `max_concurrent_rental_sessions`, `identity_dir`).
- **`RENTAL.md` loader** (`agentbnb_plugin/rental_md_loader.py`) — parses the
  owner-curated persona file. Required H2 sections: `## Persona` and
  `## Allowed Tools`. Unknown H2 sections (e.g. `## Memory Boundary`) are
  tolerated for forward compatibility. Bundled annotated template at
  [`examples/RENTAL.md`](examples/RENTAL.md) plus three role-shaped
  starters (coding, design, research).
- **Identity layer** (`agentbnb_plugin/identity.py`) — Ed25519 keypair,
  `did:key` and `did:agentbnb` derivation, on-disk key persisted with mode
  `0o600`. Bootstraps automatically on first `agentbnb publish`.
- **Hub client** (`agentbnb_plugin/hub_client.py`) — async HTTP +
  WebSocket client for the AgentBnB Hub. All rental session calls set
  `session_mode=true` so the Hub honours the ADR-024 persistence skip.
- **Curated Rental Runner** (`agentbnb_plugin/subagent_runner.py`) — the
  privacy core. Spawns an isolated subagent per rental session loaded only
  with the owner-curated `RENTAL.md` (NOT main `SOUL.md` / `SPIRIT.md`),
  enforces the `## Allowed Tools` whitelist, caps concurrency at
  `max_concurrent_rental_sessions` (default 3), and runs every message
  through `isolated_memory(...)`. `EchoSubagent` fallback is used until the
  Hermes subagent spawn API lands.
- **Memory hook** (`agentbnb_plugin/memory_hook.py`) — `isolated_memory`
  context manager that monkey-patches the owner agent's memory adapter for
  the duration of a session. Replaces `write` / `store` / `index` /
  `remember` / `save` / `add` / `upsert` / `ingest` with audited no-ops
  that log `ADR-024: rental subagent attempted memory.<method>(...) — call
  SUPPRESSED`. Methods are restored on exit (including on exception).
- **CLI commands** (`agentbnb_plugin/commands.py`) — `publish` (idempotent
  on identity, validates `RENTAL.md`, POSTs the Capability Card), `status`
  (DID, agent id, balance, active sessions), `settle` (force escrow
  settlement for stuck sessions).
- **Plugin API surface** (`agentbnb_plugin/plugin_api.py`) — FastAPI
  routes intended to mount under `/api/plugins/agentbnb/*`. Initial
  `status` route exposes runtime state for Hub UI integration.
- **Channel adapter skeleton** (`agentbnb_plugin/adapter.py`) — declares
  the `agentbnb_session` channel; full `BasePlatformAdapter` wiring is the
  next dogfood deliverable.

### Privacy contract (ADR-024 — three layers, all code-enforced)

> **租用執行能力，不租用 agent 的腦與鑰匙.**

This release ships **Layer 1** (architectural isolation) and **Layer 2**
(runtime memory suppression) of the contract:

1. **Architectural isolation** — `CuratedRentalRunner.open_session` spawns a
   fresh subagent loaded with `RENTAL.md`. The owner's main brain
   (`SOUL.md`, `SPIRIT.md`, prompt cache, conversation history) is never
   passed to the renter context.
2. **Runtime memory suppression** — `isolated_memory(...)` swaps every
   known memory-write method for an audited no-op for the duration of a
   session, then restores the originals. Verified by 5 unit tests
   (`tests/test_subagent_runner.py::test_isolated_memory_*`).
3. **Persistence skip** — every Hub call from this plugin sets
   `session_mode=true`, which the AgentBnB core honours by skipping
   `request_log` writes. The TypeScript regression guard for Layer 3 lives
   at `src/session/privacy.test.ts` in the AgentBnB monorepo.

Additional runtime guarantees enforced by `CuratedRentalRunner`:

- **Tool whitelist** — calls outside `## Allowed Tools` raise
  `ToolNotPermittedError` and are counted in the session summary.
- **Concurrency cap** — `RuntimeError: max concurrent rental sessions
  reached` past `max_concurrent_rental_sessions` so a flood of inbound
  rentals cannot exhaust local resources.
- **Tools execute on the owner machine** — the renter only sees results;
  no API keys, database credentials, or cloud project IDs ever leave.

### Maturity Evidence framing

Per [ADR-022](../docs/adr/022-agent-maturity-rental.md), this plugin
**never collapses agent maturity into a single score**. Status payloads
expose evidence categories (platform-observed sessions, completed tasks,
repeat renters, artifact examples, verified tools, response reliability,
renter rating) so consumers can render their own trust UI. The Hub side is
expected to do the same.

### Tests

- 90 tests, all green (`uv run pytest tests/ -v`)
  - `test_rental_md_loader.py` — loader, validation, examples
  - `test_identity.py` — Ed25519 keypair, DID derivation, key persistence
  - `test_hub_client.py` — HTTP + WebSocket plus `session_mode=true`
    propagation
  - `test_subagent_runner.py` — isolation, whitelist, concurrency cap,
    memory hook restore
  - `test_adapter.py` — channel registration shape

### Documentation

- [`README.md`](README.md) — operator overview, two-command quickstart,
  configuration reference, troubleshooting matrix
- [`INSTALL.md`](INSTALL.md) — three install paths (fork, tarball,
  submodule) with prerequisites, verification, troubleshooting,
  uninstall
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup with `uv` and `pip`,
  privacy-contract review rules, repository layout
- [`examples/RENTAL.md`](examples/RENTAL.md) — annotated persona template
- [`examples/coding-agent.RENTAL.md`](examples/coding-agent.RENTAL.md),
  [`examples/design-agent.RENTAL.md`](examples/design-agent.RENTAL.md),
  [`examples/research-agent.RENTAL.md`](examples/research-agent.RENTAL.md)
  — three role-shaped starters
- [`RELEASE.md`](RELEASE.md) — how to cut a new release

### Known gaps (see README "Status (alpha)")

- `adapter.py` is a skeleton — full `BasePlatformAdapter` wiring is the
  next dogfood deliverable
- `EchoSubagent` is the active subagent backend until the Hermes spawn
  API integration lands; the privacy contract still holds end-to-end
- `memory_hook.py` covers the eight known write methods; concrete
  adapter coverage extends during Hannah dogfood
- `plugin_api.py` exposes `status` only; full Hub UI integration pending

### Cross-references

- [ADR-022 — Agent Maturity Rental pivot](../docs/adr/022-agent-maturity-rental.md)
- [ADR-023 — Session as protocol primitive](../docs/adr/023-session-as-protocol-primitive.md)
- [ADR-024 — Privacy boundary (three-layer enforcement)](../docs/adr/024-privacy-boundary.md)
- [`docs/hermes-plugin-spec.md`](../docs/hermes-plugin-spec.md) — the spec this release satisfies

[0.1.0]: https://github.com/Xiaoher-C/agentbnb/releases/tag/hermes-plugin-v0.1.0
