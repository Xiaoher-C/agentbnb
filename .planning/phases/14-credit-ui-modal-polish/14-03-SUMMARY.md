---
phase: 14-credit-ui-modal-polish
plan: "03"
subsystem: hub-ui
tags: [modal, ios-scroll, mobile-ux, copy-button, react-router]
dependency_graph:
  requires: [14-01]
  provides: [enhanced-card-modal, mobile-bottom-sheet, ios-scroll-fix]
  affects: [hub/src/components/CardModal.tsx, hub/src/types.ts]
tech_stack:
  added: []
  patterns: [position-fixed-scroll-lock, bottom-sheet-layout, navigate-with-close-delay]
key_files:
  created:
    - hub/src/components/CardModal.test.tsx
  modified:
    - hub/src/components/CardModal.tsx
    - hub/src/types.ts
decisions:
  - iOS scroll lock uses position-fixed + saved scrollY, not overflow:hidden — prevents Safari rubber-band bug
  - Owner navigation uses setTimeout(160) after handleClose() to ensure 150ms close animation completes before route change
  - Idle rate color coded: emerald (>70% available), yellow (<30% available), neutral otherwise
  - CopyButton from Phase 13 replaces inline clipboard logic — DRY, consistent visual pattern
  - Mobile bottom sheet uses items-end on backdrop + rounded-t-modal on panel — no CSS media query needed in JS
metrics:
  duration: 4min
  completed_date: "2026-03-16"
  tasks_completed: 2
  files_changed: 3
---

# Phase 14 Plan 03: CardModal Enhancements Summary

**One-liner:** Enhanced CardModal with iOS position-fixed scroll lock, CopyButton request section, idle rate availability indicator, navigate-then-close owner profile link, and mobile bottom sheet layout.

## What Was Built

Enhanced `hub/src/components/CardModal.tsx` with 5 targeted improvements covering all requirements MODAL-01/02/03 and POLISH-02/05:

1. **POLISH-05 — iOS-safe scroll lock:** Replaced `document.body.style.overflow = 'hidden'` with `lockScroll()` / `unlockScroll()` functions using `position: fixed` + saved `scrollY`. Prevents the iOS Safari rubber-band scroll bug where body jumps to top on modal open.

2. **MODAL-01 — Request this skill button:** Replaced inline `<button onClick={handleCopy}>Copy</button>` with the reusable `CopyButton` component from Phase 13. Renamed section header from "Request via CLI" to "Request this skill". Removed local `copied` state and `handleCopy` function.

3. **MODAL-02 — Availability indicator with idle rate:** Extended the Online/Offline status line to show `· Idle X%` when `card.metadata.idle_rate` is present and agent is online. Color-coded: emerald for >70% (highly available), yellow for <30% (busy), neutral otherwise.

4. **MODAL-03 — Owner profile link:** Converted the plain `<p>@{owner}</p>` to a `<button>` that calls `handleClose()` followed by `navigate('/agents/:owner')` with a 160ms delay. The delay ensures the 150ms close animation completes before navigation.

5. **POLISH-02 — Mobile bottom sheet:** Changed backdrop alignment to `items-end sm:items-center`, panel to `w-full sm:max-w-[520px] rounded-t-modal sm:rounded-modal`, added drag handle (white pill, mobile-only via `sm:hidden`), and gave the close button `min-h-[44px] min-w-[44px]` on mobile.

Also added `idle_rate?: number` to `HubCard.metadata` in `hub/src/types.ts`.

## Test Results

- **New tests added:** 10 tests in `hub/src/components/CardModal.test.tsx` — all green
- **Pre-existing failures:** 7 failures in `useAuth.test.ts` (6) and `RequestHistory.test.tsx` (1) — confirmed pre-existing, out of scope
- **Hub suite:** 97/104 passing (97 were passing before; our 10 new tests all pass)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1    | c0394bb | test(14-03): add CardModal test scaffold + idle_rate to HubCard type |
| 2    | 6f9a71c | feat(14-03): enhance CardModal — request button, availability, profile link, mobile sheet, iOS scroll lock |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] window.scrollTo not available in jsdom**

- **Found during:** Task 2 test run
- **Issue:** jsdom outputs "Not implemented: window.scrollTo" stderr warning during cleanup (unlockScroll calls window.scrollTo). This is a jsdom limitation, not a real bug — tests still pass.
- **Fix:** No code change needed. The warning is benign. The production implementation is correct; jsdom simply doesn't implement scrollTo. Tests all pass.
- **Files modified:** none

## Self-Check: PASSED

- hub/src/components/CardModal.tsx — FOUND, contains lockScroll, CopyButton, useNavigate, idle_rate, items-end
- hub/src/components/CardModal.test.tsx — FOUND, 10 tests all passing
- hub/src/types.ts — FOUND, idle_rate?: number added
- Commit c0394bb — FOUND
- Commit 6f9a71c — FOUND
