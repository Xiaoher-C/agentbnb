---
phase: 13
slug: activity-feed-docs-page
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-16
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (backend: root config, Hub: hub/vite.config.ts) |
| **Config file** | Root: vitest.config, Hub: hub/vite.config.ts |
| **Quick run command** | `pnpm vitest run src/registry/server.test.ts` |
| **Full suite command** | `pnpm test && cd hub && pnpm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/registry/server.test.ts`
- **After every plan wave:** Run `pnpm test && cd hub && pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | FEED-04 | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ extend | ⬜ pending |
| 13-01-02 | 01 | 1 | FEED-01, FEED-02, FEED-03 | unit | `cd hub && pnpm vitest run` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 1 | DOCS-01, DOCS-02 | unit | `cd hub && pnpm vitest run src/lib/docs-content.test.ts` | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 1 | DOCS-03, DOCS-04 | smoke | manual browser check | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `hub/src/hooks/useActivity.test.ts` — stubs for FEED-03 prepend pattern and since timestamp
- [ ] `hub/src/lib/docs-content.test.ts` — stubs for DOCS-02 install command completeness (4 tools)
- Extend existing `src/registry/server.test.ts` for FEED-04 (GET /api/activity route)

*Existing infrastructure covers framework — Vitest already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Activity feed scroll position preserved on poll | FEED-03 | DOM scroll state | Open /hub/#/activity, scroll down, wait 10s, verify position unchanged |
| Activity page shows chronological events | FEED-01 | Visual rendering | Open /hub/#/activity, verify events in time order |
| Docs page renders 4 sections | DOCS-01–04 | Visual layout | Open /hub/#/docs, verify Getting Started, Install, Schema, API sections |
| Copy buttons work | DOCS-02 | Clipboard API | Click copy on each install command, verify clipboard content |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
