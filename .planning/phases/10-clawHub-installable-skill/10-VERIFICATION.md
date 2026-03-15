---
phase: 10-clawHub-installable-skill
verified: 2026-03-16T03:55:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 10: ClaWHub Installable Skill Verification Report

**Phase Goal:** One command puts any OpenClaw agent on the AgentBnB network — activate() initializes the runtime, publishes the card, starts the gateway and IdleMonitor, and install.sh handles all setup automatically.
**Verified:** 2026-03-16T03:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Calling activate() initializes AgentRuntime, publishes a card from SOUL.md, starts the gateway server, and starts the IdleMonitor | VERIFIED | bootstrap.ts lines 80-97: new AgentRuntime → runtime.start() → publishFromSoulV2 → createGatewayServer + gateway.listen() → new IdleMonitor → idleMonitor.start() → runtime.registerJob(); integration test 1+4 confirm |
| 2  | Calling deactivate() stops the IdleMonitor cron, closes the gateway server, and shuts down the AgentRuntime | VERIFIED | bootstrap.ts lines 106-113: gateway.close() → runtime.shutdown() (which stops all registered cron jobs and closes DBs); integration tests 5+6 confirm isDraining=true and DB handles throw |
| 3  | activate() is a single function call with zero additional setup beyond passing config | VERIFIED | BootstrapConfig has only two required fields (owner, soulMdPath); all others have safe defaults; zero external wiring needed |
| 4  | deactivate() is idempotent and safe to call multiple times | VERIFIED | bootstrap.ts lines 107-112: try/catch swallows all errors on re-call; integration test 7 calls deactivate() twice with no throw |
| 5  | Running install.sh installs agentbnb CLI, initializes config, and syncs capabilities from SOUL.md | VERIFIED | install.sh has 5 explicit steps: check prereqs (Node>=20 + pnpm), install CLI (pnpm→npm fallback), agentbnb init --yes, agentbnb openclaw sync if SOUL.md found, print summary; bash -n passes; file is executable |
| 6  | install.sh works without any human intervention | VERIFIED | Script uses set -euo pipefail, handles all fallbacks internally, all prompts are automated (--yes flag on init); no interactive input required |
| 7  | HEARTBEAT.rules.md contains a standalone autonomy rules block that any agent can copy-paste into its HEARTBEAT.md | VERIFIED | File contains complete rules block with all four subsections: Sharing Rules, Requesting Rules (3 tiers), Credit Management, Autonomy Configuration; header explains copy-paste usage |
| 8  | HEARTBEAT.rules.md uses the same marker format as heartbeat-writer.ts so injectHeartbeatSection() can merge it | VERIFIED | heartbeat-writer.ts exports HEARTBEAT_MARKER_START = '<!-- agentbnb:start -->'; HEARTBEAT.rules.md contains exactly these markers (grep confirms 1 each); markers match byte-for-byte |
| 9  | SKILL.md contains agent-executable instructions with frontmatter metadata, on-install steps, autonomy rules, and CLI reference | VERIFIED | SKILL.md has YAML frontmatter (name, version, description, author, requires, entry_point, install_script); 7 sections (Quick Start, On Install, Programmatic API, Autonomy Rules, CLI Reference, Adapters) all in imperative language |
| 10 | The integration test confirms: mock SOUL.md, activate(), card published, gateway listening, IdleMonitor running, deactivate(), all resources cleaned up | VERIFIED | bootstrap.test.ts has 8 tests using real implementations with :memory: DBs; all 8 pass (vitest run confirms 8/8 in 343ms); tests 2+3+4+5+6+7+8 cover all lifecycle scenarios |

**Score:** 10/10 truths verified

---

## Required Artifacts

