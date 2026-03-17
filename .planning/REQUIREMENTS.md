# Requirements: AgentBnB v2.3

**Defined:** 2026-03-17
**Core Value:** Launch AgentBnB publicly — fix SPA routing, enhance Hub with extracted Magic UI components, overhaul README, deploy and go public.

## v2.2 Requirements (COMPLETED)

<details>
<summary>All 37 v2.2 requirements — shipped 2026-03-16</summary>

### Navigation & Routing

- [x] **NAV-01**: Hub uses hash-based SPA routing for all 7 pages with browser back/forward support
- [x] **NAV-02**: Nav bar shows 5 tabs: Discover, Agents, Activity, Docs, My Agent
- [x] **NAV-03**: Nav bar displays credit balance badge (monospace, accent green) for authenticated users
- [x] **NAV-04**: Nav bar shows "Get Started — 50 free credits" CTA button for unauthenticated users
- [x] **NAV-05**: My Agent is a dropdown menu: Dashboard / Share / Settings

### Agent Directory

- [x] **AGENT-01**: Agent ranking page at /hub/#/agents lists all agents sorted by reputation
- [x] **AGENT-02**: Each agent row shows identicon, name, success rate, skill count, credits earned
- [x] **AGENT-03**: Individual agent profile at /hub/#/agents/:owner shows skills grid + recent activity
- [x] **AGENT-04**: Backend GET /api/agents returns aggregated agent list from capability_cards
- [x] **AGENT-05**: Backend GET /api/agents/:owner returns agent profile with skills and activity

### Activity Feed

- [x] **FEED-01**: Activity feed page at /hub/#/activity shows public exchange history
- [x] **FEED-02**: Feed displays 4 event types: exchange_completed, capability_shared, agent_joined, milestone
- [x] **FEED-03**: Feed polls backend every 10 seconds with prepend-only updates
- [x] **FEED-04**: Backend GET /api/activity returns paginated activity from request_log JOIN capability_cards

### Documentation

- [x] **DOCS-01**: Docs page at /hub/#/docs shows Getting Started guide
- [x] **DOCS-02**: Docs page shows multi-tool install commands (Claude Code, OpenClaw, Antigravity, CLI) with copy buttons
- [x] **DOCS-03**: Docs page shows Capability Card schema reference
- [x] **DOCS-04**: Docs page shows API endpoint reference

### Credit UI

- [x] **CREDIT-01**: `cr` currency symbol used consistently across all credit displays
- [x] **CREDIT-02**: Card display shows credits in accent color with monospace `cr` prefix
- [x] **CREDIT-03**: My Agent dashboard shows credit balance with reserve/available breakdown
- [x] **CREDIT-04**: My Agent dashboard shows 30-day earning chart (recharts AreaChart)
- [x] **CREDIT-05**: My Agent dashboard shows recent transaction history
- [x] **CREDIT-06**: Backend GET /me/transactions returns credit transaction history

### Modal Enhancement

- [x] **MODAL-01**: Skill Detail Modal shows "Request this skill" button with CLI command copy
- [x] **MODAL-02**: Skill Detail Modal shows real-time availability indicator (online + idle status)
- [x] **MODAL-03**: Skill Detail Modal links skill owner to their agent profile page

### Distribution

- [x] **DIST-01**: Claude Code .claude-plugin/marketplace.json created with correct schema
- [x] **DIST-02**: Plugin structure at plugins/agentbnb-network/ with plugin.json and SKILL.md
- [x] **DIST-03**: SKILL.md has complete YAML frontmatter for auto-indexing (name, version, description, author, tags)
- [x] **DIST-04**: GitHub repository topics set: ai-agent-skill, claude-code, agent-skills
- [x] **DIST-05**: README updated with hub screenshot, badges, and one-line install commands per tool

### Polish

- [x] **POLISH-01**: All pages responsive — cards stack on mobile, nav collapses to hamburger
- [x] **POLISH-02**: Modal becomes full-screen sheet on mobile with touch-friendly tap targets (44px min)
- [x] **POLISH-03**: OwnerDashboard migrated from slate-* to hub-* design tokens
- [x] **POLISH-04**: Loading skeletons for all async data fetches
- [x] **POLISH-05**: iOS Safari scroll lock fix for all modals

</details>

## v2.3 Requirements

Requirements for v2.3 Launch Ready. Each maps to roadmap phases 16-19.

### SPA Routing Fix

