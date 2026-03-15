---
phase: 3
slug: ux-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (root) + hub/vitest.config.ts |
| **Quick run command** | `pnpm vitest run src/registry/server.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run relevant test file
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | Backend auth + request_log | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | API key in config | unit | `pnpm vitest run src/cli/index.test.ts` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | Hub auth + dashboard tab | unit | `cd hub && pnpm test` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 2 | Share page | unit | `cd hub && pnpm test` | ✅ | ⬜ pending |
| 03-02-03 | 02 | 2 | Status/monitoring page | unit | `cd hub && pnpm test` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 3 | Integration + human verify | integration | `pnpm vitest run src/cli/index.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `request_log` SQLite table creation in registry store
- [ ] `api_key` field in AgentBnBConfig + CLI init generation

*Foundation data layer needed before auth endpoints or UI can be tested.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard tab layout | UX visual | Layout verification | Run serve, visit /hub, check "My Agent" tab |
| Share page edit flow | UX interaction | Multi-step user flow | Visit /hub share tab, verify editable fields |
| Mobile responsive | Responsive design | Visual breakpoints | Resize browser, check layout at 375px/768px |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
