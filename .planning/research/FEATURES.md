# Feature Research

**Domain:** Agent capability marketplace Hub expansion + multi-platform skill distribution (AgentBnB v2.2)
**Researched:** 2026-03-16
**Confidence:** HIGH (Claude Code plugin docs verified via official source; cross-tool SKILL.md patterns verified via multiple live repositories; React charting patterns verified via current documentation; activity feed patterns verified via multiple 2025-2026 sources)

---

## Existing Baseline (Already Shipped — Do Not Rebuild)

Before mapping new features, document what v2.1 already provides to avoid scope confusion:

- Capability Card grid with search/filter (FTS5), modal overlay details with CLI copy button
- Owner dashboard: published cards list, per-period request counts (24h/7d/30d), credit balance with low-credit badge, request history table
- Auth (API key gate), Share page, tab navigation (Discover / Share / My Agent)
- StatsBar with count-up animations (agents online, capabilities, exchanges)
- Premium dark SaaS theme (#08080C + #10B981 emerald), ambient radial glow, skeleton loading, backdrop-blur modals
- CLI: init, publish, discover, request, serve, config, openclaw commands
- Credit ledger with escrow, autonomy tiers, idle monitoring, auto-share, auto-request
- OpenClaw SKILL.md, install.sh, bootstrap.ts activate()/deactivate()
- `boring-avatars` installed for identicons

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features missing from a product of this type that make it feel incomplete. These must ship.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Agent Profiles page (list view with ranking) | Every marketplace has a participant directory. Without it, discovery is card-only, not agent-centric. npm has user profile pages, Hugging Face has model cards — agents need the same. Ranking signals quality at a glance. | MEDIUM | Reads from existing `GET /cards` endpoint; ranking derives from `success_rate`, `avg_latency_ms`, `availability.online` already in schema; `boring-avatars` already installed for identicons |
| Individual agent profile view | Clicking an agent from the profiles list must go somewhere — a view showing that agent's published skills, aggregate stats, and a request CTA. All marketplaces support drill-down. | MEDIUM | Reuses `CapabilityCard`, `LevelBadge`, `CategoryChip` components; modal overlay pattern (consistent with `CardModal`) avoids React Router dependency |
| Credit balance visible in nav | Users of credit-based systems always want their balance at a glance — Stripe balance widget, OpenAI credit display. Currently balance is only in the My Agent tab behind auth. | LOW | `useOwnerCards` hook already fetches `balance`; nav-level display needs `cr` symbol and emerald color; extract pattern from `OwnerDashboard.tsx` |
| Credit earning chart (30-day sparkline) | Any dashboard with earnings shows a trend line. The current owner dashboard shows counts but no visualization. Users expect to see growth over time. | MEDIUM | `useRequests(apiKey, '30d')` hook already provides the data; recharts `AreaChart` + `ResponsiveContainer` is the verified standard pattern for low-density React dashboards |
| Mobile responsive layout | The hub is a recruiting tool shown to developer agents and humans on any device. Missing hamburger nav / stacked cards breaks presentation on phones and during demos. | MEDIUM | Tailwind `md:` breakpoints; existing card grid already uses `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` but nav and header are not responsive; hamburger state needs `useState` |
| In-hub documentation page | Developers evaluating an open-source protocol need Getting Started, API Reference, and multi-tool install instructions without leaving the hub. npm renders README inline; documentation must be similarly accessible. | MEDIUM | Static content; `react-markdown` (lightweight, zero bundler config) is sufficient; no backend changes; new `Docs` tab in App.tsx TABS array |
| Skill Detail Modal enhancement (request button + availability) | When a user opens a card modal, the natural next action is "request this". Currently the modal only shows a CLI command to copy. The primary CTA must be a button, not a code block. | LOW | `CardModal.tsx` already has CLI code block; enhancement = add `Request` button that executes or copies enriched CLI call; availability schedule is already in schema but not displayed |

### Differentiators (Competitive Advantage)

Features unique to AgentBnB's agent-native philosophy and distribution strategy.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| Activity Feed (real-time capability exchanges) | Shows live proof that the network is active — agents requesting, completing, earning credits. No other agent marketplace visualizes the actual exchange economy in real time. Creates social proof and FOMO for developer onboarding. | MEDIUM | `useRequests` hook already fetches request log data; activity feed = 10-second polling of `/requests` endpoint (no WebSocket/SSE needed for MVP); format events as `"agent-X used skill-Y from agent-Z · 5cr · 2m ago"` |
| Claude Code plugin marketplace (`marketplace.json`) | AgentBnB becomes discoverable inside Claude Code via `/plugin marketplace add`. The verified schema requires `name`, `owner.name`, `plugins[].name`, `plugins[].source`. This is the primary inbound distribution channel for the tool's target audience (developers using Claude Code). | LOW | SKILL.md already exists (v2.1); only needs `.claude-plugin/marketplace.json` + `plugin.json` manifest files added to repo root; zero hub code changes |
| Cross-tool SKILL.md distribution (Antigravity, Codex, Cursor, Copilot) | The SKILL.md open standard is now verified cross-agent: same file works on Claude Code, Codex CLI, Antigravity, Cursor, GitHub Copilot, and 35+ other platforms. Adding frontmatter metadata gets AgentBnB indexed by SkillsMP (351k+ skills) and Skills.sh (8M+ installs). | LOW | SKILL.md exists; enhancement = add YAML frontmatter `name:`, `description:`, `compatible-tools:` fields; add GitHub topics to repo settings |
| Auto-index preparation (GitHub topics + frontmatter) | SkillsMP crawls GitHub daily for `SKILL.md` files. Skills.sh (Vercel-run) tracks install counts. Proper setup turns organic discovery into a passive distribution channel with zero ongoing cost. | LOW | Static repo config changes only; no code |
| Design system polish pass (ambient glow, hover animations, OwnerDashboard migration) | Hub is the recruiter. Visual polish signals production quality. The existing `OwnerDashboard` uses `slate-*` Tailwind tokens inconsistent with the rest of the hub's `hub-*` design tokens — a visible quality gap. | MEDIUM | All existing components; `OwnerDashboard.tsx` must be migrated from `slate-*` to `hub-*` tokens to match the premium dark aesthetic established in v2.1 |
| README visual overhaul (hero image, badges, architecture diagram) | GitHub README is the first page any developer sees. Polished READMEs drive adoption — Microsoft published 98 agent skills with professional READMEs and accumulated 1.7M installs. | LOW | Static asset work; shields.io badges, SVG architecture diagram; no code changes |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| WebSocket real-time activity feed | "Real-time" sounds better than polling | WebSockets require persistent connections, add server infrastructure complexity, and are hard to maintain in a local-first SQLite-backed server. For capability exchanges that happen every few seconds at most, 10-second polling is functionally identical to WebSocket push. | Start with `setInterval` 10-second polling using existing `/requests` endpoint. No new server infrastructure. Upgrade to SSE only if polling latency creates visible UX problems. |
| Full MDX documentation system with search | Developers want searchable docs | Adding Algolia DocSearch, Fumadocs, or a full MDX pipeline into a Vite SPA adds significant build complexity and dependency surface. The hub docs need only 4-6 static pages total. | Render static markdown with `react-markdown` (lightweight, zero bundler config, no remark/rehype pipeline). Tab navigation handles page discovery. Browser Ctrl+F handles in-page search. |
| Real money / payment integration | Credits seem arbitrary | Out of scope per PROJECT.md. Real payments require PCI compliance, payment processor accounts, legal structures, and tax handling — none appropriate for an MIT-licensed P2P protocol. | Credit-based economy with clear `cr` symbol and earning dashboard. The economic layer is the feature; real money changes the legal character. |
| Agent social graph (follow, like, comment) | Makes it feel like a community | Creates content moderation responsibility, increases database schema complexity, and does not align with agent-native philosophy. Agents do not follow each other — they discover by capability match. | Activity feed + ranking leaderboard provides social proof without social graph complexity. |
| Per-skill public install counts | Drives FOMO and social proof | Fabricated or low counts damage credibility more than help. Install counts require a central tracking server, which contradicts local-first. | Show `success_rate` and `avg_latency_ms` (already tracked via EWA) as quality proxies — verifiable and meaningful to agents evaluating peers. |
| Cloud-hosted central registry | "Just works" without setup | Introduces centralization, operational cost, SLA responsibility, and contradicts the local-first philosophy. | mDNS peer discovery + public registry API (already built) handles multi-node coordination. The npm analogy: registry is a well-known but replaceable component. |

---

## Feature Dependencies

```
Agent Profiles (list view with ranking)
    └──requires──> GET /cards endpoint (ALREADY EXISTS)
    └──requires──> Ranking formula (success_rate × online_status from existing schema)
    └──no new backend──> Pure frontend feature

Individual Agent Profile (detail view)
    └──requires──> Agent Profiles list (navigation source)
    └──reuses──>   CapabilityCard, LevelBadge, CategoryChip (ALREADY EXIST)
    └──enhances──> CardModal (consistent modal overlay pattern)

Activity Feed
    └──requires──> /requests endpoint (ALREADY EXISTS via useRequests hook)
    └──enhances──> StatsBar totalExchanges (feed shows what the counter counts)
    └──no new backend──> 10-second polling is sufficient

Credit Balance in Nav
    └──requires──> useOwnerCards balance field (ALREADY EXISTS)
    └──requires──> Auth state from useAuth (ALREADY EXISTS)
    └──enhances──> Owner Dashboard (consistent display)

Credit Earning Chart
    └──requires──> useRequests(apiKey, '30d') (ALREADY EXISTS)
    └──requires──> recharts AreaChart (NEW dependency)
    └──enhances──> Owner Dashboard (visual layer on existing count data)

Sign-up / Earn CTA
    └──requires──> Credit Balance in Nav (contextual prompt when unauthenticated)
    └──enhances──> Share page (conversion funnel)

In-Hub Docs Page
    └──requires──> New tab entry in App.tsx TABS array
    └──requires──> react-markdown (NEW dependency, or static JSX)
    └──no backend changes──> All content is static

Skill Detail Modal Enhancement (request button, availability, related skills)
    └──requires──> CardModal (ALREADY EXISTS — enhancement only)
    └──enhances──> Agent Profiles (link from profile to skill detail)

Mobile Responsive Layout
    └──enhances──> All existing and new components
    └──requires──> Tailwind md: breakpoints in App.tsx header/nav
    └──conflicts with──> OwnerDashboard slate-* token usage (must fix simultaneously)

Design System Polish
    └──enhances──> All new pages (must use hub-* tokens, not slate-* tokens)
    └──conflicts with──> OwnerDashboard (currently slate-*, needs migration to hub-*)

Claude Code Marketplace (.claude-plugin/)
    └──requires──> SKILL.md (ALREADY EXISTS — may need minor frontmatter)
    └──no code changes──> File additions to repo root only

Cross-tool SKILL.md Compatibility
    └──requires──> SKILL.md YAML frontmatter enhancement (existing file)
    └──enhances──> Claude Code Marketplace (same file, broader compatibility)

Auto-index Preparation (GitHub topics)
    └──no code dependencies──> Repo settings only
    └──requires──> SKILL.md frontmatter (same as cross-tool compatibility)

README Visual Overhaul
    └──no code dependencies──> Static asset + markdown changes
    └──should come last──> Screenshots need final hub design
```

### Dependency Notes

- **Activity Feed has no new backend dependencies:** The endpoint, hook, and data are all already built. This is purely a presentation-layer feature.
- **Credit Chart requires recharts:** Recharts is the verified current recommendation for low-density React SaaS dashboards (builds on D3, fully declarative, no bundler config required). Add as new dependency — no alternatives needed.
- **Design system conflicts with OwnerDashboard:** `OwnerDashboard.tsx` uses `slate-*` Tailwind tokens (e.g., `bg-slate-800`, `text-slate-400`) while all other hub components use `hub-*` custom tokens (`bg-hub-bg`, `text-hub-text-primary`). The polish pass must migrate OwnerDashboard. This is a correctness fix, not a stylistic choice.
- **Claude Code Marketplace has zero hub code dependencies:** It is purely `.claude-plugin/marketplace.json` + `plugin.json` file additions to the repo root. Can ship in any phase alongside hub work.
- **Mobile responsive depends on all components:** It is a horizontal concern touching every page. Build each new page mobile-first so the responsive pass is minimal at the end.

---

## MVP Definition for This Milestone (v2.2)

### Launch With (v2.2 core — defines the milestone)

- [ ] Agent Profiles page (list + individual) — establishes the agent directory that makes the network tangible
- [ ] Activity Feed — social proof that the exchange economy is real and active
- [ ] In-Hub Documentation page — removes the barrier to evaluation for developers
- [ ] Credit system UI (nav balance display with `cr` symbol, earning chart in dashboard, sign-up CTA) — makes the economic layer visible to newcomers
- [ ] Skill Detail Modal enhancement (request button, availability section) — closes the discovery-to-action loop
- [ ] Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) — primary distribution channel; lowest effort, highest reach
- [ ] Mobile responsive layout — hub is a recruiting tool, must work everywhere
- [ ] Design system polish pass (ambient glow on new pages, OwnerDashboard migration to hub-* tokens) — brand coherence for screenshots

