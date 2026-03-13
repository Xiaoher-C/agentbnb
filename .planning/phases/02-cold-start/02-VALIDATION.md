---
phase: 2
slug: cold-start
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1 |
| **Config file** | vitest.config.ts (exists from Phase 0) |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --coverage` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | R-013 (reputation) | unit | `pnpm vitest run src/registry/reputation.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | R-013 (web-registry) | integration | `pnpm vitest run src/registry/server.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | R-014 (marketplace) | integration | `pnpm vitest run src/registry/marketplace.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Existing vitest infrastructure covers base needs (from Phase 0/1)
- [ ] Test files created by TDD tasks within plans

*Each test file is created by the same task that creates the implementation (TDD tasks write tests first). No separate Wave 0 scaffolding plan is needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Web registry accessible from browser | R-013 | Requires running server and browser | Start `agentbnb serve`, open http://localhost:7701/cards in browser |
| Reputation updates after real execution | R-013 | Requires two running agents | Run two-agent demo, verify success_rate/avg_latency_ms update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
