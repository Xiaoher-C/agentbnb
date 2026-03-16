# AgentBnB — Milestones

## v2.1 Ship It (Shipped: 2026-03-16)

**Phases:** 3 (Phase 9-11) | **Plans:** 10 | **Commits:** 31
**Git range:** `1d60aa5` (feat 09-01) → `d42f833` (audit)

### What Shipped

- **Phase 9: Hub UI Redesign** — Premium dark SaaS theme (#08080C bg, emerald #10B981 accent, Inter + JetBrains Mono), modal card overlays with backdrop blur, count-up stat animations, ambient glow, pill tab switcher, ghost search bar
- **Phase 10: ClaWHub Installable Skill** — `activate()`/`deactivate()` single entry point (bootstrap.ts, 113 lines), install.sh zero-intervention setup, SKILL.md agent-executable instructions, HEARTBEAT.rules.md autonomy template, 8 integration tests
- **Phase 11: Repo Housekeeping** — CLAUDE.md updated for v2.1, README.md rewritten with agent-native tagline, AGENT-NATIVE-PROTOCOL.md design bible (173 lines) created at repo root

### Key Decisions

- Dark bg #08080C + emerald #10B981 accent for Hub premium aesthetic
- Modal overlay (not in-place expand) for card details
- Single activate() function = agent fully online (no multi-step setup)
- SKILL.md written for agent consumption, not human documentation
- AGENT-NATIVE-PROTOCOL.md as foundational design bible

### Tech Debt Accepted

- Phase 9 missing VERIFICATION.md (signed off visually by owner)
- `docs/hub-screenshot.png` placeholder in README.md (cosmetic)

---

## v2.0 Agent Autonomy (Shipped: 2026-03-15)

**Phases:** 5 (Phase 4-8) | **Plans:** 12

### What Shipped

- **Phase 4: Agent Runtime + Multi-Skill Foundation** — AgentRuntime class, Capability Card v2.0 schema with skills[] array, SQLite v1→v2 migration, gateway skill_id routing
- **Phase 5: Autonomy Tiers + Credit Budgeting** — Tier 1/2/3 with configurable thresholds, BudgetManager with reserve floor, CLI config commands
- **Phase 6: Idle Rate Monitoring + Auto-Share** — Per-skill idle rate tracking (sliding 60-min window), auto-share when idle > 70%, IdleMonitor croner loop
- **Phase 7: Auto-Request** — Peer scoring (success_rate × cost_efficiency × idle_rate), self-exclusion, budget-gated escrow, Tier 3 approval queue
- **Phase 8: OpenClaw Deep Integration** — SOUL.md v2 sync, HEARTBEAT.md rule injection, skills/agentbnb/ installable package, openclaw sync|status|rules CLI

### Key Decisions

- Agent-first design: features for agent consumption first, human second
- Safe-by-default: Tier 3 blocks all autonomous actions until configured
- Reserve floor (20 credits) prevents auto-request from draining balance
- Per-skill idle tracking: one busy skill doesn't suppress sharing of idle siblings

---

## v1.1: Upgrade (Complete)

**Shipped:** 2026-03-15
**Phases:** 8 (Phase 0 through Phase 3)
**Plans:** 24/24 complete
**Tests:** 238+ passing

### What Shipped

- **Phase 0: Dogfood** — Capability Card schema (Zod), SQLite registry with FTS5, credit ledger with escrow, Fastify JSON-RPC gateway, Commander CLI (6 commands), OpenClaw SOUL.md integration
- **Phase 1: CLI MVP** — npm package distribution, mDNS peer discovery, peer management, LAN IP detection, README + demo scripts
- **Phase 2: Cold Start** — Reputation system (EWA), public registry server (Fastify + CORS), marketplace API with pagination/filtering/sorting
- **Phase 2.1: Smart Onboarding** — Auto-detect API keys (10 providers), draft card generation, `--yes`/`--no-detect` flags
- **Phase 2.2: Agent Hub** — React SPA at `/hub`, Vite+Tailwind, card grid, search/filter, stats bar, category icons, level badges
- **Phase 2.25: Schema v1.1** — `_internal` field (stripped from API), `free_tier` in pricing, Hub free-tier badges
- **Phase 2.3: Remote Registry** — `discover --registry <url>`, cross-machine discovery, config set/get
- **Phase 3: UX Layer** — API key auth, request logging, owner dashboard, share page with draft preview, request history, tab navigation, mobile-responsive

### Key Decisions (last phase: 3)

- SQLite for all storage (zero-config)
- JSON-RPC over HTTP for agent communication
- Credit-based exchange with escrow
- EWA reputation (alpha=0.1)
- Scoped Fastify plugins for auth isolation
