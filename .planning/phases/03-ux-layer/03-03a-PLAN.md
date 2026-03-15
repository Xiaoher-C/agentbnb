---
phase: 03-ux-layer
plan: 03a
type: execute
wave: 3
depends_on: ["03-02"]
files_modified:
  - hub/src/hooks/useAuth.ts
  - hub/src/hooks/useAuth.test.ts
  - hub/src/hooks/useRequests.ts
  - hub/src/hooks/useRequests.test.ts
  - hub/src/hooks/useOwnerCards.ts
  - hub/src/hooks/useOwnerCards.test.ts
  - hub/src/components/AuthGate.tsx
  - hub/src/components/AuthGate.test.tsx
  - hub/src/components/LoginForm.tsx
  - hub/src/components/LoginForm.test.tsx
autonomous: true
requirements: [UX-09, UX-10]

must_haves:
  truths:
    - "Owner can paste API key to log in and see authenticated state"
    - "useOwnerCards fetches credit balance from GET /me response"
    - "useRequests supports period filtering via since parameter"
  artifacts:
    - path: "hub/src/hooks/useAuth.ts"
      provides: "localStorage-backed API key auth hook"
      exports: ["useAuth"]
    - path: "hub/src/hooks/useRequests.ts"
      provides: "30s polling for auth-protected /requests endpoint with since param"
      exports: ["useRequests"]
    - path: "hub/src/hooks/useOwnerCards.ts"
      provides: "Fetches owner cards and credit balance from /me"
      exports: ["useOwnerCards"]
    - path: "hub/src/components/AuthGate.tsx"
      provides: "Wrapper showing LoginForm or children based on auth state"
    - path: "hub/src/components/LoginForm.tsx"
      provides: "API key input form"
  key_links:
    - from: "hub/src/hooks/useOwnerCards.ts"
      to: "/me"
      via: "fetch with Authorization header, extracts balance"
      pattern: "balance"
    - from: "hub/src/hooks/useRequests.ts"
      to: "/requests"
      via: "fetch with Authorization header and since param"
      pattern: "since"
---

<objective>
Build the Hub frontend auth layer: hooks (useAuth, useRequests, useOwnerCards) and auth components (AuthGate, LoginForm). Hooks correctly extract credit balance from /me and support period filtering on /requests.

Purpose: Plan 03b (dashboard, share page, app wiring) depends on these hooks and components being available.
Output: 3 custom hooks and 2 auth components, all tested.
</objective>

<execution_context>
@/Users/leyufounder/.claude/get-shit-done/workflows/execute-plan.md
@/Users/leyufounder/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-ux-layer/03-CONTEXT.md
@.planning/phases/03-ux-layer/03-RESEARCH.md
@.planning/phases/03-ux-layer/03-01-SUMMARY.md
@.planning/phases/03-ux-layer/03-02-SUMMARY.md

<interfaces>
<!-- Backend endpoints from Plan 02 -->

Auth-protected endpoints (require Bearer <api_key> header):
```
GET /me          -> { owner: string, balance: number }
GET /requests    -> { items: RequestLogEntry[], limit: number }
GET /requests?since=24h  -> filtered by period
GET /draft       -> { cards: CapabilityCard[] }
POST /cards/:id/toggle-online -> { ok: true, online: boolean }
PATCH /cards/:id -> { ok: true }
```

Public endpoints (no auth):
```
GET /cards       -> { total, limit, offset, items: CapabilityCard[] }
GET /health      -> { status: 'ok' }
```

From src/registry/request-log.ts:
```typescript
export type SincePeriod = '24h' | '7d' | '30d';
export interface RequestLogEntry {
  id: string;
  card_id: string;
  card_name: string;
  requester: string;
  status: 'success' | 'failure' | 'timeout';
  latency_ms: number;
  credits_charged: number;
  created_at: string;
}
```