- [x] **SPA-01**: Remove `decorateReply: false` from @fastify/static registration so `reply.sendFile()` works on /hub/* sub-routes
- [x] **SPA-02**: Direct URL access to any /hub/* sub-route (e.g., /hub/#/agents) returns 200, not 500

### Hub Enhancement — Magic UI Components

- [x] **MAGICUI-01**: Extract and integrate NumberFlow component into hub/src/components/ui/ for animated number transitions
- [x] **MAGICUI-02**: Extract and integrate Marquee component for "Compatible With" scrolling logo strip
- [x] **MAGICUI-03**: Extract and integrate FlickeringGrid component as subtle background texture
- [x] **MAGICUI-04**: Extract and integrate Accordion component for FAQ section
- [x] **MAGICUI-05**: Extract and integrate LineChart (SVG-based) component for lightweight chart alternative
- [x] **MAGICUI-06**: Extract and integrate Orbiting Circles component for visual decoration

### Hub Below-Fold Sections

- [x] **FOLD-01**: "Compatible With" section below the Discover card grid using Marquee component — shows tool/framework logos
- [x] **FOLD-02**: FAQ accordion section with common questions about AgentBnB
- [x] **FOLD-03**: Brief description / value proposition section explaining the protocol
- [x] **FOLD-04**: Below-fold sections maintain the existing minimalist dark aesthetic

### Mascot

- [x] **MASCOT-01**: Doodle creature SVG (56px) displayed inline in NavBar next to "AgentBnB" title (DONE — committed with v2.3 planning)

### README Visual Overhaul

- [ ] **README-01**: OpenClaw-style badges at top of README (npm version, tests passing, license)
- [x] **README-02**: Hero image or banner at top of README
- [ ] **README-03**: Structured layout with clear sections (What, Install, Quick Start, Architecture, Contributing)
- [x] **README-04**: Real hub screenshot replaces the 0-byte placeholder at docs/hub-screenshot.png

### Deployment

- [ ] **DEPLOY-01**: Fly.io deployment configuration for remote registry server
- [ ] **DEPLOY-02**: DNS configuration for agentbnb.dev domain
- [ ] **DEPLOY-03**: Cloudflare Tunnel setup for Mac Mini gateway
- [ ] **DEPLOY-04**: GitHub repo set to public with pre-flight checklist (no secrets, license, .gitignore)

### Human-Action Items (tracked, not GSD-executed)

- [ ] **HUMAN-01**: Show HN post (Tuesday/Wednesday Pacific AM)
- [ ] **HUMAN-02**: Reddit + X series posts
- [ ] **HUMAN-03**: Taiwan TIPO trademark registration

## Out of Scope

| Feature | Reason |
|---------|--------|
| Separate landing page app (landing/ directory) | Hub IS the landing page — Discover page is homepage |
| Replacing Hub with Magic UI template | Extract components only, don't pour content into template |
| Heavy Magic UI components (Particles, AnimatedBeam, InteractiveHoverButton, AnimatedList) | GPU-heavy or framer-motion dependent — too heavy for minimalist aesthetic |
| Real money / payment integration | Credits only — core design decision |
| Multi-language SDKs | TypeScript only for v2.3 |
| Mobile native app | Web Hub is sufficient |
| WebSocket activity feed | Polling is sufficient at current scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SPA-01 | Phase 16 | Planned |
| SPA-02 | Phase 16 | Planned |
| MAGICUI-01 | Phase 16 | Planned |
| MAGICUI-02 | Phase 16 | Planned |
| MAGICUI-03 | Phase 16 | Planned |
| MAGICUI-04 | Phase 16 | Planned |
| MAGICUI-05 | Phase 16 | Planned |
| MAGICUI-06 | Phase 16 | Planned |
| FOLD-01 | Phase 17 | Planned |
| FOLD-02 | Phase 17 | Planned |
| FOLD-03 | Phase 17 | Planned |
| FOLD-04 | Phase 17 | Planned |
| MASCOT-01 | Phase 16 | Complete |
| README-01 | Phase 18 | Planned |
| README-02 | Phase 18 | Planned |
| README-03 | Phase 18 | Planned |
| README-04 | Phase 18 | Planned |
| DEPLOY-01 | Phase 19 | Planned |
| DEPLOY-02 | Phase 19 | Planned |
| DEPLOY-03 | Phase 19 | Planned |
| DEPLOY-04 | Phase 19 | Planned |
| HUMAN-01 | — | Human action |
| HUMAN-02 | — | Human action |
| HUMAN-03 | — | Human action |

**Coverage:**
- v2.3 requirements: 24 total (21 GSD-executable + 3 human-action)
- Mapped to phases: 21
- Unmapped: 0 (3 human-action items tracked separately) ✓

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 — v2.3 Launch Ready milestone*
