---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Production-Ready Launch
status: executing
stopped_at: Completed 19-03-PLAN.md
last_updated: "2026-03-17T10:21:52.267Z"
last_activity: 2026-03-17 — Completed 20-01 (Conductor types, TaskDecomposer, Card registration)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 8
  completed_plans: 6
  percent: 10
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-17)

**Core value:** Fill the market gap for agent-to-agent capability exchange — launch AgentBnB publicly.
**Current focus:** v3.0 Conductor Core

## Current Position

Phase: Phase 20 — Conductor Core (Plan 1/? complete)
Plan: 20-01 complete
Status: Phase 20 in progress
Last activity: 2026-03-17 — Completed 20-01 (Conductor types, TaskDecomposer, Card registration)

Progress: [█---------] 10%

## Performance Metrics

**Velocity:**
- Total plans completed: 60 (v1.1: 24, v2.0: 12, v2.1: 10, v2.2: 11, v2.3: 2, v3.0: 1)
- Average duration: unknown
- Total execution time: unknown

**By Phase (v2.3):**

| Phase | Plans | Status |
|-------|-------|--------|
| 16. SPA Routing Fix + Hub Enhancement | 2/2 | Complete |
| 17. Below-Fold Sections | 1/1 | Complete |
| 18. README Visual Overhaul | 2/2 | Complete |
| 19. Deployment + Go Public | 0/? | Not started |

**Performance Metrics:**

| Phase | Duration | Tasks | Files |
|-------|----------|-------|-------|
| Phase 17 P01 | ~5min | 2 tasks | 7 files |
| Phase 18-01 | 3min | 2 tasks | 3 files |
| Phase 18-02 | ~10min | 2 tasks | 1 file |
| Phase 19-skillexecutor P01 | 3m14s | 2 tasks | 4 files |
| Phase 19-skillexecutor P02 | 3min | 1 tasks | 2 files |
| Phase 19-skillexecutor P04 | 195s | 1 tasks | 2 files |
| Phase 19-skillexecutor P05 | 4min | 1 tasks | 2 files |
| Phase 19-skillexecutor P03 | 4m17s | 2 tasks | 4 files |

## Accumulated Context

### Decisions

