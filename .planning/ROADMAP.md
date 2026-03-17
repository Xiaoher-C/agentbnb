# AgentBnB Roadmap

## Milestones

- ✅ **v1.1 Upgrade** - Phases 0-3 (shipped 2026-03-15)
- ✅ **v2.0 Agent Autonomy** - Phases 4-8 (shipped 2026-03-15)
- ✅ **v2.1 Ship It** - Phases 9-11 (shipped 2026-03-16)
- ✅ **v2.2 Full Hub + Distribution** - Phases 12-15 (shipped 2026-03-16)
- 🚧 **v2.3 Launch Ready** - Phases 16-19 (in progress)

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

<details>
<summary>✅ v2.2 Full Hub + Distribution (Phases 12-15) - SHIPPED 2026-03-16</summary>

- [x] Phase 12: Foundation + Agent Directory (3/3 plans) — SPA routing, 5-tab nav, credit badge, CTA, agent ranking list and individual profile pages
- [x] Phase 13: Activity Feed + Docs Page (2/2 plans) — Public exchange feed with 10s polling, 4-section embedded documentation
- [x] Phase 14: Credit UI + Modal + Polish (4/4 plans) — Credit dashboard with earning chart, modal enhancements, design token migration, mobile responsive
- [x] Phase 15: Distribution + Discovery (2/2 plans) — Claude Code plugin, cross-tool SKILL.md, GitHub topics, README visual overhaul

</details>

### v2.3 Launch Ready

- [x] **Phase 16: SPA Routing Fix + Hub Enhancement** — Fix reply.sendFile 500 error, extract Magic UI components into Hub, add doodle creature mascot (completed 2026-03-17)
- [ ] **Phase 17: Below-Fold Sections** — Compatible With marquee, FAQ accordion, brief description below Discover card grid
- [ ] **Phase 18: README Visual Overhaul** — Badges, hero image, structured layout, real hub screenshot
- [ ] **Phase 19: Deployment + Go Public** — Fly.io registry, DNS config, Cloudflare Tunnel, GitHub public pre-flight

---

## Phase Details

### Phase 16: SPA Routing Fix + Hub Enhancement
**Goal**: Fix the /hub/* sub-route 500 error and extract useful Magic UI components into the Hub's component library
**Depends on**: Phase 15 (v2.2 complete)
**Requirements**: SPA-01, SPA-02, MAGICUI-01, MAGICUI-02, MAGICUI-03, MAGICUI-04, MAGICUI-05, MAGICUI-06, MASCOT-01
**Success Criteria** (what must be TRUE):
  1. Direct URL access to /hub/#/agents, /hub/#/activity, /hub/#/docs all return 200 (not 500)
  2. Six Magic UI components (NumberFlow, Marquee, FlickeringGrid, Accordion, LineChart, OrbitingCircles) exist in hub/src/components/ui/ and render without errors
  3. Doodle creature mascot (56px SVG) visible in NavBar next to "AgentBnB" title
  4. All existing tests pass after changes
**Plans:** 2/2 plans complete

Plans:
- [ ] 16-01-PLAN.md — SPA routing fix + shared foundation (deps, cn utility, color utils, Tailwind keyframes)
- [ ] 16-02-PLAN.md — Extract six Magic UI components (Marquee, NumberFlow, Accordion, FlickeringGrid, LineChart, OrbitingCircles)

### Phase 17: Below-Fold Sections
**Goal**: Add supporting content sections below the Discover card grid while maintaining minimalist aesthetic
**Depends on**: Phase 16 (Magic UI components available)
**Requirements**: FOLD-01, FOLD-02, FOLD-03, FOLD-04
**Success Criteria** (what must be TRUE):
  1. A "Compatible With" section with scrolling marquee of tool/framework logos appears below the Discover card grid
  2. A FAQ accordion section with common AgentBnB questions is visible below Compatible With
  3. A brief value proposition section explains the protocol
  4. All below-fold sections use the existing dark theme (#08080C bg, emerald accent) and feel native to the current Hub aesthetic
**Plans:** 0/? plans — not yet planned

### Phase 18: README Visual Overhaul
**Goal**: Make the GitHub README visually compelling and informative for first-time visitors
**Depends on**: Phase 16 (Hub working for screenshot)
**Requirements**: README-01, README-02, README-03, README-04
**Success Criteria** (what must be TRUE):
  1. README has OpenClaw-style badges (npm version, tests, license) at the top
  2. A hero image or banner is prominently displayed
  3. README has clear structured sections: What, Install, Quick Start, Architecture, Contributing
  4. docs/hub-screenshot.png is a real screenshot (not 0-byte placeholder)
**Plans:** 0/? plans — not yet planned

### Phase 19: Deployment + Go Public
**Goal**: AgentBnB registry is accessible at agentbnb.dev and the GitHub repository is public
**Depends on**: Phase 17, Phase 18 (Hub polished, README ready)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04
**Success Criteria** (what must be TRUE):
  1. Registry server runs on Fly.io and responds to API requests
  2. agentbnb.dev DNS resolves to the deployed services
  3. Cloudflare Tunnel connects Mac Mini gateway to the public internet
  4. GitHub repository is public with no leaked secrets, correct license, and clean .gitignore
**Plans:** 0/? plans — not yet planned

---

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 0-3 | v1.1 | 24/24 | Complete | 2026-03-15 |
| 4-8 | v2.0 | 12/12 | Complete | 2026-03-15 |
| 9-11 | v2.1 | 10/10 | Complete | 2026-03-16 |
| 12-15 | v2.2 | 11/11 | Complete | 2026-03-16 |
| 16. SPA Fix + Hub Enhancement | 2/2 | Complete    | 2026-03-17 | — |
| 17. Below-Fold Sections | v2.3 | 0/? | Not started | — |
| 18. README Visual Overhaul | v2.3 | 0/? | Not started | — |
| 19. Deployment + Go Public | v2.3 | 0/? | Not started | — |

**Total:** 20+ phases, 59+ plans, 4 milestones shipped, 1 in progress.

---
*Full milestone details archived in .planning/milestones/*
