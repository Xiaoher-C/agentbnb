---
phase: 4
slug: agent-runtime-multi-skill-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 4 — Validation Strategy

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
| 04-01-01 | 01 | 1 | RUN-01 | unit | `pnpm test:run -- --grep "AgentRuntime"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | RUN-01 | unit | `pnpm test:run -- --grep "escrow recovery"` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | RUN-02 | unit | `pnpm test:run -- --grep "skills"` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | RUN-03 | unit | `pnpm test:run -- --grep "migration"` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | RUN-03 | unit | `pnpm test:run -- --grep "FTS5"` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | RUN-04 | unit | `pnpm test:run -- --grep "skill_id"` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | RUN-04 | integration | `pnpm test:run -- --grep "gateway routing"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/runtime/agent-runtime.test.ts` — stubs for AgentRuntime lifecycle, SIGTERM, escrow recovery
- [ ] `src/registry/card.test.ts` — extended for skills[] schema validation
- [ ] `src/registry/store.test.ts` — extended for migration, FTS5 skills[] search
- [ ] `src/gateway/server.test.ts` — extended for skill_id routing

*Existing test infrastructure (vitest, fixtures) covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGTERM graceful shutdown | RUN-01 | OS signal handling requires process-level test | Start `agentbnb serve`, send SIGTERM, verify clean exit log |
| v1.x card migration on real DB | RUN-03 | Requires pre-existing v1.x SQLite database | Create v1.x cards, restart with v2.0 code, verify migration |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