### Add After Core (v2.2 secondary — same milestone if time allows)

- [ ] Cross-tool SKILL.md compatibility frontmatter — trivial once marketplace.json is done; same PR
- [ ] Auto-index preparation (GitHub topics) — no code, can be done at any time
- [ ] README visual overhaul — do last; screenshots must reflect the final hub design

### Future Consideration (v2.3+)

- [ ] SSE-based real-time activity feed — upgrade from polling only if latency becomes visible to users
- [ ] Searchable in-hub documentation — add only if docs grow beyond 6 pages or search requests emerge
- [ ] Related skills suggestions in skill detail modal — requires semantic similarity or embedding search; defer until network has sufficient data

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Claude Code `marketplace.json` | HIGH (primary distribution channel) | LOW (file additions only) | P1 |
| Agent Profiles list + detail | HIGH (makes network visible, agent directory) | MEDIUM (new page + ranking logic) | P1 |
| Activity Feed | HIGH (social proof, proves network is active) | MEDIUM (polling + event formatting) | P1 |
| In-Hub Docs page | HIGH (removes onboarding barrier) | MEDIUM (static content + react-markdown) | P1 |
| Credit nav display + earning chart | MEDIUM (makes economy visible) | LOW-MEDIUM (nav widget + recharts) | P1 |
| Skill Detail Modal enhancement | MEDIUM (closes discovery-to-action loop) | LOW (CardModal enhancement) | P1 |
| Mobile responsive layout | HIGH (recruiting tool must work everywhere) | MEDIUM (Tailwind breakpoints across components) | P1 |
| Design system polish | MEDIUM (brand coherence, screenshot quality) | MEDIUM (OwnerDashboard migration + audit) | P2 |
| Cross-tool SKILL.md compatibility | MEDIUM (broader passive discovery) | LOW (frontmatter only) | P2 |
| Auto-index preparation | MEDIUM (passive distribution, no ongoing cost) | LOW (repo settings) | P2 |
| README visual overhaul | MEDIUM (first impression on GitHub) | LOW (static assets) | P3 |

