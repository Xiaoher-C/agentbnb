---
phase: 01-cli-mvp
plan: 03
subsystem: cli
tags: [peer-management, mdns, discovery, commander, json-rpc]

# Dependency graph
requires:
  - phase: 01-cli-mvp/01-02
    provides: mDNS announce/browse/cleanup via bonjour-service (announceGateway, discoverLocalAgents, stopAnnouncement)
  - phase: 01-cli-mvp/01-01
    provides: CLI foundation, config.ts, AGENTBNB_DIR test isolation pattern
provides:
  - peers.ts with PeerConfig type and CRUD operations (loadPeers, savePeer, removePeer, findPeer)
  - agentbnb connect <name> <url> <token> command — registers remote peer
  - agentbnb peers command — lists registered peers in table/JSON format
  - agentbnb peers remove <name> subcommand
  - agentbnb request --peer <name> — resolves URL+token from peer registry
  - agentbnb serve --announce — publishes gateway via mDNS
  - agentbnb discover --local — browses mDNS for 3s and shows discovered agents
affects: [01-04-examples-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "peers.json stored in getConfigDir() for AGENTBNB_DIR test isolation"
    - "Case-insensitive peer name matching via toLowerCase()"
    - "mDNS browsing with fixed 3-second wait then stop"
    - "Commander subcommands for peers remove via peersCommand.command()"

key-files:
  created:
    - src/cli/peers.ts
    - src/cli/peers.test.ts
  modified:
    - src/cli/index.ts
    - src/cli/config.ts

key-decisions:
  - "peers.json co-located with config.json in getConfigDir() — same AGENTBNB_DIR isolation, no extra config needed"
  - "Case-insensitive peer name comparison via toLowerCase() — prevents duplicate peers from case typos"
  - "discover --local overrides registry search (not combined) — simpler UX, mDNS and registry serve different contexts"
  - "serve --announce calls stopAnnouncement() before server.close() in gracefulShutdown — proper cleanup order"

patterns-established:
  - "Peer CRUD pattern: loadPeers() + writePeers() as internal helpers, public API is savePeer/removePeer/findPeer"
  - "CLI peer resolution: findPeer() check before requestCapability(), error message includes actionable hint"

requirements-completed: [R-010]

# Metrics
duration: 3min
completed: 2026-03-13
---

# Phase 1 Plan 3: Peer Management + mDNS CLI Integration Summary

**peers.json CRUD module (loadPeers/savePeer/removePeer/findPeer) with CLI commands: connect, peers, peers remove, request --peer, serve --announce, discover --local**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T15:51:48Z
- **Completed:** 2026-03-13T15:54:58Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/cli/peers.ts` with PeerConfig type and full CRUD (8 tests, TDD)
- Wired 4 new CLI features into `src/cli/index.ts`: connect, peers, peers remove, request --peer
- Integrated mDNS into serve --announce and discover --local
- Full test suite grows from 99 to 107 tests, all passing, typecheck clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create peer storage module** - `15b8b5c` (feat)
2. **Task 2: Wire connect, peers, --announce, --local into CLI** - `168d73a` (feat)

**Plan metadata:** (this commit)

_Note: Task 1 used TDD — tests written first, then implementation._

## Files Created/Modified

- `src/cli/peers.ts` — PeerConfig interface + loadPeers/savePeer/removePeer/findPeer functions
- `src/cli/peers.test.ts` — 8 tests covering all CRUD operations including cross-peer resolution test
- `src/cli/index.ts` — Added connect, peers, peers remove commands; updated request with --peer; added --announce to serve; added --local to discover
- `src/cli/config.ts` — Updated gateway_url JSDoc to note LAN IP recommendation for multi-machine use

## Decisions Made

- **peers.json in getConfigDir():** Co-located with config.json — consistent path, same AGENTBNB_DIR test isolation works automatically
- **Case-insensitive peer names:** `toLowerCase()` comparison prevents duplicates from case typos (e.g., "Alice" vs "alice")
- **discover --local overrides registry:** Simpler UX — mDNS discovery and local registry serve different use cases, no confusion from combining
- **stopAnnouncement() before server.close():** mDNS cleanup happens first in graceful shutdown to unpublish service before closing socket

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Peer management is complete — `agentbnb connect alice http://x.x.x.x:7700 TOKEN` + `agentbnb request --peer alice` flow is wired end-to-end
- mDNS announce/browse is wired into CLI — functional on LAN when agents are on same multicast network
- Plan 04 (Examples + README) can reference `connect`, `peers`, `serve --announce`, `discover --local` as part of the getting-started flow

## Self-Check: PASSED

All files verified present. All commits verified in git history.

---
*Phase: 01-cli-mvp*
*Completed: 2026-03-13*
