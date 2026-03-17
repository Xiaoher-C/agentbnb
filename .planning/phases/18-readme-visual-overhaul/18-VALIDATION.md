---
phase: 18
slug: readme-visual-overhaul
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-17
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Shell smoke tests (file existence, content checks) + Playwright for screenshot |
| **Config file** | N/A — this phase modifies static files |
| **Quick run command** | `node -e "const f=require('fs').readFileSync('README.md','utf8'); console.log(f.includes('shields.io') && f.includes('What') && f.includes('Contributing'))"` |
| **Full suite command** | Content checks + `test -s docs/hub-screenshot.png` + `test -f docs/banner.svg` |
| **Estimated runtime** | ~3 seconds (excluding screenshot capture) |

---

## Sampling Rate

- **After every task commit:** Content pattern checks on README.md
- **After every plan wave:** Full existing test suite (no regressions) + file checks
- **Before `/gsd:verify-work`:** All files exist, README content complete, screenshot non-empty
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | README-01, README-02, README-03 | smoke | `node -e` content checks | N/A | ⬜ pending |
| 18-01-02 | 01 | 1 | README-04 | smoke | `test -s docs/hub-screenshot.png` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- No test framework changes needed — this phase modifies static files only
- Content checks are inline shell, not Vitest tests
- Screenshot capture requires Playwright (already installed globally)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Badges render in GitHub preview | README-01 | GitHub markdown rendering | Push and check GitHub repo page |
| Hero banner SVG renders correctly | README-02 | SVG rendering in GitHub | Open README in GitHub preview, verify banner loads |
| Section structure is clear | README-03 | Content quality | Review README sections: What, Install, Quick Start, Architecture, Contributing |
| Hub screenshot shows real UI | README-04 | Visual quality | Open docs/hub-screenshot.png, verify it shows Hub UI |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
