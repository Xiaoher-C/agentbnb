---
phase: 14
slug: credit-ui-modal-polish
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-16
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.0.4 |
| **Config file** | Hub: hub/vite.config.ts (test section), Backend: root vitest.config.ts |
| **Quick run command** | `cd hub && pnpm vitest run` |
| **Full suite command** | `pnpm vitest run && cd hub && pnpm vitest run` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd hub && pnpm vitest run`
- **After every plan wave:** Run `pnpm vitest run && cd hub && pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | CREDIT-01 | unit | `cd hub && pnpm vitest run src/lib/utils.test.ts` | ✅ extend | ⬜ pending |
| 14-01-02 | 01 | 1 | CREDIT-02 | unit | `cd hub && pnpm vitest run src/components/CapabilityCard.test.tsx` | ✅ extend | ⬜ pending |
| 14-01-03 | 01 | 1 | CREDIT-06 | integration | `pnpm vitest run src/registry/server.test.ts` | ✅ extend | ⬜ pending |
| 14-02-01 | 02 | 1 | CREDIT-03 | unit | `cd hub && pnpm vitest run src/components/OwnerDashboard.test.tsx` | ✅ extend | ⬜ pending |
| 14-02-02 | 02 | 1 | CREDIT-04 | unit | `cd hub && pnpm vitest run src/components/EarningsChart.test.tsx` | ❌ W0 | ⬜ pending |
| 14-02-03 | 02 | 1 | CREDIT-05 | unit | `cd hub && pnpm vitest run src/components/TransactionHistory.test.tsx` | ❌ W0 | ⬜ pending |
| 14-03-01 | 03 | 2 | MODAL-01 | unit | `cd hub && pnpm vitest run src/components/CardModal.test.tsx` | ❌ W0 | ⬜ pending |
| 14-03-02 | 03 | 2 | MODAL-02 | unit | included in CardModal.test.tsx | ❌ W0 | ⬜ pending |
| 14-03-03 | 03 | 2 | MODAL-03 | unit | included in CardModal.test.tsx | ❌ W0 | ⬜ pending |
| 14-04-01 | 04 | 2 | POLISH-01 | unit | `cd hub && pnpm vitest run src/components/NavBar.test.tsx` | ❌ W0 | ⬜ pending |
| 14-04-02 | 04 | 2 | POLISH-02 | visual | manual browser check | N/A | ⬜ pending |
| 14-04-03 | 04 | 2 | POLISH-03 | unit | `cd hub && pnpm vitest run src/components/OwnerDashboard.test.tsx` | ✅ extend | ⬜ pending |
| 14-04-04 | 04 | 2 | POLISH-04 | unit | `cd hub && pnpm vitest run src/components/Skeleton.test.tsx` | ❌ W0 | ⬜ pending |
| 14-04-05 | 04 | 2 | POLISH-05 | unit | included in CardModal.test.tsx | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `hub/src/components/EarningsChart.test.tsx` — stubs for CREDIT-04 (recharts AreaChart rendering with mock data)
- [ ] `hub/src/components/TransactionHistory.test.tsx` — stubs for CREDIT-05 (transaction list rendering)
- [ ] `hub/src/components/CardModal.test.tsx` — stubs for MODAL-01, MODAL-02, MODAL-03, POLISH-05 (CLI copy, availability, owner link, scroll lock)
- [ ] `hub/src/components/NavBar.test.tsx` — stubs for POLISH-01 (hamburger button on mobile)
- [ ] `hub/src/components/Skeleton.test.tsx` — stubs for POLISH-04 (animate-pulse class)
- Extend existing `hub/src/lib/utils.test.ts` for CREDIT-01 (`formatCredits()` returns `"cr X"`)
- Extend existing `hub/src/components/OwnerDashboard.test.tsx` for CREDIT-03 (reserve breakdown) and POLISH-03 (no slate-* classes)
- Extend existing `hub/src/components/CapabilityCard.test.tsx` for CREDIT-02 (`cr` prefix in rendered output)
- Extend existing `src/registry/server.test.ts` for CREDIT-06 (GET /me/transactions route)

*Existing infrastructure covers framework — Vitest + @testing-library/react already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CardModal becomes full-screen sheet on mobile | POLISH-02 | CSS media query + visual layout | Resize to < 768px, open modal, verify full-screen with 44px tap targets |
| 30-day earning chart renders correctly | CREDIT-04 | Recharts SVG rendering | Open /hub/#/myagent, verify AreaChart with emerald fill and data points |
| Hamburger menu opens/closes on mobile | POLISH-01 | CSS + JS interaction | Resize to < 768px, verify hamburger icon, tap to open drawer |
| All credit displays show `cr` prefix | CREDIT-01 | Global visual audit | Navigate all pages, verify no raw number credit displays without `cr` |
| Loading skeletons appear during fetch | POLISH-04 | Timing-dependent | Throttle network in DevTools, verify skeleton placeholders |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
