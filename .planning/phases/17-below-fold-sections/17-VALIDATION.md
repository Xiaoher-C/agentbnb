---
phase: 17
slug: below-fold-sections
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-17
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.0.4 + @testing-library/react |
| **Config file** | hub/vite.config.ts (test section, globals: true, environment: jsdom) |
| **Quick run command** | `cd hub && pnpm vitest run` |
| **Full suite command** | `pnpm vitest run && cd hub && pnpm vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd hub && pnpm vitest run`
- **After every plan wave:** Run `pnpm vitest run && cd hub && pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | FOLD-01 | unit | `cd hub && pnpm vitest run src/components/CompatibleWithSection.test.tsx` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | FOLD-02 | unit | `cd hub && pnpm vitest run src/components/FAQSection.test.tsx` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | FOLD-03 | unit | `cd hub && pnpm vitest run src/components/ValuePropSection.test.tsx` | ❌ W0 | ⬜ pending |
| 17-01-04 | 01 | 1 | FOLD-04 | visual | manual browser check | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `hub/src/components/CompatibleWithSection.test.tsx` — stubs for FOLD-01 (Marquee renders, tool items present)
- [ ] `hub/src/components/FAQSection.test.tsx` — stubs for FOLD-02 (Accordion renders, FAQ items present)
- [ ] `hub/src/components/ValuePropSection.test.tsx` — stubs for FOLD-03 (renders value prop text)

*Existing infrastructure covers framework — Vitest + @testing-library/react already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Marquee scrolls smoothly | FOLD-01 | CSS animation | Open /hub, scroll below cards, verify marquee animates |
| Accordion expands/collapses | FOLD-02 | Radix UI interaction | Open /hub, click FAQ items, verify expand/collapse |
| Dark theme consistency | FOLD-04 | Visual design | Verify all sections use #08080C bg, emerald accent, hub-* tokens |
| Section ordering correct | FOLD-01-03 | Layout | Verify order: Cards → Compatible With → Value Prop → FAQ |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
