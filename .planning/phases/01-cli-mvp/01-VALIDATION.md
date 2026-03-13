---
phase: 1
slug: cli-mvp
status: draft
nyquist_compliant: false
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | npm-package | unit | `pnpm vitest run src/cli/init.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | card-spec-v1 | unit | `pnpm vitest run src/registry/card-v1.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | p2p-discovery | integration | `pnpm vitest run src/discovery/mdns.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | auth-exchange | unit | `pnpm vitest run src/gateway/auth-exchange.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | connect-cmd | integration | `pnpm vitest run src/cli/connect.test.ts` | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 2 | docs | manual | N/A | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for new Phase 1 modules (discovery, auth exchange, connect)
- [ ] Existing vitest infrastructure covers base needs

*Existing infrastructure from Phase 0 covers test framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx agentbnb init` works from clean install | npm-package | Requires published npm package | Publish to npm, run `npx agentbnb init` in a clean directory |
| mDNS discovery across two machines | p2p-discovery | Requires LAN network with two machines | Start `agentbnb serve` on machine A, run `agentbnb discover` on machine B |
| Documentation completeness | docs | Subjective quality | Review README, examples, and getting-started guide |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
