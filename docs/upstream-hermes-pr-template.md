# Upstream PR Template — `nousresearch/hermes-agent`

> Submission template for the upstream PR that adds the AgentBnB plugin to
> the official Hermes plugin index. Maintained in the AgentBnB monorepo so
> the proposing team and Hermes reviewers can both see history.
>
> **Use this template verbatim** when opening the PR. Fill the bracketed
> placeholders, drop the `<!-- TODO -->` markers once their content is
> ready, and keep section ordering — Hermes maintainers have asked for a
> consistent shape across plugin proposals.

---

## Title

```
[plugin] Add AgentBnB rental marketplace plugin
```

## Summary (paste into the PR body verbatim)

This PR adds **`plugins/agentbnb/`** — a Hermes-native channel adapter that
exposes a Hermes agent for short-term rental on the AgentBnB network.
AgentBnB is a peer-to-peer protocol where the unit of trade is a
time-boxed session of access to a long-tuned agent — "rent the AI employee
that someone else has spent six months tuning, for 60 minutes." This
plugin is the canonical supply-side integration: with two commands an
operator can list their Hermes agent and start receiving paid rental
sessions.

The plugin is intentionally a **pure adapter, no Hermes core changes**. It
implements `BasePlatformAdapter` exactly the way the existing platform
plugins (`plugins/platforms/discord/`, `plugins/platforms/irc/`) do —
registers a new channel (`agentbnb_session`), adds three CLI commands
(`agentbnb publish`, `agentbnb status`, `agentbnb settle`), and mounts a
small FastAPI router at `/api/plugins/agentbnb/*`. Memory integration goes
through the documented `plugins/memory` adapter API; subagent spawning
uses the same isolated-subagent pattern Hermes already advertises in its
README.

The most novel piece is **the privacy contract** (see §Privacy guarantees
below): the rental subagent runs in a memory-suppressed, tool-whitelisted
sandbox so the renter gets executed results without ever touching the
owner's prompt cache, conversation history, API keys, or main brain. This
is the boundary that makes "rent my agent" a sane proposition for the
operator. We treat the contract as code — three layers, each independently
tested.

## Why this is a good fit for Hermes

The Hermes README highlights the ability to "spawn isolated subagents for
parallel workstreams" as a core capability. AgentBnB's **Curated Rental
Runner** is the natural commercial extension of that primitive: the same
isolation pattern that lets a Hermes operator parallelise their own work
also lets them safely lend that work surface to someone else for an hour.

Specifically:

- **Hermes already has the right shape.** `BasePlatformAdapter`, the
  channel directory, `plugins/memory`, and the subagent spawn API give us
  every primitive we need. We add no new core abstractions and we change
  zero core files in this PR.
- **AgentBnB is operator-friendly.** Two commands (`hermes plugin install
  agentbnb && hermes agentbnb publish`) and an operator's existing tuned
  agent becomes a revenue-generating endpoint. Earnings flow back as
  AgentBnB credits viewable through `hermes agentbnb status`.
- **The privacy story is rigorous.** Renting an AI employee only works if
  the owner trusts the boundary. We've codified that trust in three layers
  of enforcement (architectural / runtime / persistence) and shipped
  regression tests for each layer. This is the kind of supply-side
  contract that's hard to retrofit later — much easier to land it
  correctly the first time, which is what this PR does.
- **Adoption path that respects Hermes maintainers.** Until this PR
  merges, the plugin self-distributes via fork / tarball / submodule (see
  `INSTALL.md`). Operators who try the self-distribute path migrate to
  `hermes plugin install agentbnb` the moment this lands — zero schema
  break, identical entry point, identical CLI surface.

## Privacy guarantees (the load-bearing section)

The operator-facing tagline is `「租用執行能力，不租用 agent 的腦與鑰匙」` —
"rent the execution capability, not the brain or the keys." We enforce
this in three independent layers, each with its own regression guard.
Full spec in
[ADR-024](https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr/024-privacy-boundary.md).

