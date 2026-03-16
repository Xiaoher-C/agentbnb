# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- ✅ **v2.1 Ship It** - Phases 9-11 (shipped 2026-03-16)
- 🚧 **v2.2 Full Hub + Distribution** - Phases 12-15 (in progress)

## Phases

<details>
<summary>✅ v1.1 Upgrade (Phases 0-3) - SHIPPED 2026-03-15</summary>

- [x] Phase 0: Dogfood (5/5 plans) — Capability Card schema, SQLite registry, credit ledger, gateway, CLI, OpenClaw integration
- [x] Phase 1: CLI MVP (4/4 plans) — npm package, mDNS discovery, peer management, documentation
- [x] Phase 2: Cold Start (3/3 plans) — Reputation system, public registry, marketplace API
- [x] Phase 2.1: Smart Onboarding (2/2 plans) — Auto-detect API keys, draft card generation
- [x] Phase 2.2: Agent Hub (3/3 plans) — React SPA at /hub, card grid, search/filter
- [x] Phase 2.25: Schema v1.1 (1/1 plan) — _internal field, free_tier, Hub badges
- [x] Phase 2.3: Remote Registry (2/2 plans) — Cross-machine discovery, config
- [x] Phase 3: UX Layer (4/4 plans) — Owner dashboard, auth, share page, request history

</details>

<details>
<summary>✅ v2.0 Agent Autonomy (Phases 4-8) - SHIPPED 2026-03-15</summary>

- [x] Phase 4: Agent Runtime + Multi-Skill Foundation (3/3 plans)
- [x] Phase 5: Autonomy Tiers + Credit Budgeting (2/2 plans)
- [x] Phase 6: Idle Rate Monitoring + Auto-Share (2/2 plans)
- [x] Phase 7: Auto-Request (2/2 plans)
- [x] Phase 8: OpenClaw Deep Integration (3/3 plans)

</details>

<details>
<summary>✅ v2.1 Ship It (Phases 9-11) - SHIPPED 2026-03-16</summary>

- [x] Phase 9: Hub UI Redesign (4/4 plans) — Premium dark SaaS, ambient glow, modal overlays, count-up animations
- [x] Phase 10: ClaWHub Installable Skill (3/3 plans) — bootstrap.ts activate()/deactivate(), install.sh, SKILL.md, HEARTBEAT.rules.md
- [x] Phase 11: Repo Housekeeping (3/3 plans) — CLAUDE.md, README.md, AGENT-NATIVE-PROTOCOL.md

</details>

### v2.2 Full Hub + Distribution

- [x] **Phase 12: Foundation + Agent Directory** - SPA routing, 5-tab nav, credit badge, CTA, agent ranking list and individual profile pages (completed 2026-03-16)
- [ ] **Phase 13: Activity Feed + Docs Page** - Public exchange feed with 10s polling, 4-section embedded documentation
- [ ] **Phase 14: Credit UI + Modal + Polish** - Credit dashboard with earning chart, modal enhancements, design token migration, mobile responsive
- [ ] **Phase 15: Distribution + Discovery** - Claude Code plugin, cross-tool SKILL.md, GitHub topics, README visual overhaul

---

## Phase Details

