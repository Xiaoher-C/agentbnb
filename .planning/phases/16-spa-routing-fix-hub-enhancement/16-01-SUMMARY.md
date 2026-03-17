---
phase: 16-spa-routing-fix-hub-enhancement
plan: "01"
subsystem: ui
tags: [fastify, spa-routing, tailwind, magic-ui, clsx, color-bits, motion]

# Dependency graph
requires:
  - phase: 13-hub-redesign-premium-dark-saas
    provides: Hub SPA with React Router, Tailwind dark theme, @fastify/static serving
provides:
  - Fixed SPA routing for /hub/* deep links (no more 500 errors)
  - cn() Tailwind class merging utility at hub/src/lib/cn.ts
  - Color parsing utilities (getRGBA, colorWithOpacity) at hub/src/lib/color.ts
  - Tailwind animation keyframes (marquee, accordion, orbit) in tailwind.config.js
  - Six npm deps for Magic UI components (clsx, tailwind-merge, color-bits, @number-flow/react, @radix-ui/react-accordion, motion)
affects: [16-02-magic-ui-components]

# Tech tracking
tech-stack:
  added: [clsx, tailwind-merge, color-bits, "@number-flow/react", "@radix-ui/react-accordion", motion]
  patterns: [cn-utility-for-class-merging, color-parsing-for-canvas-rendering]

key-files:
  created:
    - hub/src/lib/cn.ts
    - hub/src/lib/color.ts
  modified:
    - src/registry/server.ts
    - hub/package.json
    - hub/pnpm-lock.yaml
    - hub/tailwind.config.js

key-decisions:
  - "Removed decorateReply: false from @fastify/static to enable reply.sendFile() in setNotFoundHandler"
  - "color.ts retains CSS variable resolution (var()) support for future flexibility"

patterns-established:
  - "cn() utility: Use cn() from hub/src/lib/cn.ts for all conditional Tailwind class merging in Magic UI components"
  - "Color utilities: Use getRGBA/colorWithOpacity from hub/src/lib/color.ts for canvas/SVG color manipulation"

requirements-completed: [SPA-01, SPA-02, MASCOT-01]

# Metrics
duration: 2min
completed: 2026-03-17
---

# Phase 16 Plan 01: SPA Routing Fix + Hub Enhancement Foundation Summary

**Fixed /hub/* SPA routing 500 error and established shared Magic UI foundation: cn() utility, color helpers, and Tailwind animation keyframes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-17T05:01:14Z
- **Completed:** 2026-03-17T05:02:56Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Fixed SPA routing 500 error by removing `decorateReply: false` from @fastify/static registration, enabling `reply.sendFile()` in setNotFoundHandler for /hub/* deep links
- Created cn() Tailwind class merging utility (clsx + tailwind-merge) used by all Magic UI components
- Created color parsing utilities (getRGBA, colorWithOpacity) for canvas/SVG rendering in FlickeringGrid and LineChart
- Added marquee, accordion-down/up, and orbit keyframe animations to Tailwind config
- Installed 6 npm dependencies for Plan 02 Magic UI component extractions
- MASCOT-01 (doodle creature) already complete in NavBar.tsx from prior work -- marked as done

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix SPA routing 500 error** - `605ac47` (fix)
2. **Task 2: Install Magic UI deps and create shared utilities** - `77a9c11` (feat)

## Files Created/Modified
- `src/registry/server.ts` - Removed decorateReply: false from @fastify/static registration
- `hub/src/lib/cn.ts` - Tailwind class merging utility (clsx + tailwind-merge)
- `hub/src/lib/color.ts` - Color parsing (getRGBA) and opacity (colorWithOpacity) utilities
- `hub/package.json` - Added clsx, tailwind-merge, color-bits, @number-flow/react, @radix-ui/react-accordion, motion
- `hub/pnpm-lock.yaml` - Lock file updated with 24 new packages
- `hub/tailwind.config.js` - Added marquee, accordion, orbit keyframes and animation utilities

## Decisions Made
- Removed `decorateReply: false` from @fastify/static: this was the root cause of the 500 error since `sendFile()` is not available on reply without the decorator
- Kept CSS variable resolution (var()) support in color.ts for future flexibility, even though current Hub uses hardcoded dark theme colors

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SPA routing fixed -- /hub/* deep links will return 200 with index.html
- All shared utilities and npm deps ready for Plan 02 Magic UI component extractions
- cn(), getRGBA(), colorWithOpacity() all compile and are importable
- Tailwind animations configured for marquee, accordion, and orbit components

---
*Phase: 16-spa-routing-fix-hub-enhancement*
*Completed: 2026-03-17*
