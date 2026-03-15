---
phase: 03-ux-layer
plan: 03b
type: execute
wave: 4
depends_on: ["03-03a"]
files_modified:
  - hub/src/components/OwnerDashboard.tsx
  - hub/src/components/OwnerDashboard.test.tsx
  - hub/src/components/SharePage.tsx
  - hub/src/components/SharePage.test.tsx
  - hub/src/components/RequestHistory.tsx
  - hub/src/components/RequestHistory.test.tsx
  - hub/src/App.tsx
  - hub/vite.config.ts
autonomous: false
requirements: [UX-11, UX-12, UX-13, UX-14]

must_haves:
  truths:
    - "Owner dashboard shows published cards, credit balance, request history, and low-credit badge"
    - "Dashboard shows per-period request counts (24h/7d/30d)"
    - "Share page pulls draft card from Phase 2.1 auto-detect and shows editable preview"
    - "Share page shows setup instructions when local server not running"
    - "Hub is responsive on mobile (375px+)"
  artifacts:
    - path: "hub/src/components/OwnerDashboard.tsx"
      provides: "My Agent tab with cards, credits, requests, metrics, period counts"
    - path: "hub/src/components/SharePage.tsx"
      provides: "One-click sharing page fetching /draft for editable preview"
    - path: "hub/src/components/RequestHistory.tsx"
      provides: "Request history table component"
    - path: "hub/src/App.tsx"
      provides: "Tab navigation: Discover | Share | My Agent"
  key_links:
    - from: "hub/src/components/OwnerDashboard.tsx"
      to: "/requests?since=24h"
      via: "useRequests hook with period param"
      pattern: "useRequests.*24h"
    - from: "hub/src/components/OwnerDashboard.tsx"
      to: "useOwnerCards"
      via: "extracts balance for low-credit badge"
      pattern: "balance.*<.*10"
    - from: "hub/src/components/SharePage.tsx"
      to: "/draft"
      via: "fetch with Authorization header on mount"
      pattern: "fetch.*draft"
    - from: "hub/src/App.tsx"
      to: "hub/src/components/AuthGate.tsx"
      via: "AuthGate wraps owner-only tabs"
      pattern: "AuthGate"
---

<objective>
Build the Hub frontend pages and wire tab navigation: OwnerDashboard (with credit balance, per-period request counts, low-credit badge), SharePage (fetching /draft for editable preview per CONTEXT.md locked decision), RequestHistory, and App.tsx tab wiring.

Purpose: Non-technical users can monitor and manage their agent capabilities via the Hub browser UI.
Output: 3 page components, tab navigation in App.tsx, human verification.
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
@.planning/phases/03-ux-layer/03-03a-SUMMARY.md

<interfaces>
<!-- From Plan 03a outputs -->

From hub/src/hooks/useAuth.ts:
```typescript
export function useAuth(): {
  apiKey: string | null;
  login: (key: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}
```

From hub/src/hooks/useRequests.ts:
```typescript
export function useRequests(apiKey: string | null, since?: '24h' | '7d' | '30d'): {
  requests: RequestLogEntry[];
  loading: boolean;
  error: string | null;
}
```

From hub/src/hooks/useOwnerCards.ts:
```typescript
export function useOwnerCards(apiKey: string | null): {
  ownerName: string | null;
  cards: CapabilityCard[];
  balance: number | null;
  loading: boolean;
  error: string | null;
}
```

From hub/src/components/AuthGate.tsx:
```typescript
export function AuthGate(props: { children: ReactNode; apiKey: string | null; onLogin: (key: string) => void }): JSX.Element;
```

Backend endpoints:
```
GET /draft       -> { cards: CapabilityCard[] }  (auth-protected)
POST /cards/:id/toggle-online -> { ok: true, online: boolean }
```

