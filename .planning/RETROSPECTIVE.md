# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.1 — Ship It

**Shipped:** 2026-03-16
**Phases:** 3 | **Plans:** 10 | **Commits:** 31

### What Was Built
- Premium dark Hub UI with ambient glow, modal overlays, count-up animations
- bootstrap.ts single activate()/deactivate() entry point for OpenClaw agents
- install.sh zero-intervention setup, SKILL.md agent-executable instructions
- AGENT-NATIVE-PROTOCOL.md design bible (173 lines)
- README.md rewritten for public launch

### What Worked
- Wave-based parallel execution: Phase 10 Wave 1 (bootstrap.ts + install.sh) ran in parallel, cutting execution time
- Phase 11 all 3 plans (CLAUDE.md, README.md, AGENT-NATIVE-PROTOCOL.md) ran in parallel — no dependencies, max throughput
- Consolidating 5 roadmap plans into 3 actual plans for Phase 10 — reduced overhead without losing coverage
- TDD for bootstrap.ts — RED/GREEN/REFACTOR produced clean 113-line module with 14 tests

### What Was Inefficient
- Phase 9 was built before verifier step was integrated — had to sign off visually instead of automated verification
- `docs/hub-screenshot.png` deferred as tech debt — should have been captured during Phase 9 while Hub was running
- REQUIREMENTS.md traceability table had manual checkbox management — could be automated

### Patterns Established
- Agent-executable SKILL.md format: YAML frontmatter + imperative sections
- `<!-- agentbnb:start -->` / `<!-- agentbnb:end -->` marker convention for injectable content
- Design bible (AGENT-NATIVE-PROTOCOL.md) as foundational document linked from both CLAUDE.md and README.md

### Key Lessons
1. Run the verifier on every phase, even UI phases — visual sign-off alone leaves gaps in documentation
2. Capture screenshots during the phase that builds the UI, not later
3. Single-function entry points (activate/deactivate) dramatically simplify integration — one call, zero config

### Cost Observations
- Model mix: orchestrator on opus, all subagents (researcher, planner, checker, executor, verifier, integration-checker) on sonnet
- Notable: 3 phases planned and executed in a single continuous session

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.1 | 8 | 24 | Initial GSD workflow established |
| v2.0 | 5 | 12 | Autonomy tiers, agent-first design |
| v2.1 | 3 | 10 | Wave parallelism, plan consolidation, integrated verification |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v1.1 | 302+ | Full protocol coverage |
| v2.0 | +autonomy tests | Per-skill idle tracking |
| v2.1 | +8 integration | bootstrap lifecycle tests |

### Top Lessons (Verified Across Milestones)

1. TDD produces smaller, cleaner modules — verified in Phase 0 (registry), Phase 10 (bootstrap.ts)
2. Wave parallelism works well for independent plans — verified in Phase 10 (Wave 1) and Phase 11 (all Wave 1)
3. Agent-first design test ("Does this require human intervention?") consistently improves feature quality