- [v2.1 init]: Hub UI priority is screenshot impact > operation speed > info density > mobile
- [v2.1 init]: Card expand behavior is modal overlay with backdrop blur, not in-place expand
- [v2.1 init]: Dark bg #08080C, accent emerald green #10B981, Inter + JetBrains Mono
- [v2.1 init]: ClaWHub skill uses single activate() function — bootstrap.ts entry point
- [v2.1 init]: SKILL.md must be agent-executable instructions, not human documentation
- [v2.2 init]: Hub navigation: 5 tabs — Discover, Agents, Activity, Docs, My Agent. Credit balance in nav bar.
- [v2.2 init]: Agent profiles: Ranked list + individual profile page with all skills + recent activity
- [v2.2 init]: Activity feed: Public exchange history (exchange_completed, capability_shared, agent_joined, milestone)
- [v2.2 init]: Credit visibility: `cr` symbol everywhere. Nav bar shows balance. Sign-up CTA offers 50 free credits
- [v2.2 init]: Docs: Getting Started + multi-tool install + Card Schema + API Reference + FAQ. Embedded in Hub
- [v2.2 init]: Distribution: One SKILL.md, multiple install paths. marketplace.json for Claude Code
- [v2.2 init]: Sign-up flow: No account creation. "Sign up" = run `agentbnb init` locally. Free 50 credits from initial credit grant
- [v2.3 init]: Hub IS the landing page — Discover page is homepage, no separate landing/Next.js app
- [v2.3 init]: Magic UI template is a COMPONENT SOURCE — extract useful components into hub/src/components/ui/, don't replace Hub with template
- [v2.3 init]: Below-fold sections added UNDER the existing Discover card grid: Compatible With marquee, FAQ accordion, brief description
- [v2.3 init]: Doodle creature mascot — 56px inline SVG in NavBar next to "AgentBnB" text, uses currentColor for dark theme
- [v2.3 init]: SPA routing fix — remove `decorateReply: false` from @fastify/static registration in src/registry/server.ts
- [v2.3 init]: Magic UI components to extract: NumberFlow, Marquee, FlickeringGrid, Accordion, LineChart (SVG), Orbiting Circles
- [v2.3 init]: Skip heavy Magic UI components: Particles (GPU), AnimatedBeam (framer-motion), InteractiveHoverButton, AnimatedList
- [v2.3 init]: Keep minimalist aesthetic — the homepage should show agents immediately, supporting info below fold
- [Phase 16]: Removed decorateReply: false from @fastify/static to enable reply.sendFile() in setNotFoundHandler
- [Phase 16]: color.ts retains CSS variable resolution (var()) support for future flexibility
- [Phase 16]: Used Format type from @number-flow/react for NumberFlowCell type safety
- [Phase 16]: FlickeringGrid simplified — removed text-mask canvas logic for background use case
- [Phase 16]: Hub UI primitives live in hub/src/components/ui/ with relative imports, dark-only
- [Phase 17]: Radix accordion content is lazily mounted — tests click triggers to reveal answer text rather than checking hidden DOM
- [Phase 18-01]: Banner SVG uses translate(820,60) scale(0.18) to position doodle creature to right of title
- [Phase 18-01]: Creature strokes changed from #2C2C2A to rgba(255,255,255,0.7) for dark background visibility
- [Phase 18-01]: Screenshot script handles graceful fallback when backend API unavailable
- [Phase 18-02]: README structure: badges → hero banner → tagline → What Is This → Agent Hub (screenshot) → Install → Quick Start → Key Features → Architecture → Development → Contributing → License
- [Phase 18-02]: Static shields.io tests-passing badge used (not CI-linked) — CI setup deferred to Phase 19
- [Phase 18-02]: Verbose technical sections (JSON schema, Autonomy Tiers table, Commands Reference) condensed to bullet points — detail lives in CLAUDE.md
- [Phase 19-01]: js-yaml used for YAML parsing; expandEnvVarsDeep walks object/array leaves before Zod validation; SkillExecutor.execute() always returns ExecutionResult with latency_ms even on error; dispatcher Map injected by callers so modes are registered by 19-02..05
- [Phase 20-01]: Deterministic UUID for Conductor card (singleton agent, fixed ID 00000000-0000-4000-8000-000000000001)
- [Phase 20-01]: Template steps use depends_on_indices resolved to UUIDs at decomposition time for DAG correctness
- [Phase 20-01]: Check-then-insert/update for idempotent card registration (works with FTS triggers)
- [Phase 19-02]: output_mapping empty returns full response body; response. prefix stripped in output paths; pre-existing TS errors in task-decomposer/command-executor deferred
- [Phase 19-04]: Base URL configurable via OPENCLAW_BASE_URL env var — supports non-standard OpenClaw ports without code changes
- [Phase 19-04]: vi.mock('node:child_process') required at module level for ESM test compatibility — vi.spyOn alone fails for built-in ESM exports
- [Phase 19-04]: Telegram channel is MVP fire-and-forget — TELEGRAM_CHAT_ID from env var, not skill config, to avoid leaking chat IDs
- [Phase 19-05]: Custom execAsync wrapper used instead of promisify(exec) to avoid TypeScript Buffer vs string type ambiguity in child_process
- [Phase 19-05]: CommandExecutor security check uses base command before interpolation to prevent allowlist bypass via param injection
- [Phase 19-03]: interpolateObject deep-walks arrays too for list-style input_mappings
- [Phase 19-03]: PipelineExecutor accepts SkillExecutor by reference for clean dependency inversion
- [Phase 19-03]: step undefined guard added for TypeScript strict-mode loop safety (TS18048)

### Pending Todos

- Confirm exact GitHub repository path (Xiaoher-C/agentbnb vs chengwenchen/agentbnb) before deployment
- Replace docs/hub-screenshot.png placeholder with real screenshot before public launch

### Blockers/Concerns

- `docs/hub-screenshot.png` placeholder in README.md (cosmetic, needs real screenshot before go-public)
- `landing/` directory is leftover from aborted Phase 17 — should be deleted before v2.3 execution

## Session Continuity

Last session: 2026-03-17T10:21:52.265Z
Stopped at: Completed 19-03-PLAN.md
Resume file: None

---
*Last updated: 2026-03-17 — Phase 20-01 complete (Conductor types, TaskDecomposer, Card)*
