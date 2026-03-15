# Phase 3: UX Layer - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Non-technical users can share agent capabilities via the Hub's authenticated owner features: dashboard monitoring, one-click sharing, and mobile-responsive status page. Visual pipeline builder explicitly skipped (target users are developers who use CLI). Extends the existing Hub SPA — no separate app.

</domain>

<decisions>
## Implementation Decisions

### Owner dashboard scope
- "My Agent" tab in the existing Hub — visible only when authenticated
- Read-only visualization of CLI-managed state: published cards, request history, credit balance, reputation stats
- Quick actions: publish/unpublish cards, edit pricing from the dashboard (requires write endpoints)
- Essential metrics per capability: request count (24h/7d/30d), success rate, avg latency, credit earned, online status
- No rich analytics (timeline charts, per-requester breakdown) — keep it minimal for Phase 3

### Authentication flow
- API key from CLI: `agentbnb init` generates a local API key stored in `~/.agentbnb/config.json`
- Dashboard login: single input field to paste the API key. No OAuth, no magic links, no passwords
- Public Hub browsing requires zero auth — only dashboard actions require the API key
- Backend validates API key on auth-protected endpoints (GET /me, GET /requests, POST /cards/:id/toggle, PATCH /cards/:id)

### One-click sharing UX
- `/hub/share` page: detects a running `agentbnb serve` on localhost:7701
- If local server found: pulls draft card (from auto-detect in Phase 2.1), shows editable preview (name, description, pricing)
- Owner edits fields and clicks "Publish" → published to local SQLite registry
- If no local server detected: show "Run `agentbnb serve` first" with copy-paste command block
- Publish to local registry only — remote discovery happens via Phase 2.3's `--registry` mechanism

### Notification & monitoring
- `/hub/status` page (or tab): credit balance, last 10 requests, agent online/offline status
- Polling every 30s (same pattern as Hub card polling)
- No Web Push notifications in Phase 3 — defer to future phase
- Events to surface: request received, execution complete (success/fail), credit low (< 10 credits)
- Inline red badges for critical alerts (credit low, execution failures) — no popups or sounds
- New auth-protected `GET /requests` endpoint: returns last N requests with status, latency, credit amount

### Backend additions
- Auth-protected endpoints on the registry server:
  - `GET /me` — returns owner identity (validates API key)
  - `GET /requests` — last N requests with status, latency, credit
  - `POST /cards/:id/toggle-online` — toggle availability
  - `PATCH /cards/:id` — update pricing, description
- API key validation middleware on protected routes
- Existing public endpoints (GET /cards, GET /health) remain unauthenticated

### Visual pipeline builder
- SKIP — target users are developers, CLI is sufficient

### Mobile
- Responsive web design for all Hub pages — no native app
- Web Push notifications deferred to future phase

### Claude's Discretion
- State management approach (React context, zustand, or hooks-only)
- API key generation algorithm (UUID v4, crypto.randomBytes, etc.)
- Request history storage (extend existing SQLite tables or new table)
- Exact responsive breakpoints and mobile layout
- Error states for auth failures and network issues

</decisions>

<specifics>
## Specific Ideas

- Owner said: "dashboard 是 read-only visualization of what CLI already does" — dashboard mirrors CLI state, doesn't replace it
- Share page detects local server like Phase 2.1's auto-detect pattern — probe localhost:7701/health
- Authentication is intentionally simple: no user accounts, no registration. The API key IS the identity
- Credit low threshold at < 10 credits — surface as inline badge, not blocking alert

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Hub SPA in `hub/` — React + Tailwind + Vite, 10 components (CapabilityCard, CardGrid, SearchFilter, StatsBar, etc.)
- `useCards()` hook with 30s polling — can be adapted for useRequests(), useStatus()
- `createRegistryServer()` in `src/registry/server.ts` — Fastify instance to add auth-protected routes
- `loadConfig()` / `saveConfig()` in `src/cli/config.ts` — config management including API key storage
- `auth.ts` in `src/gateway/auth.ts` — existing token-based auth for gateway, pattern reusable
- `stripInternal()` in `src/registry/server.ts` — pattern for filtering sensitive fields
- Escrow/ledger tables in SQLite — request history data already stored

### Established Patterns
- Fastify for HTTP servers (gateway 7700, registry 7701)
- Hub served as static build via @fastify/static at `/hub`
- boring-avatars identicons, lucide-react icons, Tailwind dark theme
- Co-located tests as *.test.ts / *.test.tsx
- AGENTBNB_DIR env var for test isolation

### Integration Points
- Hub SPA gets new routes/tabs: /hub (public browse, existing), /hub/share, /hub/status
- Registry server gains auth middleware + 4 new endpoints
- API key stored in config.json alongside existing fields (owner, db_path, registry, etc.)
- `agentbnb serve` already starts registry server — no new server process needed

</code_context>

<deferred>
## Deferred Ideas

- Web Push notifications — future phase after basic monitoring works
- Rich analytics (timeline charts, per-requester breakdown) — future phase
- User accounts / registration — not needed while API key auth is sufficient
- Remote publish (push card to remote registry) — requires write API on remote
- Visual pipeline builder — skipped permanently for developer audience

</deferred>

---

*Phase: 03-ux-layer*
*Context gathered: 2026-03-15*
