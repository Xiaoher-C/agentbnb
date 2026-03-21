# Browser QA Report
**URL**: http://localhost:5173/hub/
**Date**: 2026-03-20
**Backend**: http://localhost:7777 (proxied through Vite at :5173)
**Flows Tested**:
1. Discover page (index route `/`)
2. Capability card click -> CardModal
3. Agent profile page (`/agents/Xiaoher-C` via ProfilePage.tsx)
4. API response shape analysis

---

## Live Data State

The backend registry is running with 8 capability cards all owned by `Xiaoher-C`:
- ElevenLabs TTS Pro (zh-TW)
- Kling AI Video Generation
- GPT-4o Text Generation
- Recraft V4 Image Generation
- Mac Mini M4 Pro Compute
- AI 短影片製作 Pipeline (L2)
- Conductor Alpha (L2 - Task Orchestration)
- Xiaoher-C / Anthropic Claude

All 8 cards are `availability.online: true`. One agent (`Xiaoher-C`) is registered.

---

## 1. Discover Page — What Is Visible

### StatsBar (Narrative Strip)
All three stats are populated from `/api/stats`:
- **Active agents**: `1` (correct — 1 unique owner)
- **Executions (7d)**: `5` (from `executions_7d` field)
- **Verified providers**: `0` (no badges granted yet)

The tagline "Authorized agents for real-world and digital execution" renders because `executions7d` and `verifiedProviders` are both defined (Hub v2 mode is active).

Count-up animation fires on mount (400ms ease-out cubic).

### Intent Entry Points (3 buttons)
All three render correctly:
- "Find by Capability" (lightning bolt, emerald) — sets sort to 'popular'
- "Find by Performance Tier" (bar chart, blue) — sets sort to 'rated' + online-only
- "Find by Verification Badge" (building, violet) — sets query to 'verified'

### SearchFilter Controls
Present and functional:
- Search input (full width, 48px, placeholder "Search skills, agents, or categories...")
- Sort select: Most Popular / Highest Rated / Cheapest / Newest
- Level select: All Levels / L1 Atomic / L2 Pipeline / L3 Environment
- Category select: populated from inferred categories (tts, video, text-gen, compute, etc.)
- Min success rate select: Any / >=70% / >=85% / >=95%
- Online only checkbox
- Verified only checkbox

Category select is NOT disabled (availableCategories has entries inferred from card metadata tags).

### Use Case Quick Entry Buttons
Six buttons render: Reserve inventory, Generate image assets, Process documents, Research & summarize, Run external API, Text generation.

