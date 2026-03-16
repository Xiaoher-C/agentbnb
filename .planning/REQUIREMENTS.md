# Requirements: AgentBnB v2.2

**Defined:** 2026-03-16
**Core Value:** Fill the market gap for agent-to-agent capability exchange — complete the Hub and distribute the skill

## v2.2 Requirements

Requirements for v2.2 Full Hub + Distribution. Each maps to roadmap phases.

### Navigation & Routing

- [ ] **NAV-01**: Hub uses hash-based SPA routing for all 7 pages with browser back/forward support
- [ ] **NAV-02**: Nav bar shows 5 tabs: Discover, Agents, Activity, Docs, My Agent
- [ ] **NAV-03**: Nav bar displays credit balance badge (monospace, accent green) for authenticated users
- [ ] **NAV-04**: Nav bar shows "Get Started — 50 free credits" CTA button for unauthenticated users
- [ ] **NAV-05**: My Agent is a dropdown menu: Dashboard / Share / Settings

### Agent Directory

- [ ] **AGENT-01**: Agent ranking page at /hub/#/agents lists all agents sorted by reputation
- [ ] **AGENT-02**: Each agent row shows identicon, name, success rate, skill count, credits earned
- [ ] **AGENT-03**: Individual agent profile at /hub/#/agents/:owner shows skills grid + recent activity
- [ ] **AGENT-04**: Backend GET /api/agents returns aggregated agent list from capability_cards
- [ ] **AGENT-05**: Backend GET /api/agents/:owner returns agent profile with skills and activity

### Activity Feed

- [ ] **FEED-01**: Activity feed page at /hub/#/activity shows public exchange history
- [ ] **FEED-02**: Feed displays 4 event types: exchange_completed, capability_shared, agent_joined, milestone
- [ ] **FEED-03**: Feed polls backend every 10 seconds with prepend-only updates
- [ ] **FEED-04**: Backend GET /api/activity returns paginated activity from request_log JOIN capability_cards

### Documentation

- [ ] **DOCS-01**: Docs page at /hub/#/docs shows Getting Started guide
- [ ] **DOCS-02**: Docs page shows multi-tool install commands (Claude Code, OpenClaw, Antigravity, CLI) with copy buttons
- [ ] **DOCS-03**: Docs page shows Capability Card schema reference
- [ ] **DOCS-04**: Docs page shows API endpoint reference

### Credit UI

- [ ] **CREDIT-01**: `cr` currency symbol used consistently across all credit displays
- [ ] **CREDIT-02**: Card display shows credits in accent color with monospace `cr` prefix
- [ ] **CREDIT-03**: My Agent dashboard shows credit balance with reserve/available breakdown
- [ ] **CREDIT-04**: My Agent dashboard shows 30-day earning chart (recharts AreaChart)
- [ ] **CREDIT-05**: My Agent dashboard shows recent transaction history
- [ ] **CREDIT-06**: Backend GET /me/transactions returns credit transaction history

### Modal Enhancement

- [ ] **MODAL-01**: Skill Detail Modal shows "Request this skill" button with CLI command copy
- [ ] **MODAL-02**: Skill Detail Modal shows real-time availability indicator (online + idle status)
- [ ] **MODAL-03**: Skill Detail Modal links skill owner to their agent profile page

### Distribution

- [ ] **DIST-01**: Claude Code .claude-plugin/marketplace.json created with correct schema
- [ ] **DIST-02**: Plugin structure at plugins/agentbnb-network/ with plugin.json and SKILL.md
- [ ] **DIST-03**: SKILL.md has complete YAML frontmatter for auto-indexing (name, version, description, author, tags)
- [ ] **DIST-04**: GitHub repository topics set: ai-agent-skill, claude-code, agent-skills
- [ ] **DIST-05**: README updated with hub screenshot, badges, and one-line install commands per tool

### Polish

- [ ] **POLISH-01**: All pages responsive — cards stack on mobile, nav collapses to hamburger
- [ ] **POLISH-02**: Modal becomes full-screen sheet on mobile with touch-friendly tap targets (44px min)
- [ ] **POLISH-03**: OwnerDashboard migrated from slate-* to hub-* design tokens
- [ ] **POLISH-04**: Loading skeletons for all async data fetches
- [ ] **POLISH-05**: iOS Safari scroll lock fix for all modals

## v2.3 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Real-Time

- **RT-01**: SSE-based real-time activity feed (upgrade from polling)
- **RT-02**: WebSocket credit balance live updates

### Discovery

- **DISC-01**: Related skills suggestions in Skill Detail Modal (semantic similarity)
- **DISC-02**: Searchable documentation with full-text search

### Social

- **SOCL-01**: Agent follow/subscribe notifications
- **SOCL-02**: Per-skill public install/usage counts

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebSocket activity feed | Polling is sufficient at current scale; SSE in v2.3 if needed |
| Full MDX docs system | Static TS data is simpler and sufficient for 4 doc sections |
| Real money payments | Credits only — core design decision |
| Social graph (follow/like) | Not an agent-native feature; deferred |
| Cloud-hosted registry | Local-first protocol — core constraint |
| Tailwind CSS v4 migration | Breaking changes with @theme directive; no benefit at current size |
| framer-motion animations | Conditional add; Tailwind transitions sufficient for MVP |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NAV-01 | Phase 12 | Pending |
| NAV-02 | Phase 12 | Pending |
| NAV-03 | Phase 12 | Pending |
| NAV-04 | Phase 12 | Pending |
| NAV-05 | Phase 12 | Pending |
| AGENT-01 | Phase 12 | Pending |
| AGENT-02 | Phase 12 | Pending |
| AGENT-03 | Phase 12 | Pending |
| AGENT-04 | Phase 12 | Pending |
| AGENT-05 | Phase 12 | Pending |
| FEED-01 | Phase 13 | Pending |
| FEED-02 | Phase 13 | Pending |
| FEED-03 | Phase 13 | Pending |
| FEED-04 | Phase 13 | Pending |
| DOCS-01 | Phase 13 | Pending |
| DOCS-02 | Phase 13 | Pending |
| DOCS-03 | Phase 13 | Pending |
| DOCS-04 | Phase 13 | Pending |
| CREDIT-01 | Phase 14 | Pending |
| CREDIT-02 | Phase 14 | Pending |
| CREDIT-03 | Phase 14 | Pending |
| CREDIT-04 | Phase 14 | Pending |
| CREDIT-05 | Phase 14 | Pending |
| CREDIT-06 | Phase 14 | Pending |
| MODAL-01 | Phase 14 | Pending |
| MODAL-02 | Phase 14 | Pending |
| MODAL-03 | Phase 14 | Pending |
| POLISH-01 | Phase 14 | Pending |
| POLISH-02 | Phase 14 | Pending |
| POLISH-03 | Phase 14 | Pending |
| POLISH-04 | Phase 14 | Pending |
| POLISH-05 | Phase 14 | Pending |
| DIST-01 | Phase 15 | Pending |
| DIST-02 | Phase 15 | Pending |
| DIST-03 | Phase 15 | Pending |
| DIST-04 | Phase 15 | Pending |
| DIST-05 | Phase 15 | Pending |

**Coverage:**
- v2.2 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 after roadmap creation — traceability complete*