**Priority key:**
- P1: Must have for v2.2 — defines the milestone deliverables
- P2: Should have — add in same milestone if time permits
- P3: Nice to have — easy wins that ship last

---

## Competitor Feature Analysis

| Feature | npm (package registry) | Hugging Face (model hub) | Our Approach |
|---------|------------------------|--------------------------|--------------|
| Author/agent profiles | User profile with published packages + download counts | Author page with model cards + follower count | Agent profile with skills list, ranking score (success_rate × online_status), credit earnings — no follower count (agent-native, not social) |
| Activity/exchange feed | Download stats page, recent publishes list | Trending models + spaces activity | Real-time capability exchange feed — timestamped events `"agent-X completed skill-Y for agent-Z (5cr)"` |
| Documentation | README rendered on package page | Model card (markdown) | In-hub docs tab: Getting Started, Multi-Tool Install, Card Schema v2.0, API Reference |
| Credit/billing display | Not applicable (free) | Not applicable (free) | Nav-level balance with `cr` symbol, 30-day earning chart, sign-up CTA for new users |
| Distribution mechanism | `npm install <package>` | `pip install` or web download | Claude Code `/plugin marketplace add`, cross-tool SKILL.md, `install.sh` |
| Mobile experience | Fully responsive | Fully responsive | Mobile responsive with hamburger nav — gap that must close for v2.2 |

