---
phase: 01-cli-mvp
plan: 02
subsystem: discovery
tags: [mdns, bonjour-service, p2p, lan-discovery, multicast]

# Dependency graph
requires:
  - phase: 01-cli-mvp
    provides: bonjour-service installed as runtime dependency
provides:
  - src/discovery/mdns.ts with announceGateway, discoverLocalAgents, stopAnnouncement
  - DiscoveredAgent interface for LAN peer discovery
  - Idempotent mDNS cleanup on shutdown
affects:
  - 01-03-PLAN.md (connect command — manual peer registration complement to mDNS)
  - 01-04-PLAN.md (serve command — will call announceGateway)

# Tech tracking
tech-stack:
  added:
    - bonjour-service 1.3.0 (pure-JS mDNS, 8.2M weekly downloads)
  patterns:
    - Module-level Bonjour singleton (lazy-initialized, destroyed on cleanup)
    - Browse-before-announce ordering for reliable loopback discovery
    - IPv4-preferred address selection (filter out ':' in address strings)

key-files:
  created:
    - src/discovery/mdns.ts
    - src/discovery/mdns.test.ts
  modified:
    - package.json (bonjour-service dependency)
    - pnpm-lock.yaml
    - src/skills/publish-capability.ts (bug fix: spec_version field)

key-decisions:
  - "Browse before announce in tests — browser must be listening before publication or initial query cycle misses the service"
  - "Module-level Bonjour singleton lazy-initialized to avoid multiple instances on the same multicast socket"
  - "IPv4 preference via addresses.filter(addr => !addr.includes(':')) — avoids link-local IPv6 noise"
  - "stopAnnouncement sets bonjourInstance = null before destroy — idempotent, handles double-call safely"

patterns-established:
  - "Pattern: mDNS browser start before announce for reliable same-process loopback discovery"
  - "Pattern: Singleton mDNS instance with null-guard in stopAnnouncement for idempotent cleanup"

requirements-completed: [R-009]

# Metrics
duration: 3min
completed: 2026-03-13
---

# Phase 1 Plan 02: mDNS Discovery Module Summary

**bonjour-service mDNS module with announce/browse/cleanup supporting loopback discovery and idempotent shutdown**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T15:45:08Z
- **Completed:** 2026-03-13T15:48:30Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 5

## Accomplishments
- `announceGateway(owner, port, metadata?)` — publishes service type 'agentbnb' via mDNS with txt record
- `discoverLocalAgents(onFound, onDown?)` — browses for agentbnb services, fires callbacks, returns `{ stop() }` handle
- `stopAnnouncement()` — idempotent teardown: unpublishes all, destroys Bonjour instance, safe for double-call
- `DiscoveredAgent` interface exported for consumers
- All 4 TDD behavior tests pass; full suite at 99 tests (zero regressions)

## Task Commits

Each task was committed atomically:

1. **TDD RED: failing tests** - `8b398f9` (test)
2. **TDD GREEN: mdns.ts implementation + bug fix** - `34cb6ed` (feat)

_Note: TDD tasks have two commits (test → feat)_

## Files Created/Modified
- `src/discovery/mdns.ts` — mDNS announce/browse/cleanup module with Bonjour singleton
- `src/discovery/mdns.test.ts` — 4 behavior tests covering announce, loopback discover, cleanup, multi-agent
- `package.json` — added bonjour-service ^1.3.0 dependency
- `pnpm-lock.yaml` — updated lockfile
- `src/skills/publish-capability.ts` — added missing `spec_version: '1.0'` field (pre-existing bug fix)

## Decisions Made
- Browse before announce in tests: the browser sends an mDNS query on start, so it must be initialized before the service is published to catch the response to its initial query. Announce-then-browse can miss the `up` event.
- Module-level singleton avoids binding multiple UDP multicast sockets — critical since mDNS is UDP multicast and multiple instances on the same port cause conflicts.
- IPv4 preference: `service.addresses` may include IPv6 link-local addresses (`fe80::...`); filtering those out ensures URLs like `http://192.168.x.x:port` work cross-machine.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing spec_version field in publish-capability.ts**
- **Found during:** Task 1 (typecheck verification step)
- **Issue:** `CapabilityCard` object literal in `src/skills/publish-capability.ts` was missing the required `spec_version: '1.0'` field, causing `tsc --noEmit` to fail with TS2741. Pre-existing bug from Phase 0 / Phase 1 plan 01.
- **Fix:** Added `spec_version: '1.0' as const` to the card object literal
- **Files modified:** `src/skills/publish-capability.ts`
- **Verification:** `pnpm typecheck` passes cleanly
- **Committed in:** `34cb6ed` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Reversed announce/browse order in tests for reliable loopback**
- **Found during:** Task 1 GREEN (initial test run)
- **Issue:** Tests 2 and 4 timed out when announcing first then browsing. The browser's `update()` call fires an mDNS query immediately on start; if the service is already published but the query was sent before the browser started, the browser misses the response.
- **Fix:** Restructured test callbacks to start browsing first, then announce inside the Promise executor — browser is registered and listening before the service is published.
- **Files modified:** `src/discovery/mdns.test.ts`
- **Verification:** All 4 tests pass (Tests 2 and 4 resolve in ~900ms vs 4s timeout)
- **Committed in:** `34cb6ed` (absorbed into GREEN commit since it was during implementation iteration)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- mDNS loopback timing: same-process announce-then-browse can miss the `up` event because the browser queries via UDP and the query must already be active when the service responds to a query. Fixed by starting browser before announcing.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `announceGateway` + `discoverLocalAgents` + `stopAnnouncement` ready for integration into CLI `serve` and `discover --local` commands
- `DiscoveredAgent` interface exported for use in CLI output formatting
- mDNS works for LAN discovery; `connect` command (Plan 03) handles the cross-network manual registration path

---
*Phase: 01-cli-mvp*
*Completed: 2026-03-13*