| Layer | Mechanism | Where enforced | Regression guard |
|---|---|---|---|
| **1. Architectural isolation** | Each rental session spawns a fresh subagent loaded with the operator-curated `RENTAL.md` persona, **not** the operator's main `SOUL.md` / `SPIRIT.md`. The subagent has its own conversation context that lives only for the session. | `agentbnb_plugin/subagent_runner.py` — `CuratedRentalRunner.open_session` | `tests/test_subagent_runner.py` |
| **2. Runtime memory suppression** | For the duration of the session, the operator's memory adapter has its `write` / `store` / `index` / `remember` / `save` / `add` / `upsert` / `ingest` methods replaced with audited no-ops. Suppressed calls are logged with the `ADR-024:` prefix so operators can audit attempted writes. | `agentbnb_plugin/memory_hook.py` — `isolated_memory` | `tests/test_subagent_runner.py` (memory hook integration) |
| **3. Persistence skip** | When `session_mode=true`, the AgentBnB Hub skips `request_log` writes so the rental conversation never enters the operator's long-term audit trail or training corpus. | TypeScript core (`src/registry/request-log.ts`) | `src/session/privacy.test.ts` (8-case regression suite) |

Additional runtime guarantees enforced by `CuratedRentalRunner`:

- **Tool whitelist.** Only tools listed in `RENTAL.md`'s `## Allowed Tools`
  section are callable. Calls outside the whitelist raise
  `ToolNotPermittedError` and are recorded in the session summary.
- **Concurrency cap.** The runner refuses to open a new session when
  `max_concurrent_rental_sessions` (default `3`, override via plugin
  config) is already reached, so a flood of inbound rentals cannot
  exhaust local resources.
- **Tools execute on the operator machine.** The renter only sees
  results — API keys, database credentials, project IDs, and other host
  secrets never leave the operator's process.

## Architectural fit

Concrete claims, each verifiable from the diff:

- **No Hermes core changes.** The PR adds files only under
  `plugins/agentbnb/`. No edits to `gateway/`, `plugins/memory/`,
  `plugins/platforms/`, or any other core directory.
- **Adapter pattern matches existing platform plugins.** Compare
  `plugins/agentbnb/adapter.py` against
  `plugins/platforms/irc/adapter.py` — same `BasePlatformAdapter`
  inheritance, same channel-registration shape, same lifecycle hooks.
- **Channel directory pattern respected.** Adapter registers
  `agentbnb_session` through the gateway's `channel_directory.py`
  exactly the way the IRC and Discord adapters register theirs.
- **Memory API used as documented.** The memory hook wraps an existing
  `plugins/memory` adapter and only overrides public write methods. We do
  not import private symbols, monkey-patch core, or rely on
  implementation-internal behavior.
- **No new system services.** Identity, Hub HTTP/WS, escrow — all run
  in-process under Hermes. No separate daemon, no sidecar.
- **Tested against pytest.** Plugin ships its own test suite
  (`plugins/agentbnb/tests/`, 90+ cases passing) using `pytest` +
  `pytest-asyncio` + `pytest-httpx`. No Hermes-side test infra changes.

## What this enables

For the full design rationale and surface area:

