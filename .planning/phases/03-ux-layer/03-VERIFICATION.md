---
phase: 03-ux-layer
verified: 2026-03-15T16:30:00Z
status: human_needed
score: 14/14 must-haves verified
human_verification:
  - test: "Open hub in browser, navigate to My Agent tab, paste API key from config.json, verify dashboard shows credit balance, per-period request counts (24h/7d/30d), published cards with toggle button, and request history table"
    expected: "Dashboard renders all sections without blank/broken layout. Low-credit badge appears if balance < 10."
    why_human: "DOM rendering, Tailwind responsive breakpoints, and React state cannot be verified programmatically."
  - test: "Resize browser window to 375px width and verify all Hub pages (Discover, Share, My Agent) render without horizontal overflow or broken layout"
    expected: "Single-column layout on mobile; stats grid collapses to 2 columns; cards list and request history stack vertically."
    why_human: "CSS responsive breakpoints (sm:, lg:) require visual inspection in an actual browser viewport."
  - test: "Click Share tab when agentbnb serve is NOT running — verify the server-not-running block with agentbnb serve command is shown"
    expected: "Red indicator dot, 'Server Not Running' heading, and agentbnb serve command block visible."
    why_human: "Depends on actual network probe behavior (AbortController timeout) in a live browser."
  - test: "Set OPENAI_API_KEY in environment, run agentbnb serve, click Share tab with valid API key — verify draft card form renders with editable name/description/credits fields and Publish button"
    expected: "At least one draft card form appears pre-populated from auto-detect. Publish button is clickable."
    why_human: "Requires live env var detection, running server, and browser interaction to confirm the full draft-and-publish flow."
---

# Phase 3: UX Layer Verification Report

**Phase Goal:** Non-technical users can share agent capabilities via the Hub's authenticated owner features: dashboard monitoring, one-click sharing, and mobile-responsive status page.
**Verified:** 2026-03-15T16:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | agentbnb init generates an api_key and stores it in config.json | VERIFIED | `src/cli/config.ts` has `api_key?: string` in `AgentBnBConfig`. `src/cli/index.ts` generates 64-char hex key via `randomBytes(32).toString('hex')`, preserves on re-init. 238 backend tests pass including api_key test. |
| 2 | Request log entries are written after every gateway settle/release | VERIFIED | `src/gateway/server.ts` imports `insertRequestLog` and calls it at all 3 settlement points (success after settleEscrow, failure in catch, timeout in abort). Each wrapped in try/catch silent no-op. |
| 3 | insertRequestLog() and getRequestLog() correctly store and retrieve entries | VERIFIED | `src/registry/request-log.ts` is 121 lines with full implementation: `RequestLogEntry` interface, `SincePeriod` type, `createRequestLogTable`, `insertRequestLog`, `getRequestLog` with period filtering. `src/registry/request-log.test.ts` exists and all tests pass. |
| 4 | getRequestLog() supports optional since parameter for period filtering | VERIFIED | `getRequestLog()` computes ISO cutoff from `SINCE_MS` map and applies `WHERE created_at >= ?` when `since` is provided. Period 24h/7d/30d all supported. |
| 5 | GET /me returns owner identity and credit balance with valid API key, 401 without | VERIFIED | `src/registry/server.ts` lines 237-242: scoped `ownerRoutes` plugin with Bearer token auth hook. `/me` calls `getBalance(opts.creditDb, ownerName)`. Returns 401 without or with invalid token. |
| 6 | GET /requests returns last N request log entries with valid API key, supports since param | VERIFIED | `src/registry/server.ts` lines 251-262: parses `limit` (capped 100) and `since` (validated against '24h'|'7d'|'30d') before calling `getRequestLog()`. |
| 7 | GET /draft returns a draft capability card built from auto-detected APIs | VERIFIED | `src/registry/server.ts` lines 267-273: calls `detectApiKeys(KNOWN_API_KEYS)`, maps each through `buildDraftCard(key, ownerName)`, filters nulls, returns `{ cards }`. |
| 8 | POST /cards/:id/toggle-online toggles availability for owned cards, 403 for others | VERIFIED | `src/registry/server.ts` lines 280-298: gets card, flips `availability.online`, calls `updateCard`. Catches `AgentBnBError` with code `FORBIDDEN` and returns 403. |
| 9 | PATCH /cards/:id updates pricing/description for owned cards, 403 for others | VERIFIED | `src/registry/server.ts` lines 305-326: accepts description and pricing partial updates, calls `updateCard`, returns 403 on FORBIDDEN and 404 on NOT_FOUND. |
| 10 | GET /cards and GET /health remain publicly accessible without auth | VERIFIED | Both endpoints registered outside the scoped owner plugin. Regression tests in `src/registry/server.test.ts` confirm 200 without auth headers. All 238 backend tests pass. |
| 11 | Owner can paste API key to log in and see authenticated state | VERIFIED | `hub/src/hooks/useAuth.ts`: localStorage-backed with `login(key)`, `logout()`, `isAuthenticated`. `hub/src/components/AuthGate.tsx`: renders LoginForm when `!apiKey`, renders children when present. `hub/src/components/LoginForm.tsx`: monospace input + Connect button. 6 useAuth tests + 3 AuthGate tests + 4 LoginForm tests pass. |
| 12 | useOwnerCards fetches credit balance from GET /me response | VERIFIED | `hub/src/hooks/useOwnerCards.ts` lines 48-66: fetches `/me` with Bearer header, extracts `me.balance` and sets it via `setBalance(me.balance)`. Returns `balance: number | null`. 4 hook tests pass. |
| 13 | useRequests supports period filtering via since parameter | VERIFIED | `hub/src/hooks/useRequests.ts` lines 50-52: appends `&since=${since}` when provided. Fetches `/requests?limit=10&since=24h`. 4 tests pass including since param test. |
| 14 | Owner dashboard shows published cards, credit balance, request history, and low-credit badge; shows per-period request counts (24h/7d/30d); Share page pulls /draft; Hub has 3 tabs; Hub is responsive | VERIFIED (automated) / NEEDS HUMAN (visual) | `hub/src/components/OwnerDashboard.tsx`: 4 calls to useRequests (24h/7d/30d + all), low-credit badge at `balance < 10`, grid `grid-cols-1 lg:grid-cols-2`. `hub/src/components/SharePage.tsx`: probes `/health` with 2s AbortController, fetches `/draft`, editable form, Publish calls POST /cards. `hub/src/App.tsx`: 3 tabs Discover/Share/My Agent with AuthGate wrapping My Agent. vite.config.ts proxies /me, /requests, /draft. 64 hub tests pass. Visual/responsive behavior needs human. |

