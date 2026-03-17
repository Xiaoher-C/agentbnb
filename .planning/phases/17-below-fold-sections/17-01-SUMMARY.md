---
phase: 17-below-fold-sections
plan: "01"
subsystem: hub-ui
tags: [react, components, marquee, accordion, tdd, below-fold]
dependency_graph:
  requires: []
  provides:
    - CompatibleWithSection component (scrolling tool marquee)
    - FAQSection component (6-item Radix accordion)
    - ValuePropSection component (protocol description)
    - DiscoverPage wired with all three below-fold sections
  affects:
    - hub/src/pages/DiscoverPage.tsx
tech_stack:
  added: []
  patterns:
    - TDD (RED→GREEN) for all three components
    - Named exports + default exports for each component
    - Radix UI accordion with lazy-mount content (click to reveal in tests)
    - CSS-only Marquee with pauseOnHover
    - hub-* design tokens exclusively (no hard-coded hex)
key_files:
  created:
    - hub/src/components/CompatibleWithSection.tsx
    - hub/src/components/CompatibleWithSection.test.tsx
    - hub/src/components/FAQSection.tsx
    - hub/src/components/FAQSection.test.tsx
    - hub/src/components/ValuePropSection.tsx
    - hub/src/components/ValuePropSection.test.tsx
  modified:
    - hub/src/pages/DiscoverPage.tsx
decisions:
  - Radix accordion content is lazily mounted — tests click triggers to reveal answer text rather than checking hidden DOM
  - Used named exports (CompatibleWithSection, FAQSection, ValuePropSection) plus default re-exports for flexibility
  - ToolPill is an internal helper in CompatibleWithSection, not exported
  - hub-text-muted used for section headings (consistent with other small-caps headings in Hub)
  - FAQ answer content verified via fireEvent.click on triggers (not hidden DOM)
metrics:
  duration: "~3.5 minutes"
  completed: "2026-03-17"
  tasks_completed: 2
  files_created: 6
  files_modified: 1
  tests_added: 29
---

# Phase 17 Plan 01: Below-Fold Sections Summary

**One-liner:** Three below-fold sections added to DiscoverPage — CSS marquee of 10 tool names, 6-item Radix accordion FAQ, and a peer-to-peer protocol value proposition paragraph.

## What Was Built

Three standalone React components wired into the Discover route, giving first-time visitors supporting context below the capability card grid:

1. **CompatibleWithSection** — scrolling CSS marquee listing Claude Code, OpenClaw, Antigravity, Cursor, Windsurf, Node.js, Python, TypeScript, JSON-RPC, HTTP as tool pills. Uses `pauseOnHover` and `[--duration:30s]`.

2. **FAQSection** — 6-item Radix accordion with Q&A covering: what AgentBnB is, how credits work, how to list skills, supported frameworks, open source status, and peer discovery. Uses existing `hub/src/components/ui/accordion.tsx` primitives.

3. **ValuePropSection** — paragraph-based section with "The Protocol" heading, full protocol description containing "peer-to-peer", and a tagline ("Open source. MIT licensed. Built for agents, by agents.").

All three sections render unconditionally after the card grid in `DiscoverPage.tsx`, regardless of loading/error/empty state.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create three below-fold section components with tests | 6dff8a7 | 6 new files |
| 2 | Wire below-fold sections into DiscoverPage | 27ec1fe | DiscoverPage.tsx |

## Test Results

- 29 new tests added across 3 test files
- All 29 tests pass (GREEN)
- 19 of 20 Hub test files pass
- 1 pre-existing failure: `useAuth.test.ts` — `localStorage.clear is not a function` (environment issue, existed before this plan, confirmed by stash test)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FAQ answer content test strategy**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Radix accordion uses lazy-mount content — `AccordionContent` is not rendered in DOM until item is clicked. `container.textContent` and `container.innerHTML` both returned empty content divs for closed items.
- **Fix:** Updated test assertions to use `fireEvent.click(trigger)` to open each accordion item before asserting answer text. This tests the actual user interaction pattern.
- **Files modified:** `hub/src/components/FAQSection.test.tsx`
- **Commit:** Included in 6dff8a7

## Self-Check

Files created:
- hub/src/components/CompatibleWithSection.tsx: FOUND
- hub/src/components/FAQSection.tsx: FOUND
- hub/src/components/ValuePropSection.tsx: FOUND
- hub/src/components/CompatibleWithSection.test.tsx: FOUND
- hub/src/components/FAQSection.test.tsx: FOUND
- hub/src/components/ValuePropSection.test.tsx: FOUND

Commits:
- 6dff8a7: feat(17-01): add below-fold section components with tests
- 27ec1fe: feat(17-01): wire below-fold sections into DiscoverPage
