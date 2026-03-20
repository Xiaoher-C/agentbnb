# Integration Audit Report
**Date**: 2026-03-21
**Issues audited**: 5, 6, 10

---

## Issue 5: skills.yaml → registry card publish — official bridge

**Status**: DOCUMENTED
**Files**:
- `src/skills/skill-config.ts`
- `src/runtime/agent-runtime.ts`
- `src/cli/index.ts` (`serve` command)
- `src/openclaw/soul-sync.ts`

**Finding**:

There are two separate publish paths that can diverge:

1. **SOUL.md path**: `agentbnb openclaw sync` → `publishFromSoulV2()` → writes a v2.0 CapabilityCard to the local registry DB. Also triggered during `agentbnb init` if SOUL.md is detected.

2. **skills.yaml path**: `agentbnb serve --skills-yaml <path>` → `AgentRuntime.initSkillExecutor()` → parses skills.yaml and initializes SkillExecutor. **No card is written to the registry.** The SkillExecutor is wired to the gateway and executes skills, but the provider's capabilities are not automatically listed in the registry.

This means a provider who configures `skills.yaml` with 5 API skills can receive and execute requests — but if they have not separately published a card via `agentbnb publish <card.json>` or `agentbnb openclaw sync`, no card appears in the registry. Agents searching the registry will not find them.

**Gap summary**:
- `skills.yaml` is the single source of truth for **execution** (what and how to execute)
- The registry card is the single source of truth for **discoverability** (who can do what)
- There is no bridge that converts skills.yaml → CapabilityCard on `serve` start

**Why not a simple fix**: Building `publishFromSkillsYaml()` requires mapping `SkillConfig` fields (execution-oriented: endpoint, method, input_mapping) to `CapabilityCard` fields (description-oriented: description, inputs[], outputs[], human-readable descriptions). Many required card fields have no equivalent in `SkillConfig`. This requires a new mapping layer and new optional metadata fields in the `SkillConfig` schema (at minimum: `description`, `inputs[]`, `outputs[]` with human-readable text).

**Action taken**: Documented. The provider currently must maintain both a `skills.yaml` (for execution) and a `card.json` / SOUL.md (for discoverability). Recommend adding a `publishFromSkillsYaml()` function as a future phase.

**Risk**: Medium. Providers who only configure `skills.yaml` are invisible to the network. UX gap but not a data-loss bug.

---

## Issue 6: CLI commands — actual vs documented

**Status**: FIXED (bug), DOCUMENTED (design gaps)
**Files changed**:
- `src/runtime/agent-runtime.ts` (line 172)
- `src/cli/conduct.ts` (line 152)

**Finding — actual CLI command inventory**:

Top-level commands that actually exist:
- `agentbnb init` — options: `--owner`, `--port`, `--host`, `--yes`, `--no-detect`, `--from`, `--json`
- `agentbnb publish <card.json>` — options: `--json`, `--registry`
- `agentbnb sync` — push local cards to remote registry
- `agentbnb discover [query]` — options: `--level`, `--online`, `--local`, `--registry`, `--tag`, `--json`
- `agentbnb request [card-id]` — options: `--params`, `--peer`, `--skill`, `--cost`, `--query`, `--max-cost`, `--no-receipt`, `--batch`, `--json`
- `agentbnb status` — options: `--json`
- `agentbnb serve` — options: `--port`, `--handler-url`, `--skills-yaml`, `--registry-port`, `--registry`, `--conductor`, `--announce`, `--no-relay`
- `agentbnb connect <name> <url> <token>` — add a peer
- `agentbnb peers` — list peers; subcommand: `peers remove <name>`
- `agentbnb config set <key> <value>` / `config get <key>`
- `agentbnb openclaw sync` / `openclaw status` / `openclaw rules`
- `agentbnb conduct <task>` — options: `--plan-only`, `--max-budget`, `--json`
- `agentbnb feedback submit` / `feedback list`
- `agentbnb mcp-server`

**Bug found and FIXED**: Error messages in `src/runtime/agent-runtime.ts` (line 172) and `src/cli/conduct.ts` (line 152) directed users to `agentbnb peers add <name> <url> <token>` — a subcommand that does not exist. The correct command is `agentbnb connect <name> <url> <token>`. Both error messages updated.

**Commands documented but do not exist** (design gaps, all in other agent's untracked files):
- `agentbnb init --non-interactive --name` — `--non-interactive` does not exist; closest is `--yes`. Referenced in `packages/genesis-template/scripts/init.ts` and `DOC1-AGENTBNB-GENESIS-DEV-PLAN.md`.
- `agentbnb init --agent-id --card` — these flags do not exist. Referenced in `genesis-template/HANDOFF.md`.
- `agentbnb request --provider` — does not exist; use `--peer`. Referenced in `genesis-template/HANDOFF.md` and `DOC2-OPENCLAW-BOT-IMPLEMENTATION.md`.
- `agentbnb publish --skill --price` — does not exist; `publish` only accepts a positional `<card.json>`.
- `agentbnb escrow hold/settle/release` — no `escrow` top-level command; escrow is automatic inside `request`.
- `agentbnb peers add` — does not exist; use `agentbnb connect`.

**Commands that exist but are underdocumented**:
- `agentbnb sync` — pushes all local cards to remote registry
- `agentbnb feedback submit/list` — functional, missing from main docs
- `agentbnb mcp-server` — functional, not in user-facing docs
- `agentbnb request --batch` — functional batch request mode, underdocumented

**Risk**: Medium for the `peers add` bug (broken error guidance on a common failure path). Low for missing commands (all in external/untracked files).

---

## Issue 10: Public-facing packages — private assumption audit

**Status**: NO_ISSUE
**Files checked**:
- `skills/agentbnb/bootstrap.ts`
- `skills/agentbnb/gateway.ts`
- `src/cli/remote-registry.ts`
- `src/runtime/agent-runtime.ts`
- `src/relay/websocket-client.ts`
- `tsup.config.ts`

**Finding**:

All hardcoded `hub.agentbnb.dev` / `registry.agentbnb.dev` references in executable source code are either JSDoc/help-text examples or test fixtures:

1. **JSDoc comment / option description examples** (not functional):
   - `src/relay/websocket-client.ts` line 18: JSDoc example only
   - `src/cli/index.ts` line 1359: CLI help text example only
   - `adapters/openai/generate.ts` line 9: comment in usage example

2. **Test files only** (not shipped):
   - `src/credit/create-ledger.test.ts`, `src/credit/registry-credit-ledger.test.ts`, `src/registry/openapi-gpt-actions.test.ts`, `src/registry/server.test.ts`

3. **genesis-template/scripts/init.ts** (untracked, other agent's work, not touched):
   - Has `const HUB_URL = "https://hub.agentbnb.dev"` as a hardcoded constant — this is the only runtime-level hardcoded URL, but it is in the genesis-template directory which is excluded per instructions.

**All runtime registry URLs are properly externalized** via `agentbnb config set registry <url>` / `--registry <url>` CLI flag / `config.registry` from config.json.

**Key public packages are clean**:
- `skills/agentbnb/bootstrap.ts` — all paths are user-provided or default to `~/.agentbnb/` (local, correct)
- `src/cli/remote-registry.ts` — `registryUrl` always passed as parameter, never hardcoded
- `src/runtime/agent-runtime.ts` — all DB paths via `RuntimeOptions`, no remote URLs
- `tsup.config.ts` — build config only, no runtime URLs

**Action taken**: No code changes needed.

**Risk**: Low.