From hub/src/hooks/useCards.ts (existing pattern to replicate):
```typescript
export function useCards() {
  // 30s polling, returns { cards, loading, error, query, setQuery, level, setLevel, ... }
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Auth hooks (useAuth, useRequests with since, useOwnerCards with balance)</name>
  <files>hub/src/hooks/useAuth.ts, hub/src/hooks/useAuth.test.ts, hub/src/hooks/useRequests.ts, hub/src/hooks/useRequests.test.ts, hub/src/hooks/useOwnerCards.ts, hub/src/hooks/useOwnerCards.test.ts</files>
  <behavior>
    - Test: useAuth() reads api_key from localStorage on mount
    - Test: useAuth().login(key) stores key in localStorage and updates state
    - Test: useAuth().logout() removes key from localStorage and sets null
    - Test: useAuth().isAuthenticated returns true when key present, false when null
    - Test: useRequests(apiKey) fetches /requests with Authorization header
    - Test: useRequests(apiKey, '24h') fetches /requests?since=24h
    - Test: useRequests(null) does not fetch (returns empty)
    - Test: useRequests handles 401 by setting error state
    - Test: useOwnerCards(apiKey) fetches /me and extracts owner name AND balance
    - Test: useOwnerCards(apiKey) fetches /cards and filters by owner name
    - Test: useOwnerCards returns balance as number from /me response (NOT null)
    - Test: useOwnerCards(null) does not fetch
  </behavior>
  <action>
    1. Create `hub/src/hooks/useAuth.ts`:
       - `STORAGE_KEY = 'agentbnb_api_key'`
       - `useAuth()` returns `{ apiKey, login, logout, isAuthenticated }`
       - `login(key)` writes to localStorage and updates useState
       - `logout()` removes from localStorage and sets null
       - Initial state reads from `localStorage.getItem(STORAGE_KEY)`

    2. Create `hub/src/hooks/useRequests.ts`:
       - `useRequests(apiKey: string | null, since?: '24h' | '7d' | '30d')` returns `{ requests, loading, error }`
       - Mirrors useCards() 30s polling pattern exactly
       - Fetches `/requests?limit=10` with `Authorization: Bearer ${apiKey}` header
       - When `since` is provided, append `&since=${since}` to the URL
       - On 401, sets error to 'Invalid API key'
       - When apiKey is null, skips fetch, returns empty array

    3. Create `hub/src/hooks/useOwnerCards.ts`:
       - `useOwnerCards(apiKey: string | null)` returns `{ ownerName, cards, balance, loading, error }`
       - Fetches `/me` with auth header to get owner name AND credit balance
       - `balance` is extracted from the /me response `{ owner, balance }` — NOT set to null
       - Fetches `/cards` (public) and filters client-side by owner name
       - No 30s polling needed — cards change infrequently

    4. Write co-located test files for all hooks using @testing-library/react. Use `vi.stubGlobal('fetch', ...)` for fetch mocks. Use `vi.spyOn(Storage.prototype, ...)` for localStorage mocks.
  </action>
  <verify>
    <automated>cd /Users/leyufounder/Documents/Github/agentbnb/hub && pnpm test -- --run</automated>
  </verify>
  <done>useAuth, useRequests (with since support), useOwnerCards (with balance from /me) hooks tested and working.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Auth gate components (AuthGate, LoginForm)</name>
  <files>hub/src/components/AuthGate.tsx, hub/src/components/AuthGate.test.tsx, hub/src/components/LoginForm.tsx, hub/src/components/LoginForm.test.tsx</files>
  <behavior>
    - Test: AuthGate renders children when useAuth().isAuthenticated is true
    - Test: AuthGate renders LoginForm when useAuth().isAuthenticated is false
    - Test: LoginForm has an input field for API key and a submit button
    - Test: LoginForm calls onLogin with the entered key on submit
  </behavior>
  <action>
    1. Create `hub/src/components/LoginForm.tsx`:
       - Single input field (type text, monospace font, placeholder "Paste your API key")
       - Submit button "Connect"
       - Calls `onLogin(key)` prop on form submit
       - Styled with Tailwind: dark theme matching existing Hub aesthetic (slate-800 bg, emerald accents)

    2. Create `hub/src/components/AuthGate.tsx`:
       - Props: `{ children, apiKey, onLogin }`
       - If apiKey is null/undefined, render LoginForm with onLogin
       - If apiKey present, render children

    3. Write co-located test files using @testing-library/react.
  </action>
  <verify>
    <automated>cd /Users/leyufounder/Documents/Github/agentbnb/hub && pnpm test -- --run</automated>
  </verify>
  <done>AuthGate and LoginForm components render correctly based on auth state. All hub tests pass.</done>
</task>

</tasks>

<verification>
```bash
cd /Users/leyufounder/Documents/Github/agentbnb/hub && pnpm test -- --run
```
All hub tests pass including new hook and component tests.
</verification>

<success_criteria>
- useAuth manages API key in localStorage
- useRequests fetches with auth header and supports since param
- useOwnerCards extracts credit balance from /me response (not null)
- AuthGate shows LoginForm when unauthenticated, children when authenticated
- All hub tests pass
</success_criteria>

<output>
After completion, create `.planning/phases/03-ux-layer/03-03a-SUMMARY.md`
</output>
