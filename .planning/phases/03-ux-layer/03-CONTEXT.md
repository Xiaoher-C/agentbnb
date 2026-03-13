# Phase 3: UX Layer - Context

**Gathered:** 2026-03-14
**Status:** Deferred — user chose to refine existing phases first

<domain>
## Phase Boundary

Non-technical users can share agent capabilities via web dashboard, one-click sharing, and mobile monitoring. Visual pipeline builder explicitly skipped (target users are developers who use CLI).

</domain>

<decisions>
## Implementation Decisions (Partial)

### Dashboard
- React SPA with both public marketplace browser AND authenticated owner control panel
- Embedded in Fastify (production: static files from registry server; development: Vite proxy)
- Styling: TBD (discussion deferred)

### One-click sharing
- Auto-detect + confirm mode (not manual JSON upload)

### Visual pipeline builder
- SKIP — target users are developers, CLI is sufficient

### Mobile monitoring
- Responsive web + Web Push notifications (no native app)

### Claude's Discretion
- Styling framework choice
- Component library
- State management
- Authentication mechanism for owner panel

</decisions>

<specifics>
## Specific Ideas

User noted: "dashboard 現在不是 priority" — focus should be on refining auto-detect onboarding (`npx agentbnb init`) and P2P discovery first.

</specifics>

<deferred>
## Deferred Ideas

- Full Phase 3 execution deferred until existing phases are polished
- Dashboard styling decision pending
- Detailed one-click sharing UX flow pending

</deferred>

---

*Phase: 03-ux-layer*
*Context gathered: 2026-03-14 (partial — deferred)*
