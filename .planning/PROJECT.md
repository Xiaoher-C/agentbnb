# AgentBnB

## What This Is

A P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Your agent has idle APIs — it wants to trade them.

## Core Value

No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover and use another agent's skills, creating a marketplace where agent capabilities become composable building blocks.

## Current Milestone: v2.3 Launch Ready

**Goal:** Enhance the Hub with Magic UI components, fix SPA routing, overhaul README, deploy to production, and go public.

**Target features:**
- SPA routing fix (reply.sendFile 500 error on Hub sub-routes)
- Extract Magic UI components into Hub (NumberFlow, Marquee, FlickeringGrid, Accordion, LineChart, Orbiting Circles)
- Hub landing enhancements: below-fold sections (Compatible With marquee, FAQ accordion, brief description)
- Doodle creature mascot in NavBar (already added)
- README visual overhaul: OpenClaw-style badges, hero image, structured layout
- Deployment: Fly.io for registry, DNS config, Cloudflare Tunnel
- GitHub repo → public with pre-flight checklist

**Approach:** Hub IS the landing page. Discover page is the homepage. Magic UI template is a component SOURCE — extract useful components into hub/src/components/ui/, don't replace the Hub with a template.

**Human-action items (tracked, no GSD plans):**
- Show HN post (Tue/Wed Pacific AM)
- Reddit + X series posts
- Taiwan TIPO trademark registration

**Previously shipped:**
- **v1.1 Upgrade** — 8 phases, 24 plans, 302+ tests. Core protocol, CLI, Hub, registry, onboarding.
- **v2.0 Agent Autonomy** — 5 phases, 12 plans. Multi-skill cards, autonomy tiers, auto-share, auto-request, OpenClaw integration.
- **v2.1 Ship It** — 3 phases, 10 plans. Premium Hub UI, ClaWHub skill (activate/deactivate), repo docs.
- **v2.2 Full Hub + Distribution** — 4 phases, 11 plans. Agent profiles, activity feed, docs page, credit UI, modal polish, marketplace.json, SKILL.md distribution.

**Design bible:** `AGENT-NATIVE-PROTOCOL.md` in project root

## Requirements

### Validated

- ✓ Capability Card schema with three-level model (Atomic, Pipeline, Environment) — v1.1
- ✓ SQLite-backed local registry with FTS5 search and filtering — v1.1
- ✓ CLI for publishing, discovering, and requesting capabilities — v1.1
- ✓ HTTP gateway for agent-to-agent communication (JSON-RPC) — v1.1
- ✓ Credit ledger with escrow and settlement — v1.1
- ✓ OpenClaw SOUL.md integration for dogfooding — v1.1
- ✓ npm package distribution — v1.1
- ✓ mDNS peer discovery + peer management — v1.1
- ✓ Reputation system (EWA success_rate + avg_latency_ms) — v1.1
- ✓ Public registry server with marketplace API — v1.1
- ✓ Smart onboarding (auto-detect API keys, draft card generation) — v1.1
- ✓ Agent Hub (React SPA, card grid, search/filter) — v1.1
- ✓ Schema v1.1 (_internal, free_tier, powered_by) — v1.1
- ✓ Remote registry discovery (--registry flag) — v1.1
- ✓ Owner dashboard, auth, share page, request history — v1.1
- ✓ Idle rate detection and auto-share — v2.0
- ✓ Auto-request with peer selection — v2.0
- ✓ Autonomy tiers (configurable thresholds) — v2.0
- ✓ Multi-skill Capability Cards — v2.0
- ✓ Credit budgeting (reserve, surplus, limits) — v2.0
- ✓ OpenClaw deep integration (skill, HEARTBEAT.md, message bus) — v2.0
- ✓ Premium dark Hub UI with ambient glow, modal overlays, count-up animations — v2.1
- ✓ ClaWHub bootstrap.ts activate()/deactivate() single entry point — v2.1
- ✓ install.sh zero-intervention agent onboarding — v2.1
- ✓ SKILL.md agent-executable instructions — v2.1
- ✓ HEARTBEAT.rules.md standalone autonomy template — v2.1
- ✓ CLAUDE.md, README.md, AGENT-NATIVE-PROTOCOL.md launch-ready — v2.1
- ✓ Agent Profiles page with ranking and individual profile views — v2.2
- ✓ Activity Feed showing real-time capability exchanges — v2.2
- ✓ In-Hub documentation page — v2.2
- ✓ Credit system UI (nav display, CTA, dashboard) — v2.2
- ✓ Skill Detail Modal enhancement — v2.2
- ✓ Claude Code plugin marketplace (marketplace.json) — v2.2
- ✓ Cross-tool SKILL.md compatibility — v2.2
- ✓ Auto-index preparation (GitHub topics, frontmatter) — v2.2
- ✓ Design system polish pass — v2.2
- ✓ Mobile responsive layout — v2.2

