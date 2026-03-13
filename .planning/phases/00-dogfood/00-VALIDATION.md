---
phase: 0
slug: dogfood
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1 |
| **Config file** | vitest.config.ts (needs creation — Wave 0) |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 0-01-01 | 01 | 1 | R-001 | unit | `pnpm vitest run src/registry/card.test.ts` | ❌ W0 | ⬜ pending |
| 0-01-02 | 01 | 1 | R-002 | unit+integration | `pnpm vitest run src/registry/store.test.ts` | ❌ W0 | ⬜ pending |
| 0-02-01 | 02 | 2 | R-003 | unit | `pnpm vitest run src/cli/index.test.ts` | ❌ W0 | ⬜ pending |
| 0-02-02 | 02 | 2 | R-004 | integration | `pnpm vitest run src/gateway/server.test.ts` | ❌ W0 | ⬜ pending |
| 0-03-01 | 03 | 2 | R-005 | unit | `pnpm vitest run src/credit/ledger.test.ts` | ❌ W0 | ⬜ pending |
| 0-04-01 | 04 | 3 | R-006 | integration | `pnpm vitest run src/openclaw/integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest configuration
- [ ] `src/registry/card.test.ts` — stubs for R-001
- [ ] `src/registry/store.test.ts` — stubs for R-002
- [ ] `src/cli/index.test.ts` — stubs for R-003
- [ ] `src/gateway/server.test.ts` — stubs for R-004
- [ ] `src/credit/ledger.test.ts` — stubs for R-005

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OpenClaw SOUL.md card generation | R-006 | Requires actual OpenClaw agent | Manually test with 企劃總監 agent |
| End-to-end: Agent A requests, Agent B executes | R-006 | Requires two running agents | Start two gateway instances, publish card from A, request from B |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
