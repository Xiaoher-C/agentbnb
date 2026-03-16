---
phase: 12
slug: foundation-agent-directory
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-16
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.0.4 |
| **Config file** | hub/vite.config.ts (test section, globals: true, environment: jsdom) |
| **Quick run command** | `cd hub && pnpm vitest run` |
| **Full suite command** | `pnpm vitest run && cd hub && pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd hub && pnpm vitest run`
- **After every plan wave:** Run `pnpm vitest run && cd hub && pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | NAV-01 | integration | `cd hub && pnpm vitest run src/App.test.tsx` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | NAV-02 | unit | `cd hub && pnpm vitest run src/components/NavBar.test.tsx` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | NAV-03 | unit | included in NavBar.test.tsx | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | NAV-04 | unit | included in NavBar.test.tsx | ❌ W0 | ⬜ pending |
| 12-01-05 | 01 | 1 | NAV-05 | unit | included in NavBar.test.tsx | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | AGENT-04 | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ extend | ⬜ pending |
| 12-02-02 | 02 | 1 | AGENT-05 | unit | `pnpm vitest run src/registry/server.test.ts` | ✅ extend | ⬜ pending |
| 12-03-01 | 03 | 2 | AGENT-01 | unit | `cd hub && pnpm vitest run src/components/AgentList.test.tsx` | ❌ W0 | ⬜ pending |
| 12-03-02 | 03 | 2 | AGENT-02 | unit | included in AgentList.test.tsx | ❌ W0 | ⬜ pending |
| 12-03-03 | 03 | 2 | AGENT-03 | unit | `cd hub && pnpm vitest run src/components/ProfilePage.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `hub/src/components/NavBar.test.tsx` — stubs for NAV-02, NAV-03, NAV-04, NAV-05
- [ ] `hub/src/components/AgentList.test.tsx` — stubs for AGENT-01, AGENT-02
- [ ] `hub/src/components/ProfilePage.test.tsx` — stubs for AGENT-03
- [ ] `hub/src/App.test.tsx` — stubs for NAV-01 (routing integration)
- [ ] `hub/src/hooks/useAgents.test.ts` — stubs for useAgents hook polling behavior

*Existing infrastructure covers framework — Vitest + @testing-library/react already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout of agent ranking | AGENT-02 | CSS rendering | Open /hub/#/agents, verify identicon + name + stats alignment |
| Credit badge accent green monospace | NAV-03 | CSS styling | Open hub with API key set, verify green monospace badge in nav |
| Get Started CTA visibility | NAV-04 | CSS rendering | Open hub without auth, verify CTA button visible |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