### Card Grid
All 8 cards render as individual CapabilityCard components (v2.0 multi-skill cards are normalized: each card's `skills[]` inner array is flattened, so each skill becomes one grid card). The normalization happens in `useCards.ts:normalizeCard()`.

Each card shows:
- Layer 1 (Identity): Avatar (boring-avatars beam), skill name, @Xiaoher-C, LevelBadge (L1 Atomic or L2 Pipeline)
- Layer 2 (Capability): Category chips inferred from metadata tags
- Layer 3 (Performance): Online dot + "Online", success rate %, latency in ms or s
- Layer 4 (Trust Source): "Self-declared" text (no verification badges), credit price (e.g. "cr 5")

Section label "All agents (8)" appears above the grid since no query is active.

### Below-the-Fold Sections
CompatibleWithSection, FAQSection, and ValuePropSection all render below the card grid per the DiscoverPage structure.

---

## 2. CardModal — Clicking a Card

When a CapabilityCard is clicked, `setSelectedCard(card)` is called with a normalized HubCard (flat shape, correct). The CardModal receives a valid HubCard and renders:

- Backdrop blur overlay
- Drag handle (mobile only)
- Close button (X)
- 48px Avatar (beam variant)
- Card name (h2, 18px)
- @owner button (navigates to /agents/:owner, closes modal)
- Status dot + Online/Offline + idle rate (idle 100% since idle_rate=1 in _internal)
- Category chips
- Pricing badge: emerald "5 credits/call" (for TTS card)
- Description text
- Inputs list (monospace, name: type — description *)
- Outputs list
- Stats row: Cost, Success Rate, Avg Latency
- "Request this skill" section with CLI command `agentbnb request <id>` + CopyButton

Modal functions correctly: ESC closes, backdrop click closes, scroll lock applied.

---

## 3. Profile Page — /agents/Xiaoher-C

Navigating to `/agents/Xiaoher-C` loads data from `GET /api/agents/Xiaoher-C`. The API returns 8 full CapabilityCard objects in `profileV2.skills[]`. **This is where the critical bug lives.**

### Module 1: Identity Header — RENDERS
- Avatar (marble, 56px)
- Agent name: "ElevenLabs TTS Pro (zh-TW)" (from `agent_name` field — this is the first card's name, not a proper agent identity name)
- Performance tier badge: "Listed" (tier 0, gray)
- No verification badges (empty array)
- `short_description`: null/undefined — the subtitle line does not appear
- Metadata: `@Xiaoher-C`, joined date, "Active 2d ago"

**Issue**: `agent_name` is `"ElevenLabs TTS Pro (zh-TW)"` — the first card name — not a proper agent display name. The API sets `agent_name` to the first registered card's name rather than a human/agent identity name.

### Module 2: Capability Panel — BROKEN (CRITICAL BUG)

`ProfilePage.tsx` line 182-192 passes each item from `profileV2.skills[]` directly to `<CapabilityCard card={skill}>`. However, `profileV2.skills[]` from the API contains **full raw CapabilityCard spec v2.0 objects** (with `spec_version`, `owner`, `agent_name`, nested `skills[]` array, `availability`, `created_at`), NOT flattened `HubCard` objects.

The `HubCard` type expects: `id, name, description, level, inputs, outputs, pricing, availability, metadata`.

What each `skills[i]` actually contains at the top level: `spec_version, id, owner, agent_name, skills[], availability, created_at, updated_at, metadata`.

**Missing fields when treated as HubCard:**
- `name` → undefined (it's inside `skills[i].skills[0].name`)
- `description` → undefined
- `level` → undefined (it's inside `skills[i].skills[0].level`)
- `inputs` → undefined
- `outputs` → undefined
- `pricing` → undefined (it's inside `skills[i].skills[0].pricing`)

**Runtime consequences:**
- Card name renders as blank/empty (React renders `undefined` as nothing)
- `LevelBadge` receives `level=undefined`, calls `getLevelBadge(undefined)`, returns `badges[undefined]` which is `undefined`. Then `badge.style` throws `TypeError: Cannot read properties of undefined (reading 'style')` — **this crashes the Capability Panel rendering**
- `formatCredits(undefined)` throws `TypeError: Cannot read properties of undefined (reading 'credits_per_minute')` — if it gets that far

The entire Capability Panel section either crashes (white blank panel) or shows 8 empty cards depending on React error boundary behavior. Since there is no explicit error boundary in ProfilePage, this likely triggers a React rendering error that could blank the entire profile page below the Identity Header.

**Suitability sub-section**: `profileV2.suitability` is `null` from the API, so the suitability block conditionally does not render. This is correct fallback behavior.

### Module 3: Authority Card — RENDERS
- Source: "Self-declared capability" (authority_source = 'self')
- Status: "No verification" (verification_status = 'none', gray)
- Scope: empty → not rendered
- Expires: not set → not rendered

### Module 4: Trust Metrics — RENDERS
Actual values from API:
- Total executions: 5
- Successful: "2 (40%)"
- Avg latency: 1.8s (1774ms)
- Failure rate: 60% (refund_rate = 0.6)
- Repeat use: 100% (repeat_use_rate = 1)

7-day trend mini bar chart: 1 data point (2026-03-18: 5 runs, 2 success). Bar height = 100% (max=5), color = amber (successPct = 40%, between 50-80% threshold).

### Module 5: Execution Proof — RENDERS
5 entries from `execution_proofs[]`, all for "ElevenLabs TTS Pro (zh-TW)":
- "success" (completed, 3536ms, Request log badge, 2d ago)
- "failed" (failed, 47ms, Request log badge, 2d ago)
- "success" (completed, 12ms, Request log badge, 2d ago)
- "failed" (failed, 14ms, Request log badge, 2d ago)
- "failed" (failed, 22ms, Request log badge, 2d ago)

All `proof_source` values are `"request_log"` → shows gray "Request log" badge on all 5. No "Signed" or "Settled" badges appear. This is correct given no escrow settlements have occurred.

### Module 6: Learning & Evolution — RENDERS (empty state)
`learning.known_limitations = []`, `common_failure_patterns = []`, `recent_improvements = []`, `critiques = []`.
Renders the empty state: "No learning signals published yet."

---

## Console Errors

Based on code analysis, the following errors will appear in the browser console when navigating to `/agents/Xiaoher-C`:

1. **`TypeError: Cannot read properties of undefined (reading 'style')`** (HIGH)
   - Source: `LevelBadge.tsx` line 37 — `badge.style` where `badge = getLevelBadge(undefined)`
   - Triggered 8 times (once per card in `profileV2.skills.map(...)`)
   - Will fire for every skill card rendered in the Capability Panel

2. **`TypeError: Cannot read properties of undefined (reading 'credits_per_minute')`** (HIGH)
   - Source: `utils.ts:formatCredits()` called with `undefined` pricing
   - Fires after LevelBadge error if React continues rendering

3. Possible **React error boundary cascade** if no error boundary is wrapping the Capability Panel — the entire page below the Identity Header may go blank.

On the Discover page:
- No console errors expected (data is properly normalized via `normalizeCard()` before reaching CapabilityCard)

---

## UI Issues Found

| Severity | Location | Issue | Steps to Reproduce |
|----------|----------|-------|---------------------|
| CRITICAL | ProfilePage — Module 2 (Capability Panel) | `profileV2.skills[]` contains raw v2.0 card objects (with nested `skills[]`) instead of flat `HubCard` objects. `card.name`, `card.level`, `card.pricing`, `card.inputs`, `card.outputs` are all `undefined`. Causes `TypeError` crashes in `LevelBadge` and `formatCredits`. Capability Panel likely renders blank or crashes the page. | Navigate to `/agents/Xiaoher-C`, observe Module 2 is blank/errored, check console |
| HIGH | ProfilePage — Identity Header | `agent_name` field from API is set to the first registered card's name ("ElevenLabs TTS Pro (zh-TW)") not a proper agent name. The profile header shows a skill name as the agent identity. | Navigate to `/agents/Xiaoher-C`, look at the name in the Identity Header |
| HIGH | ProfilePage — Module 2 (Capability Panel) | No normalization equivalent to `useCards.ts:normalizeCard()` is applied to `profileV2.skills`. The hook `useAgentProfile` casts the raw API response directly to `AgentProfileV2` without flattening nested skill objects. | See code: `useAgents.ts:112` — `const data = (await res.json()) as AgentProfileV2` with no transform |
| MEDIUM | ProfilePage — Module 1 (Identity Header) | `short_description` is `null` for all current agents — the descriptive subtitle beneath the agent name never appears. Not a code bug, but the identity header looks incomplete without it. | Navigate to `/agents/Xiaoher-C`, observe no subtitle text below the name |
| MEDIUM | StatsBar — Verified Providers | Count shows `0`. With no verification workflow available, this stat will always be 0 for all new agents. Showing it prominently in the StatsBar while it is always 0 may undermine trust messaging. | Observe StatsBar on Discover page |
| MEDIUM | ProfilePage — Module 5 (Execution Proof) | All 5 proof entries show the same action name "ElevenLabs TTS Pro (zh-TW)" because all requests went to the same skill. This is correct data but gives a visually monotonous proof list. Not a bug. | Navigate to `/agents/Xiaoher-C`, observe Execution Proof section |
| LOW | ProfilePage — Module 4 (Trust Metrics) | Failure rate is labeled "Failure rate" but the field is `refund_rate` from the API. The 60% value (3 failures out of 5 runs) is accurate but the semantic label "Failure rate" vs "Refund rate" is inconsistent with the backend field name. | Navigate to `/agents/Xiaoher-C`, observe Trust Metrics module |
| LOW | ProfilePage — Module 3 (Authority Card) | Authority scope is empty and the Scope section does not render. The Authority card looks sparse with only "Source: Self-declared capability" and "Status: No verification". Two fields is minimal for a full module panel. | Navigate to `/agents/Xiaoher-C`, observe Authority module |
| LOW | Discover page — Card Grid label | The section label reads "All agents (8)" but the cards are individual skills, not agents. There is 1 agent (Xiaoher-C) with 8 skills. The count and label are misleading. | Observe the grid section label above the card grid on the Discover page |
| LOW | CardModal — idle rate display | The modal shows "Idle 100%" for all online cards. The idle_rate is computed in `_internal` as `1` (100%), but this is a backend automation artifact, not real user-observed idle data. | Click any card on Discover, observe idle rate display in modal |

---

## Root Cause Analysis — Critical Bug

**File**: `hub/src/hooks/useAgents.ts`, line 111–112
```typescript
const data = (await res.json()) as AgentProfileV2;
setProfileV2(data);
```

The API endpoint `GET /api/agents/:owner` returns `skills[]` as an array of full v2.0 `CapabilityCard` objects (each with a nested `skills[]` array). The `AgentProfileV2` TypeScript type declares `skills: HubCard[]`, creating a type mismatch that TypeScript accepts at compile time (cast) but breaks at runtime.

The fix requires normalizing `data.skills` the same way `normalizeCard()` works in `useCards.ts` — by flattening each card's nested `skills[]` array into individual `HubCard` objects.

**Affected component**: `ProfilePage.tsx` line 182–192 (Capability Panel skill rendering)

---

## Recommendations (Prioritized)

1. **[CRITICAL] Fix ProfilePage skill data shape mismatch** — In `useAgents.ts:fetchProfile`, after `const data = await res.json() as AgentProfileV2`, apply normalization to `data.skills` using the same `normalizeCard` logic from `useCards.ts`. Each item in `data.skills` is a full card object; flatten its inner `.skills[]` array into individual `HubCard` items.

2. **[HIGH] Fix agent_name in API response** — The registry server's `/api/agents/:owner` handler sets `agent_name` to the first card's `agent_name` field (which is itself the skill name). A proper agent display name should be the `owner` string or a separate identity field. Review `src/registry/server.ts` agent profile construction.

3. **[MEDIUM] Add short_description to agent profile** — The Identity Header has a subtitle slot for `short_description` but the API always returns `null`. Consider populating this from the OpenClaw SOUL.md sync or allowing it to fall through to a formatted `owner` + skills summary.

4. **[MEDIUM] Reconsider "Verified providers: 0" in StatsBar** — Either suppress this stat when it is always 0, or replace it with a stat that has real data (e.g. "Total skills: 8"). Showing 0 for a trust-oriented metric on first load is counterproductive to the recruiting purpose of the Hub.

5. **[LOW] Correct grid section label** — Change "All agents (N)" to "All skills (N)" or "All capabilities (N)" since the grid shows skill cards, not agent count.

6. **[LOW] Rename "Failure rate" to match backend** — Either rename the Trust Metrics label to "Refund rate" (matching `refund_rate` field) or change the label to "Avg failure rate" to be semantically accurate for what is being measured.
