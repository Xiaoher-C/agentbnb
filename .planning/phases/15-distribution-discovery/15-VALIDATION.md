---
phase: 15
slug: distribution-discovery
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Shell smoke tests (JSON parse validation) + existing Vitest suite |
| **Config file** | N/A — this phase creates static files only |
| **Quick run command** | `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"` |
| **Full suite command** | JSON validation + `pnpm vitest run src/registry/server.test.ts` (no regressions) |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** JSON parse validation on created files
- **After every plan wave:** Full existing test suite (no regressions) + JSON validation
- **Before `/gsd:verify-work`:** All files exist, JSON valid, GitHub topics confirmed, README visual check
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | DIST-01 | smoke | `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"` | ❌ creates | ⬜ pending |
| 15-01-02 | 01 | 1 | DIST-02 | smoke | `node -e "JSON.parse(require('fs').readFileSync('plugins/agentbnb-network/.claude-plugin/plugin.json','utf8'))"` | ❌ creates | ⬜ pending |
| 15-01-03 | 01 | 1 | DIST-03 | manual | Inspect SKILL.md frontmatter fields | N/A | ⬜ pending |
| 15-01-04 | 01 | 1 | DIST-04 | manual | `gh api repos/Xiaoher-C/agentbnb/topics` | N/A | ⬜ pending |
| 15-01-05 | 01 | 1 | DIST-05 | manual | Visual README inspection | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- No test framework changes needed — this phase creates static files only
- JSON validation commands are inline shell, not Vitest tests — appropriate for static file creation
- Existing test suite must remain green (no regressions)

*No new test files to create — all validation is structural.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| marketplace.json has correct schema | DIST-01 | Schema structure beyond JSON validity | Inspect fields match Claude Code plugin spec |
| SKILL.md frontmatter complete | DIST-03 | Content correctness | Verify name, version, description, author, tags fields present |
| GitHub topics set correctly | DIST-04 | Requires authenticated GitHub API | Run `gh api repos/Xiaoher-C/agentbnb/topics` and verify 3 topics |
| README has screenshot and install commands | DIST-05 | Visual layout | Open README.md in GitHub preview, verify screenshot renders, install commands for 4 tools |
| Hub screenshot exists and renders | DIST-05 | Image file quality | Open docs/hub-screenshot.png, verify it shows the hub UI |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