---

## Implementation Notes by Feature

### Agent Profiles Page

**Data source:** `GET /cards` already returns all cards. Ranking formula: `score = (success_rate ?? 0.5) * (online ? 1.2 : 1.0)`. Sort descending. No new backend endpoint needed for MVP.

**Structure:** Two states — profiles list (grid of agent cards showing 32px boring-avatar identicon + agent name + top skill label + ranking score + online status indicator) and individual profile view (agent's full skills list reusing existing card components, aggregate stats: total skills, online count, avg success rate, credit pricing range).

**Route:** Add `Profiles` as a new tab in App.tsx TABS array. Individual profile view = modal overlay (consistent with CardModal pattern) — avoids React Router dependency. Selected agent stored in `useState<AgentProfile | null>`.

### Activity Feed

**Data source:** `GET /requests` (useRequests hook, already exists). Poll every 10 seconds with `useEffect` + `setInterval`. Format each event: `"{requester} used {skill_name} from {card.owner} · {credits}cr · {time_ago}"`.

**Display:** Chronological list, newest first, max 20 events visible. Subtle CSS fade-in `@keyframes` (opacity 0→1, 300ms) for new events appended to the top. No WebSocket, no SSE — 10-second polling is consistent with local-first SQLite architecture and functionally indistinguishable for this use case.

**Location:** New `Feed` tab in App.tsx, or inline section on the Discover tab below StatsBar. The inline section is lower complexity (no new tab required, no auth gate) and creates a stronger "proof the network is alive" signal on the primary page.

### In-Hub Documentation

**Content:** 4 pages minimum — Getting Started (install + first publish), Multi-Tool Install (Claude Code, Codex CLI, Antigravity, Cursor instructions), Card Schema v2.0 (fields reference), API Reference (endpoints + request format).

**Rendering:** `react-markdown` (lightweight, zero remark/rehype pipeline, no bundler config changes, compatible with Vite SPA). Or static JSX strings for fully controlled rendering. Either choice avoids Fumadocs/Docusaurus complexity.

**Location:** New `Docs` tab in App.tsx. Sub-navigation via a simple in-component tab bar (not nested React Router routes). Tailwind `prose` class for typography rendering.

### Credit System UI

**Nav balance:** After login, display `{balance} cr` in the App.tsx header adjacent to the Disconnect button. Emerald (`text-hub-accent`) for balance ≥ 10, red (`text-red-400`) for balance < 10. The low-credit detection logic already exists in OwnerDashboard — extract and hoist to nav level.

**Earning chart:** `recharts` `AreaChart` with `ResponsiveContainer`. X-axis = last 30 days (date labels), Y-axis = cumulative credits earned from requests. Data: `useRequests(apiKey, '30d')` already provides the raw request array; aggregate by date client-side. Chart fill color = `rgba(16, 185, 129, 0.2)` (hub-accent with opacity), stroke = `#10B981`.

**Sign-up CTA:** Banner above the Share tab content for unauthenticated users: `"Earn credits by sharing your agent's skills — connect your agent to get started"` with a link to the Share tab. Low friction, no new page.

### Claude Code Marketplace (verified schema — HIGH confidence)

**Files to add** (no code changes to existing files):

`.claude-plugin/marketplace.json`:
```json
{
  "name": "agentbnb",
  "owner": { "name": "Cheng Wen Chen" },
  "metadata": { "description": "P2P agent capability sharing — earn credits by sharing idle skills, spend credits to request capabilities from peers" },
  "plugins": [
    {
      "name": "agentbnb-skill",
      "source": { "source": "git-subdir", "url": "github.com/chengwenchen/agentbnb", "path": "skills/agentbnb" },
      "description": "Install AgentBnB capability sharing into your agent",
      "version": "2.2.0",
      "license": "MIT",
      "keywords": ["agent-marketplace", "capability-sharing", "p2p", "credits"]
    }
  ]
}
```

**Verified required fields** (official Claude Code docs, March 2026): `name` (kebab-case string), `owner.name` (string), `plugins[].name` (string), `plugins[].source` (string for relative path, object with `source` type for external). Plugin source `git-subdir` allows pointing to the `skills/agentbnb/` subdirectory of the main repo.

**User installation command:** `/plugin marketplace add chengwenchen/agentbnb` (after pushing to GitHub).

### Cross-Tool SKILL.md Compatibility

Add to existing `SKILL.md` frontmatter:
```yaml
---
name: agentbnb
description: P2P agent capability sharing — publish, discover, and request agent skills with credit-based exchange
compatible-tools: claude-code, codex-cli, antigravity, cursor, github-copilot
tags: [agent-marketplace, capability-sharing, p2p, credits, agentbnb]
---
```

GitHub repository topics to add (repo settings, no code): `agent-skills`, `skill-discovery`, `claude-code`, `agentbnb`, `capability-sharing`.

**Auto-indexing:** SkillsMP crawls daily for SKILL.md files (351k+ indexed). Skills.sh tracks installs (8M+ total). Both index AgentBnB automatically once frontmatter and topics are in place.

---

## Sources

- [Claude Code Plugin Marketplace official docs](https://code.claude.com/docs/en/plugin-marketplaces) — HIGH confidence, official Anthropic source, verified March 2026
- [anthropics/claude-plugins-official GitHub](https://github.com/anthropics/claude-plugins-official) — HIGH confidence, official repository
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) — MEDIUM confidence, cross-tool SKILL.md compatibility patterns
- [Antigravity agent skills ecosystem](https://antigravity.codes/agent-skills) — MEDIUM confidence, 868+ skills cross-tool distribution
- [Agent Skills Are the New npm — buildmvpfast.com 2026](https://www.buildmvpfast.com/blog/agent-skills-npm-ai-package-manager-2026) — MEDIUM confidence, distribution ecosystem context and SkillsMP/Skills.sh data
- [Antigravity awesome-skills — sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) — MEDIUM confidence, SKILL.md frontmatter format examples
- [Top React Chart Libraries for 2026 — Syncfusion](https://www.syncfusion.com/blogs/post/top-5-react-chart-libraries) — MEDIUM confidence, recharts recommendation
- [Recharts deep dive for React SaaS dashboards](https://react-news.com/mastering-data-visualization-a-deep-dive-into-recharts-for-modern-react-applications) — MEDIUM confidence, implementation patterns
- [SSE vs WebSockets vs Polling — DEV Community 2025](https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8) — MEDIUM confidence, polling recommendation for low-frequency activity feeds
- [Activity Stream UI pattern — UI Patterns](https://ui-patterns.com/patterns/ActivityStream) — MEDIUM confidence, feed UX patterns
- [Agent Rating and Leaderboards — AI Agents Directory 2025](https://aiagentsdirectory.com/blog/agent-rating-and-leaderboards-finding-the-best-ai-agents-in-2025) — MEDIUM confidence, ranking patterns for agent marketplaces
- [Marketplace UX Design Guide — Rigby](https://www.rigbyjs.com/blog/marketplace-ux) — MEDIUM confidence, marketplace profile and feed patterns

---

*Feature research for: AgentBnB v2.2 Hub Expansion + Multi-Platform Distribution*
*Researched: 2026-03-16*
