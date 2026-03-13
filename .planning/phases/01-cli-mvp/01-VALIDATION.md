---
phase: 1
slug: cli-mvp
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1 |
| **Config file** | vitest.config.ts (exists from Phase 0) |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --coverage` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Created By Plan | Status |
|---------|------|------|-------------|-----------|-------------------|----------------------|--------|
| 1-01-01 | 01 | 1 | R-008 (card-spec-v1) | unit | `pnpm vitest run src/types/index.test.ts` | src/types/index.test.ts | ⬜ pending |
| 1-01-02 | 01 | 1 | R-007 (npm-package) | smoke | `pnpm build && node dist/cli/index.js --version` | N/A (build verification) | ⬜ pending |
| 1-02-01 | 02 | 1 | R-009 (p2p-discovery) | integration | `pnpm vitest run src/discovery/mdns.test.ts` | src/discovery/mdns.test.ts | ⬜ pending |
| 1-03-01 | 03 | 2 | R-010 (peer-storage) | unit | `pnpm vitest run src/cli/peers.test.ts` | src/cli/peers.test.ts | ⬜ pending |
| 1-03-02 | 03 | 2 | R-010 (cli-wiring) | integration | `pnpm vitest run src/cli/ && pnpm typecheck` | N/A (uses existing cli tests) | ⬜ pending |
| 1-04-01 | 04 | 3 | R-010 (lan-ip) | integration | `pnpm vitest run src/cli/ && pnpm typecheck` | N/A (modifies existing) | ⬜ pending |
| 1-04-02 | 04 | 3 | R-012 (docs) | smoke | `test -f README.md && test -f examples/two-agent-demo/demo.sh` | README.md, examples/ | ⬜ pending |
| 1-04-03 | 04 | 3 | R-011, R-012 | manual | N/A (human checkpoint) | N/A | ⬜ pending |

*Status: ⬜ pending / ✅ green / ❌ red / ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Existing vitest infrastructure covers base needs (from Phase 0)
- [ ] `src/types/index.test.ts` — created or extended by Plan 01, Task 1
- [ ] `src/discovery/mdns.test.ts` — created by Plan 02, Task 1
- [ ] `src/cli/peers.test.ts` — created by Plan 03, Task 1

*Each test file is created by the same task that creates the implementation (TDD tasks write tests first). No separate Wave 0 scaffolding plan is needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx agentbnb init` works from clean install | R-007 | Requires published npm package | Publish to npm, run `npx agentbnb init` in a clean directory |
| mDNS discovery across two machines | R-009 | Requires LAN network with two machines | Start `agentbnb serve` on machine A, run `agentbnb discover` on machine B |
| Documentation completeness | R-012 | Subjective quality | Review README, examples, and getting-started guide |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