### Phase 12: Foundation + Agent Directory
**Goal**: Users can navigate all 7 Hub pages via URL and discover ranked agents with individual profiles
**Depends on**: Phase 11 (v2.1 Hub baseline)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05
**Success Criteria** (what must be TRUE):
  1. Clicking any nav tab changes the URL hash and renders a distinct page without a full reload; browser back/forward buttons work
  2. The nav bar shows 5 tabs (Discover, Agents, Activity, Docs, My Agent) and a "My Agent" dropdown with Dashboard/Share/Settings
  3. An authenticated user sees their credit balance as an accent-green monospace badge in the nav bar; an unauthenticated visitor sees a "Get Started — 50 free credits" CTA button
  4. The Agents page lists all agents sorted by reputation, each row showing identicon, name, success rate, skill count, and credits earned
  5. Clicking an agent row navigates to their profile URL (/hub/#/agents/:owner) showing their skills grid and recent activity
**Plans:** 3/3 plans complete
Plans:
- [x] 12-01-PLAN.md — SPA routing foundation + NavBar with 5 tabs, credit badge, CTA, My Agent dropdown
- [x] 12-02-PLAN.md — Backend agent API endpoints + SPA catch-all + Vite proxy
- [x] 12-03-PLAN.md — Frontend agent directory (AgentList + ProfilePage + useAgents hook)

### Phase 13: Activity Feed + Docs Page
**Goal**: Visitors can see real exchange activity happening on the network and read embedded documentation without leaving the Hub
**Depends on**: Phase 12
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. The Activity page shows a chronological list of public exchange events (exchange_completed, capability_shared, agent_joined, milestone) updated every 10 seconds without resetting the scroll position
  2. New activity events prepend to the top of the feed; the user does not lose their place when the feed refreshes
  3. The Docs page shows Getting Started, multi-tool install commands with copy buttons, Card Schema reference, and API endpoint reference — all without any network request
  4. Install commands on the Docs page are copyable and cover Claude Code, OpenClaw, Antigravity, and CLI
**Plans:** 1/2 plans executed
Plans:
- [ ] 13-01-PLAN.md — Activity feed backend endpoint + frontend hook and components with 10s polling
- [ ] 13-02-PLAN.md — Docs page with static content, CopyButton, and sidebar navigation

### Phase 14: Credit UI + Modal + Polish
**Goal**: Users can see credit balances, earnings history, and transaction details everywhere in the Hub; all pages work on mobile
**Depends on**: Phase 12
**Requirements**: CREDIT-01, CREDIT-02, CREDIT-03, CREDIT-04, CREDIT-05, CREDIT-06, MODAL-01, MODAL-02, MODAL-03, POLISH-01, POLISH-02, POLISH-03, POLISH-04, POLISH-05
**Success Criteria** (what must be TRUE):
  1. Every credit amount in the Hub displays a `cr` prefix in accent green monospace; no raw numbers appear without the currency symbol
  2. The My Agent dashboard shows credit balance with reserve/available breakdown, a 30-day earning AreaChart, and a transaction history list
  3. The Skill Detail Modal shows a "Request this skill" button with a copyable CLI command, a real-time availability indicator, and a link to the skill owner's agent profile
  4. On a mobile viewport (< 768px), the nav collapses to a hamburger menu, card grids stack to single column, and the Skill Detail Modal becomes a full-screen bottom sheet with 44px tap targets
  5. All async data fetches show loading skeletons while data is pending; the OwnerDashboard uses hub-* design tokens with no slate-* token leakage
**Plans**: TBD

### Phase 15: Distribution + Discovery
**Goal**: AgentBnB can be installed from the Claude Code plugin marketplace and is discoverable via GitHub and cross-tool package indexes
**Depends on**: Phase 14
**Requirements**: DIST-01, DIST-02, DIST-03, DIST-04, DIST-05
**Success Criteria** (what must be TRUE):
  1. The Claude Code plugin marketplace file exists at .claude-plugin/marketplace.json with correct schema and a versioned plugin entry pointing to the plugins/agentbnb-network/ directory
  2. SKILL.md has complete YAML frontmatter including name, version, description, author, and compatible-tools tags for cross-tool auto-indexing
  3. The GitHub repository has the topics ai-agent-skill, claude-code, and agent-skills set
  4. The README shows a hub screenshot, per-tool install badges, and one-line install commands for Claude Code, OpenClaw, Antigravity, and CLI
**Plans**: TBD

---

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 0-3 | v1.1 | 24/24 | Complete | 2026-03-15 |
| 4-8 | v2.0 | 12/12 | Complete | 2026-03-15 |
| 9-11 | v2.1 | 10/10 | Complete | 2026-03-16 |
| 12. Foundation + Agent Directory | 3/3 | Complete    | 2026-03-16 | - |
| 13. Activity Feed + Docs Page | 1/2 | In Progress|  | - |
| 14. Credit UI + Modal + Polish | v2.2 | 0/? | Not started | - |
| 15. Distribution + Discovery | v2.2 | 0/? | Not started | - |

**Total:** 20 phases, 51+ plans, 3 milestones shipped, 1 in progress.

---
*Full milestone details archived in .planning/milestones/*
