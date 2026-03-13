---
phase: 01-cli-mvp
plan: 04
subsystem: cli
tags: [lan-ip, networkInterfaces, readme, documentation, examples, mdns, demo]

# Dependency graph
requires:
  - phase: 01-cli-mvp/01-03
    provides: peer management (connect/peers commands), mDNS CLI integration
  - phase: 01-cli-mvp/01-01
    provides: npm package build pipeline, spec_version 1.0 schema
provides:
  - LAN IP auto-detection in agentbnb init (networkInterfaces-based)
  - --host flag for manual IP override on init
  - README.md with full documentation (install, quickstart, commands, architecture)
  - examples/two-agent-demo/ with runnable demo scripts
  - OpenSpec SDD process adoption documented (R-011)
affects: [future-phases, external-users, dogfood-testing]

# Tech tracking
tech-stack:
  added: [node:os networkInterfaces]
  patterns:
    - getLanIp() helper iterates networkInterfaces for first non-internal IPv4
    - AGENTBNB_DIR env var for demo isolation in shell scripts
    - --host flag pattern for manual override of auto-detected values

key-files:
  created:
    - README.md
    - examples/two-agent-demo/sample-card.json
    - examples/two-agent-demo/agent-a-setup.sh
    - examples/two-agent-demo/agent-b-setup.sh
    - examples/two-agent-demo/demo.sh
  modified:
    - src/cli/index.ts

key-decisions:
  - "getLanIp() falls back to localhost if no non-internal IPv4 interface found"
  - "init --host flag allows manual IP override for edge cases (VPN, multiple interfaces)"
  - "demo.sh uses AGENTBNB_DIR isolation with trap/cleanup for temp dirs"
  - "README includes OpenSpec SDD section as process adoption, not runtime dependency"

patterns-established:
  - "LAN IP detection: iterate networkInterfaces(), pick first non-internal IPv4"
  - "Shell demo isolation: AGENTBNB_DIR=tmpdir + trap cleanup EXIT"

requirements-completed: [R-011, R-012]

# Metrics
duration: 10min
completed: 2026-03-14
---

# Phase 1 Plan 04: Examples + README Summary

**LAN IP auto-detection via networkInterfaces() in init command, 297-line README with full CLI docs and mDNS caveats, plus runnable two-agent demo in examples/**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-14T00:00:00Z
- **Completed:** 2026-03-14T00:10:00Z
- **Tasks:** 2 (Task 3 is human-verify checkpoint)
- **Files modified:** 6

## Accomplishments

- Fixed `agentbnb init` to auto-detect LAN IP using `networkInterfaces()`, replacing hardcoded `localhost`
- Added `--host` flag for manual IP override when auto-detection is insufficient
- Created comprehensive README.md (297 lines) covering install, quickstart, two-machine setup, all commands, capability card format, architecture, mDNS caveats, development guide, OpenSpec SDD section
- Created `examples/two-agent-demo/` with sample-card.json (Level 1 text-summarizer), provider setup script, consumer setup script, and single-machine demo with isolated temp dirs

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix init command to detect and use LAN IP** - `0d4e88f` (feat)
2. **Task 2: Create README and two-agent demo examples** - `7237cd9` (feat)

## Files Created/Modified

- `src/cli/index.ts` — Added `networkInterfaces` import, `getLanIp()` helper, `--host` flag, updated gateway_url construction, added Gateway line to init output
- `README.md` — Full documentation: features, quick start, two-machine setup, commands reference, capability card format, architecture, mDNS discovery, development, examples, OpenSpec SDD, license
- `examples/two-agent-demo/sample-card.json` — Valid Capability Card: text-summarizer, spec_version 1.0, Level 1, 5 credits/call
- `examples/two-agent-demo/agent-a-setup.sh` — Provider setup: init alice, publish card, serve --announce
- `examples/two-agent-demo/agent-b-setup.sh` — Consumer setup: init bob, discover --local, connect peer, request capability
- `examples/two-agent-demo/demo.sh` — Single-machine demo with AGENTBNB_DIR isolation and cleanup trap (96 lines)

## Decisions Made

- `getLanIp()` falls back to `'localhost'` if no non-internal IPv4 found — ensures init never crashes on unusual network configurations
- `--host` flag accepts IP string override — needed for VPN scenarios, multiple interfaces, or containers where auto-detection picks wrong interface
- `demo.sh` uses `AGENTBNB_DIR` env isolation with `trap cleanup EXIT` — clean test environment without touching user's actual config
- OpenSpec SDD documented as development process adoption, not runtime dependency — accurate framing for R-011

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1 CLI MVP is complete: npm-ready package with spec v1.0, mDNS discovery, peer management, LAN IP detection, documentation, and examples
- Human verification (Task 3) required to confirm: `pnpm test:run` (107 tests), `pnpm build`, CLI commands functional, README accurate, demo scripts runnable
- All 107 tests passing, build succeeds, typecheck clean

---
*Phase: 01-cli-mvp*
*Completed: 2026-03-14*
