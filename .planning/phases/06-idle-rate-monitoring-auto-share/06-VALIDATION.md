---
phase: 6
slug: idle-rate-monitoring-auto-share
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 6 — Validation Strategy

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
| 06-01-01 | 01 | 1 | IDLE-01, IDLE-02 | unit | `npx vitest run src/registry/request-log.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | IDLE-04 | unit | `npx vitest run src/registry/store.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | IDLE-01, IDLE-03, IDLE-05 | unit | `npx vitest run src/autonomy/idle-monitor.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | IDLE-05 | integration | `npx vitest run src/cli/index.test.ts` | ✅ | ⬜ pending |
| 06-02-03 | 02 | 2 | ALL | manual | `pnpm test:run && npx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/autonomy/idle-monitor.test.ts` — stubs for IdleMonitor lifecycle, idle rate computation, auto-share trigger
- [ ] `src/registry/request-log.test.ts` — extended for getSkillRequestCount()
- [ ] `src/registry/store.test.ts` — extended for updateSkillAvailability(), updateSkillIdleRate()

*Existing test infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| IdleMonitor starts/stops with serve | IDLE-05 | Requires live process | Start `agentbnb serve`, verify "IdleMonitor started" log, Ctrl+C, verify clean stop |
| Auto-share flips card online | IDLE-03 | Requires running server + time passage | Start serve, wait 60s, check `agentbnb discover` shows card as online |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
