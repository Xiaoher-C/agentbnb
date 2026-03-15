---
phase: 8
slug: openclaw-deep-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 8 — Validation Strategy

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
| 08-01-01 | 01 | 1 | OC-03 | unit | `npx vitest run src/openclaw/soul-sync.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | OC-02 | unit | `npx vitest run src/openclaw/heartbeat-writer.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | OC-01 | unit | `npx vitest run src/openclaw/skill.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | OC-04 | unit | `npx vitest run src/cli/index.test.ts` | ✅ | ⬜ pending |
| 08-03-02 | 03 | 2 | ALL | manual | `pnpm test:run && npx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/openclaw/soul-sync.test.ts` — stubs for parseSoulMdV2, skill ID derivation
- [ ] `src/openclaw/heartbeat-writer.test.ts` — stubs for rules block generation
- [ ] `src/openclaw/skill.test.ts` — stubs for skill lifecycle hooks

*Existing test infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| openclaw install agentbnb | OC-01 | Requires OpenClaw CLI | Copy skills/agentbnb/ to workspace, verify SKILL.md loads |
| HEARTBEAT.md injection | OC-02 | Requires real HEARTBEAT.md file | Run `agentbnb openclaw rules`, paste into HEARTBEAT.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
