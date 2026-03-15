---
phase: 7
slug: auto-request
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run` |
| **Full suite command** | `pnpm test:run && npx tsc --noEmit` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run`
- **After every plan wave:** Run `pnpm test:run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | REQ-05 | unit | `npx vitest run src/autonomy/pending-requests.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | REQ-05 | integration | `npx vitest run src/registry-server/owner-routes.test.ts` | ✅ | ⬜ pending |
| 07-02-01 | 02 | 2 | REQ-01, REQ-02, REQ-03, REQ-04, REQ-06 | unit | `npx vitest run src/autonomy/auto-request.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | ALL | manual | `pnpm test:run && npx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/autonomy/pending-requests.test.ts` — stubs for pending_requests CRUD
- [ ] `src/autonomy/auto-request.test.ts` — stubs for AutoRequestor, peer scoring, self-exclusion, budget gating

*Existing test infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full auto-request E2E with 2 agents | REQ-04 | Requires two running gateways | Start agent A + B, trigger gap on A, verify B executes and credits transfer |
| Tier 3 approval in Hub | REQ-05 | Requires Hub open | Trigger Tier 3 request, verify pending in Hub dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