- **Spec**:
  [`docs/hermes-plugin-spec.md`](https://github.com/Xiaoher-C/agentbnb/blob/main/docs/hermes-plugin-spec.md) — implementation contract this plugin satisfies
- **Pivot rationale**:
  [`docs/adr/022-agent-maturity-rental.md`](https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr/022-agent-maturity-rental.md) — why "Agent Maturity Rental" beats "skill marketplace" as a unit of trade, including the **Maturity Evidence** model (we deliberately do **not** collapse maturity into a single score — operators expose categories like platform-observed sessions, completed tasks, repeat renters, verified tools, response reliability)
- **Session as primitive**:
  [`docs/adr/023-session-as-protocol-primitive.md`](https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr/023-session-as-protocol-primitive.md) — the time-boxed shared workspace this plugin services
- **Privacy boundary**:
  [`docs/adr/024-privacy-boundary.md`](https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr/024-privacy-boundary.md) — full three-layer enforcement model

## Test plan

**Automated (already passing):** 90+ pytest cases under
`plugins/agentbnb/tests/`. Run from the plugin root:

```bash
cd plugins/agentbnb
pip install -e ".[dev]"
pytest tests/ -v
```

The suite covers `RENTAL.md` parsing, identity bootstrapping, Hub client
HTTP / WS interactions (mocked via `pytest-httpx`), the
`CuratedRentalRunner` privacy contract (concurrency cap, tool whitelist,
memory suppression), and the channel adapter lifecycle.

**Manual integration test recipe — reviewers can paste this:**

```bash
# 1. Install the plugin in your Hermes dev tree
cd <hermes-checkout>
git clone https://github.com/Xiaoher-C/agentbnb-hermes-plugin plugins/agentbnb
pip install -e plugins/agentbnb

# 2. Confirm Hermes discovers it
hermes plugins list | grep agentbnb
# expected: agentbnb 0.1.0 platform_adapter AgentBnB Rental

# 3. Author a minimal RENTAL.md
mkdir -p ~/.hermes
cat > ~/.hermes/RENTAL.md <<'EOF'
# Rental Profile: Reviewer Test Agent

## Persona
You are a polite assistant evaluating the Hermes plugin install path.

## Allowed Tools
- web.search
- file.read
EOF

# 4. Bootstrap identity + publish
#    (defaults to the public Hub; for offline review point at a local mock)
hermes agentbnb publish

# 5. Inspect the result
hermes agentbnb status
```

Expected outcome:
- A `did:agentbnb:...` is printed and persisted at `~/.hermes/agentbnb/key.json`
- The Hub returns a Capability Card id (or, with `AGENTBNB_HUB_URL=http://localhost:8787`, the local mock returns the same shape)
- `hermes agentbnb status` shows the resolved DID, balance, and zero active sessions

A reference outcome page from a real dogfood session will be linked under
**Screenshots** below once the first paid rental settles.

## Maintenance commitment

The AgentBnB team maintains this plugin. Specifically:

- **Named contact**: Cheng Wen Chen (founder, AgentBnB) — primary
  reviewer for `[hermes-plugin]` issues and PRs.
- **Cadence**: bug-class issues triaged within 5 business days; security
  / privacy-class issues within 48h.
- **Release cadence**: minor versions follow AgentBnB's monthly release
  train; patch versions ship as needed. Each release is published as a
  GitHub release with a pinned tarball + sha256 (see
  `INSTALL.md` Path B).
- **Compatibility window**: we commit to supporting the current Hermes
  release and the previous release. If a Hermes API change forces an
  upgrade, we ship a tracking PR within two weeks of the breaking
  release.
- **Deprecation policy**: any breaking change to `RENTAL.md` or the CLI
  surface ships with a one-release deprecation window and a documented
  migration path.

If maintenance lapses, the dedicated mirror repo
(`Xiaoher-C/agentbnb-hermes-plugin`) and the in-monorepo source
(`Xiaoher-C/agentbnb` under `hermes-plugin/`) both remain under MIT, so
Hermes maintainers can take a hard fork at any time without legal friction.

## License

MIT — same as the rest of AgentBnB and (per the Hermes plugin index
policy) compatible with the Hermes core license. See
[`LICENSE`](https://github.com/Xiaoher-C/agentbnb/blob/main/LICENSE) at the AgentBnB monorepo root.

## Screenshots

<!-- TODO: add screenshots once dogfood outcome page is live -->
<!-- Planned content:
     1. Operator: `hermes agentbnb status` after first publish (terminal screenshot)
     2. Renter: AgentBnB Hub session room with the rental in progress
     3. Outcome page at /o/<share_token> generated from the Cheng Wen × Hannah dogfood
-->

## How to test (one-shot script)

```bash
# Reviewers: paste this in a fresh shell to install + sanity-check
set -euo pipefail

REVIEW_DIR=$(mktemp -d)
cd "$REVIEW_DIR"

# Pull the plugin
git clone https://github.com/Xiaoher-C/agentbnb-hermes-plugin agentbnb
cd agentbnb

# Install + run the full suite
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ -v

# Sanity-check the manifest
python -c "import yaml, pathlib; m = yaml.safe_load(pathlib.Path('plugin.yaml').read_text()); assert m['name'] == 'agentbnb'; assert m['type'] == 'platform_adapter'; print('plugin.yaml OK', m['version'])"

# Sanity-check the entry point resolves
python -c "from agentbnb_plugin.adapter import AgentBnbAdapter; print('entry point OK', AgentBnbAdapter)"
```

Expected exit code: `0`. Expected `pytest` summary: 90+ passing, 0
failing, 0 errors.

---

### Submission checklist (for the AgentBnB submitter, not the Hermes reviewer)

- [ ] Plugin tarball + sha256 published at the GitHub release referenced in
      `INSTALL.md` Path B
- [ ] `agentbnb-hermes-plugin` mirror repo synced to the monorepo HEAD
- [ ] Cheng Wen × Hannah dogfood session has produced at least one
      shareable outcome page; screenshot inserted
- [ ] `pytest tests/ -v` passes on a clean Python 3.11 + 3.12 venv
- [ ] `ruff check .` and `mypy agentbnb_plugin` are clean
- [ ] Hermes maintainer named in §Maintenance commitment is reachable at
      the listed email
- [ ] PR opened against `nousresearch/hermes-agent` with the **Title**
      above and the body assembled from the sections above in order
