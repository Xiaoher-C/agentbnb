---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Full Hub + Distribution
status: planning
stopped_at: Completed 13-02-PLAN.md — Docs page with CopyButton and 4 sections
last_updated: "2026-03-16T13:53:45.648Z"
last_activity: 2026-03-16 — Roadmap created (4 phases, 37 requirements, 100% coverage)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 5
  completed_plans: 5
  percent: 0
---

# AgentBnB — Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** Fill the market gap for agent-to-agent capability exchange — make AgentBnB launchable.
**Current focus:** v2.2 Full Hub + Distribution

## Current Position

Phase: Phase 12 — Foundation + Agent Directory (not started)
Plan: —
Status: Roadmap ready — begin planning Phase 12
Last activity: 2026-03-16 — Roadmap created (4 phases, 37 requirements, 100% coverage)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 46 (v1.1: 24, v2.0: 12, v2.1: 10)
- Average duration: unknown
- Total execution time: unknown

**By Phase (v2.2):**

| Phase | Plans | Status |
|-------|-------|--------|
| 12. Foundation + Agent Directory | 0/? | Not started |
| 13. Activity Feed + Docs Page | 0/? | Not started |
| 14. Credit UI + Modal + Polish | 0/? | Not started |
| 15. Distribution + Discovery | 0/? | Not started |
| Phase 12-foundation-agent-directory P01 | 4m | 2 tasks | 7 files |
| Phase 12-foundation-agent-directory P02 | 5 | 2 tasks | 3 files |
| Phase 12-foundation-agent-directory P03 | 3min | 2 tasks | 5 files |
| Phase 13-activity-feed-docs-page P01 | 4m | 2 tasks | 8 files |
| Phase 13-activity-feed-docs-page P02 | 3min | 2 tasks | 4 files |

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
- [v2.2 roadmap]: Use react-router ^7.13.1 createHashRouter — hash mode requires no Fastify fallback config change
- [v2.2 roadmap]: SPA catch-all required: server.get('/hub/*', ...) to prevent 404 on direct URL access
- [v2.2 roadmap]: Recharts custom tooltip required — inline backgroundColor: '#fff' overrides Tailwind; use content prop
- [v2.2 roadmap]: Activity feed uses single JOIN query (not N+1) — request_log LEFT JOIN capability_cards
- [v2.2 roadmap]: credits_earned is computed via GROUP BY aggregate SQL, never stored as a column
- [v2.2 roadmap]: iOS Safari scroll lock fix must go in CardModal.tsx — position-fixed + saved scroll position
- [v2.2 roadmap]: Docs page uses static TypeScript data in lib/docs-content.ts, not react-markdown fetch
- [v2.2 roadmap]: plugin.json version discipline — version in plugin.json only, not duplicated in marketplace.json
- [Phase 12]: react-router 7.13.1 hash mode (createHashRouter) — no Fastify fallback config change required
- [Phase 12]: AppOutletContext typed with satisfies keyword in Outlet context prop for type-safe child routes
- [Phase 12]: NavBar credit balance badge: font-mono emerald pill showing 'cr {balance}', fetched via /me in App layout shell
- [Phase 12-02]: SPA catch-all uses setNotFoundHandler not server.get('/hub/*') — @fastify/static registers HEAD+GET wildcard, competing GET causes Fastify 5 to throw immediately
- [Phase 12-02]: credits_earned computed via GROUP BY aggregate SQL on request_log, never stored as a column
- [Phase 12-02]: listCards() CapabilityCard[] typed but stores v2 cards at runtime — cast via (card as unknown as CapabilityCardV2) for skills?.length access
- [Phase Phase 12-03]: ProfilePage uses useOutletContext setSelectedCard to open CardModal — consistent with DiscoverPage pattern
- [Phase Phase 12-03]: timeAgo() kept inline in ProfilePage — single-use, plan specified inline implementation
- [Phase Phase 13]: Activity feed uses ISO string since param (not SincePeriod enum) to support arbitrary timestamp-based polling
- [Phase Phase 13]: auto_request rows excluded at SQL level; auto_share rows included — single WHERE clause filter
- [Phase Phase 13]: Event type derived client-side from action_type to avoid computed DB columns
- [Phase Phase 13-02]: Docs content is static TypeScript JSX in lib/docs-content.tsx — no react-markdown, no network
- [Phase Phase 13-02]: CopyButton reuses exact clipboard pattern from GetStartedCTA.tsx (useState + 1500ms timeout)
- [Phase Phase 13-02]: DocsPage uses sticky sidebar on desktop, horizontal-scroll tab strip on mobile

### Pending Todos

- Confirm exact GitHub repository path (Xiaoher-C/agentbnb vs chengwenchen/agentbnb) before Phase 15 plugin files
- Verify action_type filter values in request_log table before Phase 13 activity feed query

### Blockers/Concerns

- `docs/hub-screenshot.png` placeholder in README.md (cosmetic, from v2.1 — resolved in Phase 15)

## Session Continuity

Last session: 2026-03-16T13:49:23.625Z
Stopped at: Completed 13-02-PLAN.md — Docs page with CopyButton and 4 sections
Resume file: None

---
*Last updated: 2026-03-16 — v2.2 roadmap created*