**Score:** 14/14 truths verified (4 need human confirmation for visual/interactive aspects)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/registry/request-log.ts` | Request log insert/query functions + table creation | VERIFIED | 121 lines. Exports `RequestLogEntry`, `SincePeriod`, `createRequestLogTable`, `insertRequestLog`, `getRequestLog`. Full implementation. |
| `src/cli/config.ts` | AgentBnBConfig with api_key field | VERIFIED | Line 28: `api_key?: string` — optional for backward compat, with JSDoc. |
| `src/gateway/server.ts` | Gateway writes request_log after settle/release | VERIFIED | Lines 174, 197, 218: three `insertRequestLog()` calls at settlement points. All wrapped in try/catch. |
| `src/registry/server.ts` | Auth middleware + 5 owner endpoints in scoped plugin | VERIFIED | 331 lines. `ownerRoutes` scoped plugin with onRequest auth hook. 5 endpoints: GET /me, GET /requests, GET /draft, POST /cards/:id/toggle-online, PATCH /cards/:id. |
| `hub/src/hooks/useAuth.ts` | localStorage-backed API key auth hook | VERIFIED | 49 lines. Exports `useAuth`. `login`, `logout`, `isAuthenticated` all functional. |
| `hub/src/hooks/useRequests.ts` | 30s polling for /requests with since param | VERIFIED | 103 lines. Exports `useRequests`. 30s polling via setInterval. since param appended to URL. 401 → error state. |
| `hub/src/hooks/useOwnerCards.ts` | Fetches owner cards and credit balance from /me | VERIFIED | 99 lines. Exports `useOwnerCards`. Sequential /me then /cards fetch. balance extracted from /me response. |
| `hub/src/components/AuthGate.tsx` | Wrapper showing LoginForm or children based on auth state | VERIFIED | 32 lines. Renders LoginForm when `!apiKey`, children otherwise. |
| `hub/src/components/LoginForm.tsx` | API key input form | VERIFIED | 57 lines. Monospace input with placeholder "Paste your API key". Connect button. Calls `onLogin`. |
| `hub/src/components/OwnerDashboard.tsx` | My Agent tab with cards, credits, requests, metrics, period counts | VERIFIED | 179 lines. Substantive implementation: 4 useRequests calls, balance with low-credit badge, period counts, cards list with toggle, RequestHistory embedded. |
| `hub/src/components/SharePage.tsx` | One-click sharing page fetching /draft for editable preview | VERIFIED | 297 lines. AbortController /health probe, /draft fetch, editable form (name/description/credits_per_call), Publish → POST /cards. |
| `hub/src/components/RequestHistory.tsx` | Request history table component | VERIFIED | 68 lines. Dark table with status colour badges, empty state. |
| `hub/src/App.tsx` | Tab navigation: Discover, Share, My Agent | VERIFIED | 163 lines. `TABS` array, activeTab state, AuthGate wraps My Agent, Disconnect link when authenticated. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/gateway/server.ts` | `src/registry/request-log.ts` | `insertRequestLog()` after settleEscrow/releaseEscrow | WIRED | Line 7 import confirmed; lines 174, 197, 218 call sites found. |
| `src/registry/store.ts` | request_log table | `createRequestLogTable` in `openDatabase()` | WIRED | Lines 4 and 106: import and call confirmed inside `openDatabase()`. |
| `src/registry/server.ts` | `src/registry/request-log.ts` | `getRequestLog()` in GET /requests handler | WIRED | Line 10: import; line 260: `getRequestLog(db, limit, since)` call. |
| `src/registry/server.ts` | `src/credit/ledger.ts` | `getBalance()` in GET /me handler | WIRED | Line 12: import; line 238: `getBalance(opts.creditDb, ownerName)` call. |
| `src/registry/server.ts` | `src/cli/onboarding.ts` | `buildDraftCard()` in GET /draft handler | WIRED | Line 13: import; lines 268-272: `detectApiKeys` + `buildDraftCard` call. |
| `src/registry/server.ts` | `src/registry/store.ts` | `updateCard()` in toggle-online and PATCH handlers | WIRED | Line 8: import; lines 288, 312: `updateCard()` calls. |
| `hub/src/hooks/useOwnerCards.ts` | `/me` endpoint | fetch with Authorization header, extracts balance | WIRED | Line 48: `fetch('/me', { headers: { Authorization: ... } })`. Line 65: `setBalance(me.balance)`. |
| `hub/src/hooks/useRequests.ts` | `/requests` endpoint | fetch with Authorization header and since param | WIRED | Lines 53-55: `fetch('/requests?${params}', { headers: { Authorization: ... } })`. since appended at line 51. |
| `hub/src/components/OwnerDashboard.tsx` | `/requests?since=24h` | useRequests hook with period param | WIRED | Line 28: `useRequests(apiKey, '24h')`. Lines 29-30: 7d and 30d also wired. |
| `hub/src/components/OwnerDashboard.tsx` | useOwnerCards | extracts balance for low-credit badge | WIRED | Line 27: `useOwnerCards(apiKey)`. Line 38: `balance !== null && balance < 10`. |
| `hub/src/components/SharePage.tsx` | `/draft` | fetch with Authorization header on mount | WIRED | Line 76: `fetch('/draft', { headers: { Authorization: ... } })`. |
| `hub/src/App.tsx` | `hub/src/components/AuthGate.tsx` | AuthGate wraps owner-only tabs | WIRED | Line 16: import. Line 155: `<AuthGate apiKey={apiKey} onLogin={login}>`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UX-01 | 03-01 | `agentbnb init` adds `api_key` to config.json | SATISFIED | `api_key?: string` in AgentBnBConfig, init generates 64-char hex key. Tests pass. |
| UX-02 | 03-01 | `insertRequestLog()` inserts row; `getRequestLog()` returns N newest | SATISFIED | Full implementation in `src/registry/request-log.ts`. Tests pass. |
| UX-03 | 03-01 | Gateway inserts request_log entry after settle/release | SATISFIED | 3 `insertRequestLog` call sites in `src/gateway/server.ts`. Tests pass. |
| UX-04 | 03-02 | GET /me returns 200 with valid key, 401 without | SATISFIED | Scoped plugin with onRequest auth hook. Returns `{ owner, balance }`. Tests pass. |
| UX-05 | 03-02 | GET /requests returns last 10 rows newest-first with valid key | SATISFIED | Calls `getRequestLog(db, limit, since)`. Returns `{ items, limit }`. Tests pass. |
| UX-06 | 03-02 | POST /cards/:id/toggle-online toggles availability; 403 for wrong owner | SATISFIED | Flips `availability.online`, catches FORBIDDEN, returns 403. Tests pass. |
| UX-07 | 03-02 | PATCH /cards/:id updates pricing and description; 403 for wrong owner | SATISFIED | Accepts description and pricing updates, enforces ownership. Tests pass. |
| UX-08 | 03-02 | GET /cards still returns 200 without auth after owner routes added | SATISFIED | Public endpoints outside scoped plugin. Regression tests pass. |
| UX-09 | 03-03a | `useAuth()` reads/writes localStorage; login sets key; logout clears key | SATISFIED | `hub/src/hooks/useAuth.ts` — 6 tests pass. |
| UX-10 | 03-03a | `AuthGate` renders children when authenticated, LoginForm when not | SATISFIED | `hub/src/components/AuthGate.tsx` — 3 tests pass. |
| UX-11 | 03-03a (mapped to UX-11 per RESEARCH.md) | `useRequests()` sends Authorization header; handles 401 with error state | SATISFIED | `hub/src/hooks/useRequests.ts` — 4 tests pass. |
| UX-12 | 03-03b | `OwnerDashboard` shows low-credit badge when balance < 10 | SATISFIED | Line 38 + lines 84-87: badge conditional. 5 OwnerDashboard tests pass. |
| UX-13 | 03-03b | `SharePage` shows command block when local server unreachable | SATISFIED | Lines 154-171: unreachable state shows "Server Not Running" block. 4 tests pass. |
| UX-14 | 03-03b | Hub vite.config.ts proxy includes `/me` and `/requests` | SATISFIED | `hub/vite.config.ts` proxies /me, /requests, /draft, /cards, /health to localhost:7701. |

