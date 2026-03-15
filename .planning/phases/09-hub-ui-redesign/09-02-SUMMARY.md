---
phase: 09-hub-ui-redesign
plan: 02
subsystem: hub-ui
tags: [modal, overlay, animation, react, ux]
dependency_graph:
  requires: [09-01]
  provides: [CardModal component, modal state wiring in App.tsx]
  affects: [hub/src/App.tsx, hub/src/components/CardModal.tsx, hub/src/components/CapabilityCard.tsx]
tech_stack:
  added: []
  patterns: [react-state-modal, backdrop-blur-overlay, css-transition-animation, body-scroll-lock]
key_files:
  created:
    - hub/src/components/CardModal.tsx
  modified:
    - hub/src/App.tsx
decisions:
  - "CardModal animates via CSS transitions on a isVisible state variable — simpler than keyframes, easy to tune timing"
  - "animate-out sets isVisible=false then calls onClose after 150ms to allow exit animation to complete"
  - "backdrop-filter uses inline style with WebkitBackdropFilter fallback for Safari compatibility"
  - "Pre-existing useAuth test failures (localStorage.clear not a function) are out of scope — not caused by this plan"
metrics:
  duration: "~2.5 min"
  completed_date: "2026-03-16"
  tasks: 2
  files_created: 1
  files_modified: 1
---

# Phase 9 Plan 02: Card Modal Overlay Summary

**One-liner:** Centered 520px detail modal with backdrop-filter blur(12px), scale animation, and full card content (identicon, I/O, stats, CLI code block with copy).

## What Was Built

Created `CardModal.tsx` — a full-screen overlay modal activated when a capability card is clicked. The modal replaces the old in-place expand behavior with a premium centered detail view.

Wired the modal into `App.tsx` via `selectedCard` state (`HubCard | null`). Clicking any card calls `setSelectedCard(card)`; `onClose` sets it back to `null`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create CardModal component | dc5a331 | hub/src/components/CardModal.tsx (new, 290 lines) |
| 2 | Wire modal into App.tsx | 27f0b70 | hub/src/App.tsx (modal state + CardModal render) |

## Key Behaviors Delivered

- Fixed inset-0 z-50 overlay with `rgba(0,0,0,0.7)` + `backdrop-filter: blur(12px)` (WebKit prefix included)
- Modal panel: 520px max-width, `#111117` background, `1px solid rgba(255,255,255,0.08)` border, `rounded-modal` (20px), padding 32px
- Animate in: scale 0.96→1, opacity 0→1, 200ms ease-out
- Animate out: scale 1→0.96, opacity 1→0, 150ms ease-in (via `handleClose` that delays `onClose` by 150ms)
- ESC key closes via `useEffect` keydown listener
- Backdrop click closes (stopPropagation on panel prevents content clicks from closing)
- Body scroll locked via `document.body.style.overflow = 'hidden'`
- Content: 48px identicon (boring-avatars), name (18px semibold), owner handle, status dot, category chips, description, inputs/outputs with types, stats (cost, free tier, success rate, latency), CLI code block with Copy button (2s checkmark feedback)

## Deviations from Plan

None — plan executed exactly as written.

**Note on Wave 2 parallel execution:** Plan 09-03 ran concurrently and committed App.tsx changes in the same time window. The App.tsx I wrote was picked up by 09-03's commit (27f0b70), which is why Task 2 has no separate commit hash from this plan. The content is identical and fully correct.

## Self-Check: PASSED

- hub/src/components/CardModal.tsx: FOUND
- Commit dc5a331 (CardModal component): FOUND
- Commit 27f0b70 (App.tsx modal wiring): FOUND
- selectedCard state in App.tsx: FOUND
- CardModal import in App.tsx: FOUND