| Artifact | Provides | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `skills/agentbnb/bootstrap.ts` | activate() and deactivate() entry points | Yes | Yes — 113 lines, real implementation, all 4 imports, no stubs | Yes — imported by bootstrap.test.ts | VERIFIED |
| `skills/agentbnb/install.sh` | Post-install automation script | Yes | Yes — 190 lines, 5 steps, set -euo pipefail, idempotent guards | Yes — SKILL.md references it 3 times | VERIFIED |
| `skills/agentbnb/HEARTBEAT.rules.md` | Standalone autonomy rules block | Yes | Yes — agentbnb:start and agentbnb:end markers present; four rule subsections | Yes — SKILL.md Autonomy Rules section references it; compatible with heartbeat-writer.ts | VERIFIED |
| `skills/agentbnb/SKILL.md` | Agent-executable skill instructions | Yes | Yes — YAML frontmatter + 7 imperative sections; references activate(), install.sh, CLI commands | Yes — references bootstrap.ts as entry_point and install.sh as install_script in frontmatter | VERIFIED |
| `skills/agentbnb/bootstrap.test.ts` | Integration test for activate()/deactivate() lifecycle | Yes | Yes — 8 integration tests, real implementations, :memory: DBs, afterEach cleanup | Yes — imports activate and deactivate from ./bootstrap.js | VERIFIED |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `skills/agentbnb/bootstrap.ts` | `src/runtime/agent-runtime.ts` | imports AgentRuntime constructor | WIRED | Line 14: `import { AgentRuntime } from '../../src/runtime/agent-runtime.js'`; line 80: `new AgentRuntime(...)` |
| `skills/agentbnb/bootstrap.ts` | `src/openclaw/soul-sync.ts` | imports publishFromSoulV2 | WIRED | Line 15: `import { publishFromSoulV2 } from '../../src/openclaw/soul-sync.js'`; line 83: `publishFromSoulV2(runtime.registryDb, soulContent, owner)` |
| `skills/agentbnb/bootstrap.ts` | `src/gateway/server.ts` | imports createGatewayServer | WIRED | Line 16: `import { createGatewayServer } from '../../src/gateway/server.js'`; lines 85-93: `createGatewayServer({...})` + `gateway.listen(...)` |
| `skills/agentbnb/bootstrap.ts` | `src/autonomy/idle-monitor.ts` | imports IdleMonitor | WIRED | Line 17: `import { IdleMonitor } from '../../src/autonomy/idle-monitor.js'`; line 95: `new IdleMonitor({...})` |
| `skills/agentbnb/install.sh` | `src/cli/index.ts` | invokes agentbnb CLI commands | WIRED | Lines 80/86/96/121/148: `agentbnb --version`, `agentbnb init --yes`, `agentbnb openclaw sync` all present |
| `skills/agentbnb/HEARTBEAT.rules.md` | `src/openclaw/heartbeat-writer.ts` | uses same marker format | WIRED | heartbeat-writer.ts: `HEARTBEAT_MARKER_START = '<!-- agentbnb:start -->'`; HEARTBEAT.rules.md: `<!-- agentbnb:start -->` and `<!-- agentbnb:end -->` — byte-for-byte match |
| `skills/agentbnb/bootstrap.test.ts` | `skills/agentbnb/bootstrap.ts` | imports activate and deactivate | WIRED | Lines 16-17: `import { activate, deactivate } from './bootstrap.js'`; used in all 8 tests |
| `skills/agentbnb/SKILL.md` | `skills/agentbnb/bootstrap.ts` | references activate() as primary entry point | WIRED | activate appears 8 times in SKILL.md; frontmatter: `entry_point: bootstrap.ts` |
| `skills/agentbnb/SKILL.md` | `skills/agentbnb/install.sh` | references install.sh as the setup script | WIRED | install.sh appears 3 times in SKILL.md; frontmatter: `install_script: install.sh` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CLW-01 | 10-01 | bootstrap.ts with activate()/deactivate() — single entry point that initializes AgentRuntime, publishes card from SOUL.md, starts gateway + IdleMonitor | SATISFIED | `skills/agentbnb/bootstrap.ts` exists, 113 lines, all 4 components wired in correct order, 8 integration tests pass |
| CLW-02 | 10-02 | install.sh post-install script — auto-install CLI, auto-init config, sync capabilities from SOUL.md | SATISFIED | `skills/agentbnb/install.sh` exists, is executable, passes bash -n syntax check, 5-step idempotent script covers all three behaviors |
| CLW-03 | 10-03 | SKILL.md rewrite as agent-executable instructions — frontmatter metadata, on-install steps, autonomy rules, CLI reference | SATISFIED | `skills/agentbnb/SKILL.md` has YAML frontmatter and 7 agent-executable sections in imperative language |
| CLW-04 | 10-02 | HEARTBEAT.rules.md — standalone autonomy rules file for agents to copy-paste into HEARTBEAT.md | SATISFIED | `skills/agentbnb/HEARTBEAT.rules.md` has agentbnb:start/end markers, 4 rule subsections, explanatory header |
| CLW-05 | 10-03 | Integration test — mock SOUL.md, activate(), assert card published + gateway listening + IdleMonitor running, deactivate(), assert cleanup | SATISFIED | `skills/agentbnb/bootstrap.test.ts` has 8 tests; vitest confirms 8/8 pass in 343ms with real implementations |

No orphaned requirements. All CLW-01 through CLW-05 map to plans and have implementation evidence.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | — |

No anti-patterns detected. No TODO/FIXME/PLACEHOLDER comments, no empty implementations, no stub handlers in any phase 10 artifact.

---

## Human Verification Required

None. All observable truths are verifiable programmatically:

- `activate()` / `deactivate()` lifecycle verified by 8 passing integration tests with real implementations
- `install.sh` verified with bash syntax check and executable bit check
- Marker compatibility verified by direct grep comparison between HEARTBEAT.rules.md and heartbeat-writer.ts constants
- SKILL.md structure verified by content inspection

---

## Commit Verification

All 7 commits documented in SUMMARY files were confirmed present in git:

| Commit | Plan | Description |
|--------|------|-------------|
| `0b0cf4b` | 10-01 | test: failing tests for activate()/deactivate() (RED) |
| `4d1fd3f` | 10-01 | feat: implement activate() and deactivate() (GREEN) |
| `d69b5b3` | 10-01 | refactor: trim bootstrap.ts to 113 lines |
| `5949400` | 10-02 | feat: add install.sh post-install automation |
| `327a2d6` | 10-02 | feat: add HEARTBEAT.rules.md standalone autonomy rules |
| `516d105` | 10-03 | feat: rewrite SKILL.md as agent-executable instructions |
| `81b6cbd` | 10-03 | feat: create integration test for activate()/deactivate() lifecycle |

---

## Summary

Phase 10 goal is fully achieved. All five requirements (CLW-01 through CLW-05) are satisfied with substantive, wired implementations. The 8-test integration suite passes with real implementations (no mocks), confirming the complete activate/deactivate lifecycle against live SQLite, Fastify, and IdleMonitor components. The install.sh is executable and syntactically valid. HEARTBEAT.rules.md markers match the heartbeat-writer.ts constants exactly. SKILL.md uses agent-executable imperative language with YAML frontmatter. No stubs, no orphaned artifacts, no anti-patterns.

---

_Verified: 2026-03-16T03:55:00Z_
_Verifier: Claude (gsd-verifier)_