From hub/src/App.tsx (existing structure):
```typescript
export default function App() {
  const { cards, loading, error, ... } = useCards();
  // Renders StatsBar, SearchFilter, CardGrid/SkeletonCard/EmptyState/ErrorState
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Dashboard, Share page, Request history + App.tsx tab wiring</name>
  <files>hub/src/components/OwnerDashboard.tsx, hub/src/components/OwnerDashboard.test.tsx, hub/src/components/SharePage.tsx, hub/src/components/SharePage.test.tsx, hub/src/components/RequestHistory.tsx, hub/src/components/RequestHistory.test.tsx, hub/src/App.tsx, hub/vite.config.ts</files>
  <behavior>
    - Test: OwnerDashboard shows owner name, published cards count, and request history
    - Test: OwnerDashboard shows "Low credits" badge when balance < 10
    - Test: OwnerDashboard does not show credit badge when balance >= 10
    - Test: OwnerDashboard shows per-period request counts (24h/7d/30d tabs or display)
    - Test: RequestHistory renders table rows with card name, status, latency, credits, time
    - Test: RequestHistory shows empty state when no requests
    - Test: SharePage fetches /draft on mount and shows editable card preview
    - Test: SharePage shows "Run agentbnb serve first" when local server unreachable
    - Test: SharePage publish button calls POST /cards with edited card data
    - Test: App.tsx renders tab navigation with Discover, Share, My Agent tabs
    - Test: Clicking "My Agent" tab shows AuthGate
  </behavior>
  <action>
    1. Create `hub/src/components/RequestHistory.tsx`:
       - Receives `requests: RequestLogEntry[]` as prop
       - Renders a table with columns: Card Name, Status, Latency, Credits, Time
       - Status badge: green for success, red for failure, yellow for timeout
       - Empty state: "No requests yet" message
       - Tailwind styled: dark table matching Hub theme

    2. Create `hub/src/components/OwnerDashboard.tsx`:
       - Uses `useOwnerCards(apiKey)` and `useRequests(apiKey)` hooks
       - Sections:
         a. Header: "My Agent" + owner name
         b. Stats row: published cards count, online count, total credits earned (sum from requests)
         c. Credit balance display: show balance from useOwnerCards. If balance < 10, show inline red badge "Low credits -- N remaining" (per CONTEXT.md: "credit low threshold at < 10 credits, surface as inline badge")
         d. Per-period request counts: call useRequests with '24h', '7d', '30d' (3 separate hook calls or a single request fetching all periods). Display as "24h: N | 7d: N | 30d: N" in the stats row
         e. Cards list: each card shows name, level, online status, success_rate, avg_latency_ms. Toggle online button (calls POST /cards/:id/toggle-online with auth header)
         f. Request history: renders RequestHistory component with last 10 requests
       - Responsive: single column on mobile (sm:), two columns on desktop (lg:)
       - Receives `apiKey` as prop

    3. Create `hub/src/components/SharePage.tsx`:
       - On mount, calls `fetch('/health')` with 2s timeout (AbortController) to detect local server
       - If /health succeeds AND apiKey is present:
         - Fetch `GET /draft` with auth header to get draft cards from Phase 2.1 auto-detect
         - Display each draft card as an editable preview form: name, description, credits_per_call fields (pre-populated from draft)
         - "Publish" button sends card data to `POST /cards` (uses existing publish endpoint or calls the registry directly)
         - Per CONTEXT.md locked decision: "pulls draft card from auto-detect in Phase 2.1, shows editable preview, clicks Publish -> published to local SQLite registry"
       - If /health succeeds but no apiKey: show cards in read-only mode with prompt to log in
       - If /health fails: show "Server Not Running" block with copy-paste command: `agentbnb serve`
       - Receives `apiKey` as prop for auth-protected operations

    4. Update `hub/src/App.tsx`:
       - Add `activeTab` state: `'discover' | 'share' | 'status'`
       - Add tab navigation bar above existing content with Tailwind styling:
         - Discover (default), Share, My Agent tabs
         - Active tab: border-b-2 border-emerald-400 text-emerald-400
         - Inactive: text-slate-400 hover:text-slate-300
       - Import useAuth hook at App level. Pass apiKey down to tabs that need it.
       - Discover tab: render existing browse content (current App.tsx body)
       - Share tab: render SharePage with apiKey
       - My Agent tab: render AuthGate wrapping OwnerDashboard
       - Add logout button in top-right when authenticated (small "Disconnect" link)

    5. Update `hub/vite.config.ts` proxy to add `/me`, `/requests`, and `/draft`:
       ```
       proxy: {
         '/cards': 'http://localhost:7701',
         '/health': 'http://localhost:7701',
         '/me': 'http://localhost:7701',
         '/requests': 'http://localhost:7701',
         '/draft': 'http://localhost:7701',
       }
       ```

    6. Write co-located tests for all new components. Mock fetch for SharePage server detection and /draft response. Mock useRequests/useOwnerCards return values for OwnerDashboard tests.
  </action>
  <verify>
    <automated>cd /Users/leyufounder/Documents/Github/agentbnb/hub && pnpm test -- --run</automated>
  </verify>
  <done>OwnerDashboard shows credit balance + low-credit badge + per-period counts. SharePage fetches /draft for editable preview per CONTEXT.md decision. App.tsx has tab navigation. Vite proxy updated. All hub tests pass.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Human verification of complete UX Layer</name>
  <files>n/a</files>
  <action>Human verifies the full Phase 3 UX Layer end-to-end: tab navigation, auth flow, dashboard with balance and period counts, share page with draft card preview, and mobile responsiveness.</action>
  <verify>Human confirms all verification steps pass.</verify>
  <done>Phase 3 UX Layer approved by human.</done>
  <what-built>Complete Phase 3 UX Layer: tab-based Hub with Discover (existing), Share (draft card preview from auto-detect), and My Agent (auth dashboard with credit balance, per-period request counts, low-credit badge, and request history). Backend: API key auth, request logging with period filtering, 5 owner endpoints including /draft.</what-built>
  <how-to-verify>
    1. Start the server: `cd /Users/leyufounder/Documents/Github/agentbnb && agentbnb init` (verify api_key appears in ~/.agentbnb/config.json)
    2. Publish a test card: `agentbnb publish test/fixtures/card.json` (or any valid card)
    3. Start serving: `agentbnb serve`
    4. Visit http://localhost:7701/hub/ in browser
    5. Verify "Discover" tab shows existing cards (existing functionality preserved)
    6. Click "Share" tab -- should show "Server Running" status. If API keys are set in env (OPENAI_API_KEY etc.), should show draft card preview with editable fields
    7. Click "My Agent" tab -- should show LoginForm with API key input
    8. Copy api_key from ~/.agentbnb/config.json, paste into login form, click Connect
    9. Verify dashboard shows: your published cards, credit balance, online/offline status, request history (likely empty), per-period counts (24h/7d/30d)
    10. Verify low-credit badge appears if balance < 10
    11. Verify mobile layout: resize to 375px width, check layout doesn't break
    12. Run full test suite: `pnpm vitest run && cd hub && pnpm test`
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
```bash
cd /Users/leyufounder/Documents/Github/agentbnb && pnpm vitest run && cd hub && pnpm test -- --run && npx tsc --noEmit
```
All backend and frontend tests pass. No type errors.
</verification>

<success_criteria>
- Hub has 3 tabs: Discover (existing), Share, My Agent
- Dashboard shows credit balance from /me endpoint
- Dashboard shows per-period request counts (24h/7d/30d)
- Low-credit badge shown when balance < 10
- Share page fetches /draft and shows editable card preview (per CONTEXT.md locked decision)
- Share page shows setup instructions when server not running
- All tests pass (backend + hub)
- Responsive layout on mobile
</success_criteria>

<output>
After completion, create `.planning/phases/03-ux-layer/03-03b-SUMMARY.md`
</output>
