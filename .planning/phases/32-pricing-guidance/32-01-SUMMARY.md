---
phase: 32-pricing-guidance
plan: 01
subsystem: api, registry, openclaw
tags: [pricing, aggregation, soul-md, market-reference]

# Dependency graph
requires: []
provides:
  - GET /api/pricing?q=<query> endpoint for market pricing stats
  - getPricingStats() reusable function for pricing aggregation
  - SOUL.md `pricing: N` custom pricing syntax
  - Market reference display in openclaw sync CLI
affects: [35-openapi-spec, 33-conductor-dual-role]

# Tech tracking
tech-stack:
  added: []
  patterns: [pricing aggregation via searchCards + skill-level extraction, directive parsing in SOUL.md body text]

key-files:
  created:
    - src/registry/pricing.ts
    - src/registry/pricing.test.ts
  modified:
    - src/registry/server.ts
    - src/openclaw/soul-sync.ts
    - src/openclaw/soul-sync.test.ts
    - src/skills/publish-capability.ts
    - src/cli/index.ts

key-decisions:
  - "getPricingStats uses searchCards (FTS5) then filters matching skills by query word presence in name/description"
  - "Pricing directive parsed in parseSoulMd (publish-capability.ts) so both v1 and v2 paths benefit"
  - "Negative and non-numeric pricing values silently ignored (keep default 10) rather than throwing errors"

patterns-established:
  - "SOUL.md directive pattern: `key: value` lines in H2 body are extracted and excluded from description text"

requirements-completed: [PRICE-01, PRICE-02, PRICE-03]

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 32 Plan 01: Pricing Guidance Summary

**GET /api/pricing endpoint with min/max/median/mean aggregation, SOUL.md `pricing: N` custom pricing syntax, and market reference display in openclaw sync**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-19T06:35:12Z
- **Completed:** 2026-03-19T06:39:11Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- GET /api/pricing?q=<query> returns aggregate pricing stats (min/max/median/mean/count)
- SOUL.md H2 sections support `pricing: N` directive to override default 10 credits
- CLI `openclaw sync` displays per-skill market reference prices after publishing
- 12 new tests (5 pricing stats + 7 custom pricing) all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Pricing stats module + API endpoint** - `26443b8` (feat)
2. **Task 2: SOUL.md custom pricing + market reference in openclaw sync** - `169889e` (feat)

## Files Created/Modified
- `src/registry/pricing.ts` - getPricingStats() function with min/max/median/mean/count computation
- `src/registry/pricing.test.ts` - 5 unit tests for pricing aggregation
- `src/registry/server.ts` - GET /api/pricing route added (public, no auth)
- `src/openclaw/soul-sync.ts` - parseSoulMdV2 uses custom pricing from ParsedCapability
- `src/openclaw/soul-sync.test.ts` - 7 new tests for custom pricing parsing
- `src/skills/publish-capability.ts` - ParsedCapability.pricing field + parseSoulMd extraction
- `src/cli/index.ts` - openclaw sync displays market reference per skill

## Decisions Made
- getPricingStats uses searchCards (FTS5) to find matching cards, then iterates skills to extract per-skill pricing. This reuses existing search infrastructure.
- Pricing directive is parsed at the parseSoulMd level (publish-capability.ts) so the extraction is available to both v1 and v2 code paths.
- Invalid pricing values (non-numeric, negative) silently fall back to default 10 rather than throwing errors, keeping the agent experience smooth.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Pricing endpoint ready for OpenAPI documentation (Phase 35)
- Market data accumulates as more agents publish — no bootstrapping needed

---
*Phase: 32-pricing-guidance*
*Completed: 2026-03-19*
