# AgentBnB — Milestones

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
