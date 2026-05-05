# Contributing to the AgentBnB Hermes Plugin

> The plugin lives inside the AgentBnB monorepo at
> [`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb) under
> `hermes-plugin/`. It is mirrored to a dedicated repo,
> `Xiaoher-C/agentbnb-hermes-plugin`, for self-distribute installs while the
> upstream PR to `nousresearch/hermes-agent` is in flight. The monorepo is the
> source of truth — open PRs there.

This document covers contributing **to the plugin itself** (Python code,
tests, docs). For developing the rest of AgentBnB, see the repo-root
[`CLAUDE.md`](../CLAUDE.md) and [`docs/`](../docs/).

## Dev setup

The plugin uses [`uv`](https://docs.astral.sh/uv/) as the canonical local
toolchain. `uv` handles the venv, the lockfile, and test runs in one binary.
A plain `pip` workflow also works.

### With `uv` (recommended)

```bash
cd hermes-plugin
uv sync --extra dev      # creates .venv and installs runtime + dev deps
uv run pytest tests/ -v  # run the full suite
```

### With `pip` / `venv`

```bash
cd hermes-plugin
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ -v
```

Either workflow leaves you with `agentbnb_plugin` importable in editable
mode — edits to source are picked up without reinstall.

## Repository layout

```
hermes-plugin/
├── plugin.yaml               # Hermes plugin manifest (channel adapter + commands)
├── pyproject.toml            # Build config, deps, ruff/mypy/pytest config
├── README.md                 # Operator-facing overview
├── INSTALL.md                # Three install paths for self-distribute
├── CONTRIBUTING.md           # This file
├── examples/RENTAL.md        # Annotated persona template
├── agentbnb_plugin/          # Importable Python package
│   ├── __init__.py           # Re-exports public surface
│   ├── adapter.py            # BasePlatformAdapter — channel: agentbnb_session
│   ├── subagent_runner.py    # Curated Rental Runner — privacy core (ADR-024 Layer 1)
│   ├── rental_md_loader.py   # Parse RENTAL.md (persona + tool whitelist)
│   ├── memory_hook.py        # Suppress writes to owner memory during rental
│   ├── identity.py           # Ed25519 + did:key generation, signing
│   ├── hub_client.py         # HTTP/WS client to the AgentBnB Hub
│   ├── commands.py           # CLI: publish, status, settle
│   └── plugin_api.py         # FastAPI routes mounted at /api/plugins/agentbnb/*
└── tests/                    # pytest — one file per module above
```

Each module is small and single-purpose; please keep it that way. New
behavior usually means a new module, not a 600-line rewrite of an existing
one.

## Running tests

```bash
uv run pytest tests/ -v
# or, faster after the first run:
uv run pytest tests/ -q --tb=short
```

Targeted runs while iterating:

```bash
uv run pytest tests/test_subagent_runner.py -v
uv run pytest tests/test_subagent_runner.py::test_open_session_at_limit_raises -v
```

The full suite is fast (≈1s on a recent laptop). There is no need to skip
tests for "test discovery time" — if a change lands and the suite is
suddenly slow, that is itself a regression to file.

### The privacy contract test (do not break)

The plugin implements **Layer 1** of the three-layer privacy contract from
[`../docs/adr/024-privacy-boundary.md`](../docs/adr/024-privacy-boundary.md):

1. **Architectural isolation** — every rental session spawns a fresh
   subagent loaded with `RENTAL.md`, NOT the owner's main `SOUL.md` /
   `SPIRIT.md`. Enforced in
   [`agentbnb_plugin/subagent_runner.py`](agentbnb_plugin/subagent_runner.py).
2. **Runtime memory suppression** — for the duration of the session, the
   owner's memory adapter has its `write` / `store` / `index` / `remember`
   / `save` / `add` / `upsert` / `ingest` methods replaced with audited
   no-ops. Enforced in
   [`agentbnb_plugin/memory_hook.py`](agentbnb_plugin/memory_hook.py).
3. **Persistence skip** — `session_mode=true` skips `request_log` writes in
   the AgentBnB Hub. Enforced in TypeScript core; regression-guarded by
   `../src/session/privacy.test.ts`.

`tests/test_subagent_runner.py` and `tests/test_rental_md_loader.py`
exercise Layer 1. **Any change that makes those tests pass less than they
do today must be rejected.** A change that loosens the tool whitelist,
relaxes the concurrency cap default, or bypasses the memory hook is the
exact kind of regression the privacy contract exists to prevent.

If you genuinely need to change the contract, open an ADR amendment first
(see [`../docs/adr/`](../docs/adr/)) and link it from the PR. Code-only PRs
that touch privacy-sensitive paths without an ADR amendment will be
declined.

## Code style

The project rules are codified in `pyproject.toml`:

- **Line length**: 100 (formatter handles wrapping)
- **Target**: Python 3.11 (`from __future__ import annotations` is on, but
  PEP 604 unions and `datetime.UTC` are fair game)
- **Lint**: ruff (`E`, `F`, `I`, `N`, `UP`, `B`, `RUF`)
- **Types**: mypy strict (`strict = true`, `warn_return_any = true`)
- **Tests**: pytest, `asyncio_mode = "auto"`, `--strict-markers`

Run before opening a PR:

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy agentbnb_plugin
uv run pytest tests/ -q
```

Concrete style preferences (extending the project rules):

- **Many small files > few large files.** ≤400 lines per module is the
  comfortable target; ≤800 is the hard cap.
- **No `Any`.** Use `unknown`-equivalent shapes (e.g. `object`,
  `Mapping[str, object]`, narrow `TypedDict`s) and refine.
- **Errors are explicit.** Custom exception classes deriving from a small
  module-level base; never silently swallow.
- **No mutation of inputs.** Return new objects (`dataclasses.replace`,
  `dict.copy()`, frozen dataclasses where it makes sense).
- **Public functions get docstrings.** One-liner minimum; full Google-style
  for anything renter / owner traffic flows through.

## Submitting a fix

1. **Branch off `feat/v10-rental-mvp`** in the monorepo (this is the active
   v10 development branch). Branch name pattern:
   `fix/hermes-plugin-<short-thing>` for a bug,
   `feat/hermes-plugin-<short-thing>` for a feature.
2. **Write the failing test first** (TDD — RED). For privacy-sensitive
   changes, the test must directly assert the contract you're preserving.
3. **Implement minimally** to make the test pass (GREEN). Keep the diff
   tight.
4. **Run the full local check list**:

   ```bash
   cd hermes-plugin
   uv run ruff check .
   uv run ruff format --check .
   uv run mypy agentbnb_plugin
   uv run pytest tests/ -q
   ```

5. **Commit with a Conventional Commit message** scoped to `hermes-plugin`:

   ```
   feat(hermes-plugin): <one-line summary>
   fix(hermes-plugin): <one-line summary>
   docs(hermes-plugin): <one-line summary>
   ```

   Body should explain the *why*, not just the *what*. Reference the ADR
   if the change is privacy-relevant.

6. **Open the PR against `feat/v10-rental-mvp`**. The PR description should
   call out:
   - what the change is
   - which ADRs it relates to (especially ADR-024 for privacy-touching
     work)
   - how it was tested
   - whether it requires a doc update (`README.md` / `INSTALL.md`)

7. **CI runs the same checks you ran locally.** If CI fails on something
   that passed locally, that's a real signal — check Python version,
   environment markers, lockfile drift.

## Reporting bugs / security issues

- **Bugs**: open an issue in the AgentBnB monorepo with the title prefix
  `[hermes-plugin]`. Include the plugin version (`hermes plugins list`),
  Hermes version, Python version, and the failing command + traceback.
- **Privacy contract violations**: tag `[hermes-plugin][adr-024]`. These
  jump the queue.
- **Security issues**: do **not** open a public issue. Open a private
  security advisory through GitHub at
  [`Xiaoher-C/agentbnb`](https://github.com/Xiaoher-C/agentbnb/security/advisories/new)
  with the subject `AGENTBNB-SEC <short summary>`. We aim to acknowledge
  within 48h and publish a fix + advisory within 14 days for confirmed
  issues.

## License

MIT — by contributing you agree your contribution is licensed under the
same terms as the rest of AgentBnB. See [`../LICENSE`](../LICENSE).