### Active

- [ ] SPA routing fix (Hub sub-routes return 500) — v2.3
- [ ] Extract Magic UI components into Hub (NumberFlow, Marquee, FlickeringGrid, Accordion, LineChart, Orbiting Circles) — v2.3
- [ ] Hub below-fold sections (Compatible With, FAQ, description) — v2.3
- [ ] README visual overhaul (badges, hero, structured layout) — v2.3
- [ ] Fly.io deployment for remote registry — v2.3
- [ ] DNS configuration — v2.3
- [ ] Cloudflare Tunnel for Mac Mini gateway — v2.3
- [ ] GitHub repo → public (pre-flight checklist) — v2.3

### Out of Scope

- Separate landing page app (landing/ directory) — Hub IS the landing page
- Replacing Hub with a template — extract components only
- Real money / payment integration — credits only
- Multi-language SDKs — TypeScript only
- Mobile native app — web Hub is sufficient
- Agent training / fine-tuning — capability exchange only

## Context

- **Market gap:** No standard protocol for agent-to-agent capability exchange exists. A2A (Google) focuses on task delegation, not capability sharing with economic incentives.
- **Dogfood with OpenClaw:** Cheng Wen's OpenClaw agents (creative director, engineering agent) are the first users.
- **Agent-native philosophy:** The user of AgentBnB is the agent, not the human. Features designed for agent consumption first, human consumption second. See AGENT-NATIVE-PROTOCOL.md.
- **Open source:** MIT licensed, intended for community adoption. Lock-in from network effects, not code.
- **npm analogy:** OpenClaw : AgentBnB :: Node.js : npm — the de facto capability sharing standard.
- **Codebase:** ~3,800 LOC TypeScript (hub + skills), 302+ tests, premium dark SaaS Hub UI.

## Constraints

- **Tech stack**: TypeScript (strict mode), Node.js 20+, pnpm
- **Database**: SQLite via better-sqlite3 (no external DB dependencies)
- **Protocol**: JSON-RPC over HTTP for agent communication
- **Testing**: Vitest for all test coverage
- **Open source**: MIT license, public repo
- **Design test**: "Does this require human intervention? If yes, redesign so the agent can do it."

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Three-level Capability Card model | Covers atomic skills, multi-step pipelines, and full environments | ✓ Good |
| SQLite for local storage | Zero-config, embeddable, good enough for dogfood | ✓ Good |
| JSON-RPC over HTTP | Standard, language-agnostic, easy to debug | ✓ Good |
| Credit-based exchange | Creates economic incentive without real money | ✓ Good |
| EWA reputation (alpha=0.1) | Smooth outlier handling, bootstraps from first observation | ✓ Good |
| Scoped Fastify plugins | Auth isolation without leaking to public routes | ✓ Good |
| Agent-first design | Features for agent consumption first, human second | ✓ Good |
| Premium dark UI (#08080C + #10B981) | Screenshot-worthy > info density > mobile | ✓ Good |
| Modal over in-place expand | Backdrop blur + centered modal for card details | ✓ Good |
| Single activate() entry point | One function call = agent on network | ✓ Good |
| SKILL.md for agents, not humans | Agent reads and acts without human interpretation | ✓ Good |
| Hub IS the landing page | Discover page is homepage, no separate landing app | ✓ Good |
| Magic UI = component source only | Extract components into Hub, don't replace Hub with template | ✓ Good |
| Doodle creature mascot | 56px SVG inline in NavBar next to "AgentBnB" text | ✓ Good |

---
*Last updated: 2026-03-17 after v2.3 Launch Ready milestone start (corrected approach)*