**Note on Requirements.md gap:** All 14 UX requirements (UX-01 through UX-14) are defined in `.planning/phases/03-ux-layer/03-RESEARCH.md` (Phase Requirements Test Map table, lines 558-573) but are absent from `.planning/REQUIREMENTS.md`. They are referenced in ROADMAP.md. This is an administrative gap — the requirements exist and are implemented — but REQUIREMENTS.md should be updated to include the UX-series for completeness.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned: `src/registry/request-log.ts`, `src/cli/config.ts`, `src/gateway/server.ts`, `src/registry/server.ts`, `hub/src/hooks/useAuth.ts`, `hub/src/hooks/useRequests.ts`, `hub/src/hooks/useOwnerCards.ts`, `hub/src/components/OwnerDashboard.tsx`, `hub/src/components/SharePage.tsx`, `hub/src/components/RequestHistory.tsx`, `hub/src/components/AuthGate.tsx`, `hub/src/App.tsx`.

No TODO/FIXME/placeholder patterns found in functional code. `placeholder` keyword appears only as HTML input attribute (correct usage) and in SkeletonCard comment (correct component description). No empty return stubs. No console.log-only implementations.

### Human Verification Required

#### 1. My Agent Dashboard — Credit Balance, Period Counts, and Low-Credit Badge

**Test:** Run `agentbnb init`, then `agentbnb serve`. Open http://localhost:7701/hub/ in a browser. Click "My Agent" tab. Paste the `api_key` from `~/.agentbnb/config.json` into the API key field and click Connect.
**Expected:** Dashboard renders with owner name, published card count, online count, credit balance. Three period-count rows (24h / 7d / 30d) display. If balance < 10, a red "Low credits — N remaining" badge appears inline next to the balance.
**Why human:** React state updates, Tailwind badge visibility, and conditional rendering cannot be confirmed without a live browser.

#### 2. Mobile Responsive Layout (375px width)

**Test:** With the Hub open in a browser, use DevTools to resize to 375px width. Navigate through all three tabs (Discover, Share, My Agent).
**Expected:** No horizontal overflow. Stats grid shows 2 columns (`grid-cols-2`). The published cards list and request history stack into a single column (`grid-cols-1 lg:grid-cols-2` collapses). All interactive elements remain tappable.
**Why human:** CSS responsive breakpoints require visual inspection in a real browser viewport.

#### 3. Share Tab — Server Unreachable State

**Test:** Stop `agentbnb serve` if running. Open the Hub and click the "Share" tab.
**Expected:** After approximately 2 seconds, the "Server Not Running" block appears with a red indicator dot and the `agentbnb serve` command block ready to copy.
**Why human:** Depends on real-network AbortController timeout behavior in a browser (not testable via fetch mocks in Vitest).

#### 4. Share Tab — Draft Card Preview and Publish Flow

**Test:** Set `OPENAI_API_KEY=sk-...` in the environment where `agentbnb serve` runs. Start the server. Open the Hub, click Share tab, log in with API key.
**Expected:** One or more draft card forms appear (pre-populated name, description, credits_per_call). Edit a field. Click Publish. Card is published to the local registry and "Published" status appears on the button.
**Why human:** Requires real env var detection by `detectApiKeys`, live `/draft` endpoint response, and multi-step user interaction flow.

### Gaps Summary

No automated gaps found. All 14 must-haves verified at all three levels (exists, substantive, wired). 238 backend tests and 64 hub tests pass. TypeScript clean (no type errors per 03-03b-SUMMARY.md). The 4 human verification items above are the only remaining checks before the phase can be fully signed off.

**Administrative note:** UX-01 through UX-14 requirements are defined only in `03-RESEARCH.md`, not in `.planning/REQUIREMENTS.md`. This does not block the phase goal but should be addressed to keep the requirements document authoritative.

---

_Verified: 2026-03-15T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
