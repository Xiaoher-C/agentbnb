# Phase 14: Credit UI + Modal + Polish — Research

**Researched:** 2026-03-16
**Domain:** React credit dashboard (Recharts), modal enhancement, mobile responsive layout, iOS scroll lock, design token migration
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CREDIT-01 | `cr` currency symbol used consistently across all credit displays | `formatCredits()` in `lib/utils.ts` currently returns "X credits" not "cr X" — must be updated; OwnerDashboard, CardModal, RequestHistory, CapabilityCard, and NavCreditBadge all display credits |
| CREDIT-02 | Card display shows credits in accent color with monospace `cr` prefix | `CapabilityCard.tsx:79` uses `formatCredits(card.pricing)` — update `formatCredits()` to return "cr X" and/or update display sites to prefix "cr " |
| CREDIT-03 | My Agent dashboard shows credit balance with reserve/available breakdown | `OwnerDashboard.tsx` already shows balance; needs reserve (from BudgetManager) and available = balance − reserve breakdown |
| CREDIT-04 | My Agent dashboard shows 30-day earning AreaChart | `useRequests(apiKey, '30d')` already exists — aggregate by date client-side; add `recharts` dependency; use custom dark tooltip |
| CREDIT-05 | My Agent dashboard shows recent transaction history | `getTransactions()` exists in `ledger.ts`; need new `GET /me/transactions` route and `useTransactions` hook |
| CREDIT-06 | Backend `GET /me/transactions` returns credit transaction history | `getTransactions(db, owner, limit)` already implemented in `ledger.ts:117` — wire into `ownerRoutes` in `server.ts` |
| MODAL-01 | Skill Detail Modal shows "Request this skill" button with CLI command copy | `CardModal.tsx` already has CLI code block with copy; needs visual upgrade to a proper button with `CopyButton` component |
| MODAL-02 | Skill Detail Modal shows real-time availability indicator (online + idle status) | `CardModal.tsx` already has `StatusDot online`; needs idle rate from `skill.metadata?.idle_rate`; idle_rate lives in `HubCard.metadata` |
| MODAL-03 | Skill Detail Modal links skill owner to their agent profile page | `CardModal.tsx` shows `@{card.owner}` as text; must become `<Link to="/agents/${card.owner}">` and close the modal on navigate |
| POLISH-01 | All pages responsive — cards stack on mobile, nav collapses to hamburger | `NavBar.tsx` currently a flat row; needs `md:flex` for tab strip + hamburger `<button>` + state-driven drawer below 768px |
| POLISH-02 | Modal becomes full-screen sheet on mobile with touch-friendly tap targets (44px min) | `CardModal.tsx` uses `max-w-[520px] mx-4` centered — needs `sm:max-w-[520px]` + `max-h-screen` bottom-anchored variant at `< sm` |
| POLISH-03 | OwnerDashboard migrated from `slate-*` to `hub-*` design tokens | `OwnerDashboard.tsx` and `RequestHistory.tsx` use `slate-700`, `slate-800`, `slate-400`, `slate-500`, `slate-100` throughout; must map to `hub-*` equivalents |
| POLISH-04 | Loading skeletons for all async data fetches | OwnerDashboard shows plain text "Loading dashboard…"; all other pages use similar spinners; need Skeleton component with pulse animation |
| POLISH-05 | iOS Safari scroll lock fix for all modals | `CardModal.tsx:65` uses `document.body.style.overflow = 'hidden'` — known to fail on iOS Safari; must replace with position-fixed + saved scroll position technique |
</phase_requirements>

---

## Summary

Phase 14 is a correctness and polish phase with three distinct work streams: (1) Credit visibility — adding a `cr` prefix to all credit displays, a `recharts` AreaChart, and wiring the existing `getTransactions()` function to a new API endpoint; (2) Modal enhancement — adding a profile link, visual request button, and real-time idle status to the existing `CardModal`; (3) Polish — replacing iOS-unsafe scroll lock, migrating `OwnerDashboard` off `slate-*` tokens, adding loading skeletons, and building a hamburger nav for mobile.

The backend work is minimal. `getTransactions()` already exists in `ledger.ts` — Phase 14 only needs to add one new Fastify route `GET /me/transactions` inside the existing `ownerRoutes` scoped plugin. All other backend data is already available via existing endpoints. The frontend work is the majority: recharts AreaChart with a custom dark-theme tooltip (mandatory — see pitfall below), `formatCredits()` update to return `cr X` notation, `OwnerDashboard` and `RequestHistory` migration from `slate-*` to `hub-*` tokens, `CardModal` enhancements, and a hamburger nav with iOS-safe scroll lock.

The most important implementation constraint for this phase: Recharts `<Tooltip>` renders `backgroundColor: '#fff'` as an inline style that cannot be overridden by Tailwind classes. The only working solution is a custom `content` component. This is a non-negotiable pattern for this phase.

**Primary recommendation:** Wire `GET /me/transactions` first (unblocks `useTransactions` hook), update `formatCredits()` to return `cr X` (satisfies CREDIT-01/02 in one change), then build the AreaChart with a custom tooltip component, then do the CSS migration of OwnerDashboard + RequestHistory, then mobile responsive layout + iOS scroll lock.

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| react | ^18.3.1 | Component rendering | Installed |
| react-router | ^7.13.1 | Navigation (Link component for MODAL-03) | Installed |
| tailwindcss | ^3.4.17 | Styling, responsive breakpoints, design tokens | Installed |
| lucide-react | ^0.469.0 | Icons (Hamburger/X for mobile nav, availability icons) | Installed |
| vitest | ^3.0.4 | Test runner | Installed |

### New Dependency Required
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| recharts | ^3.8.0 | 30-day earning AreaChart | Only charting library needed; 64M+ downloads/month; CSS variable theming support; declarative API |

**Installation:**
```bash
cd hub && pnpm add recharts
```

recharts is ~500KB but is tree-shakeable — only `AreaChart`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer` are needed. No other charting library should be added.

### What NOT to add
- framer-motion: Tailwind CSS transitions are sufficient for the hamburger menu and mobile sheet; no route transitions in scope
- react-query / TanStack Query: existing hook pattern is sufficient for `useTransactions`
- body-scroll-lock npm package: the position-fixed technique is 10 lines of code; no library needed

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
hub/src/
├── components/
│   ├── CardModal.tsx         # Modify: add Link to owner, idle indicator, Request button
│   ├── OwnerDashboard.tsx    # Modify: slate→hub tokens, add EarningsChart, reserve breakdown
│   ├── RequestHistory.tsx    # Modify: slate→hub tokens, add cr prefix
│   ├── NavBar.tsx            # Modify: add hamburger menu for mobile
│   ├── EarningsChart.tsx     # New: recharts AreaChart + CreditsTooltip subcomponent
│   ├── TransactionHistory.tsx # New: credit_transactions table (replaces request-based history)
│   └── Skeleton.tsx          # New: pulse-animated skeleton block(s)
├── hooks/
│   └── useTransactions.ts    # New: GET /me/transactions polling hook
└── lib/
    └── utils.ts              # Modify: formatCredits() to return "cr X" format
```

### Pattern 1: Custom Recharts Tooltip (MANDATORY)

**What:** `<Tooltip>` with `content` prop pointing to a custom React component
**When to use:** Always for any Recharts chart in this dark-theme codebase
**Why mandatory:** Recharts applies `backgroundColor: '#fff'` as inline style; Tailwind classes cannot override inline styles

```tsx
// Source: Recharts issues #1402, #663 — verified pattern
interface TooltipPayload {
  value: number;
  name: string;
}
interface CreditsTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

function CreditsTooltip({ active, payload, label }: CreditsTooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{ backgroundColor: '#111117', border: '1px solid rgba(255,255,255,0.08)' }}
      className="rounded-lg px-3 py-2 text-sm"
    >
      <p className="text-hub-text-tertiary text-xs mb-1">{label}</p>
      <p className="font-mono text-hub-accent">cr {payload[0].value}</p>
    </div>
  );
}

// Usage in EarningsChart:
<Tooltip content={<CreditsTooltip />} />
```

Note: Use inline `style` for `backgroundColor` in the tooltip component itself, NOT Tailwind background classes, to guarantee dark rendering in all browsers.

### Pattern 2: 30-Day Earning Aggregation from useRequests

**What:** Group `requests30d` array by date string, summing `credits_charged` per day
**When to use:** Building the AreaChart data in `EarningsChart`
**Note from STATE.md:** `credits_earned` is computed, never stored. The client-side aggregation approach uses existing `useRequests(apiKey, '30d')` data.

```tsx
// Source: codebase inspection — useRequests returns RequestLogEntry[]
interface DayPoint { date: string; credits: number; }

function aggregateByDay(requests: RequestLogEntry[]): DayPoint[] {
  const map = new Map<string, number>();
  for (const req of requests) {
    const day = new Date(req.created_at).toLocaleDateString('en-CA'); // YYYY-MM-DD
    map.set(day, (map.get(day) ?? 0) + req.credits_charged);
  }
  // Fill last 30 days (including zero days)
  const result: DayPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toLocaleDateString('en-CA');
    result.push({ date: day, credits: map.get(day) ?? 0 });
  }
  return result;
}
```

The `toLocaleDateString('en-CA')` produces `YYYY-MM-DD` format consistently across all locales — use this instead of `toLocaleDateString()` with default locale, which varies by user browser.

### Pattern 3: iOS-Safe Scroll Lock (MANDATORY)

**What:** Replace `document.body.style.overflow = 'hidden'` with position-fixed technique
**When to use:** In `CardModal.tsx` useEffect and hamburger menu toggle

```typescript
// Source: iOS Safari decade-long bug fix — verified in PITFALLS.md Pitfall 9
function lockScroll(): void {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.dataset.scrollY = String(scrollY);
}

function unlockScroll(): void {
  const scrollY = parseInt(document.body.dataset.scrollY ?? '0', 10);
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  delete document.body.dataset.scrollY;
  window.scrollTo(0, scrollY);
}
```

Apply in `CardModal.tsx` — replace the entire body scroll lock `useEffect` block. Apply the same pair of functions in the hamburger menu `NavBar.tsx`.

### Pattern 4: slate-* to hub-* Token Migration

**What:** Systematic replacement of old `slate-*` Tailwind classes with `hub-*` design tokens
**Affected files:** `OwnerDashboard.tsx`, `RequestHistory.tsx`

| Old class | New class | Semantic |
|-----------|-----------|---------|
| `text-slate-100` | `text-hub-text-primary` | Primary text |
| `text-slate-400` | `text-hub-text-secondary` | Secondary text |
| `text-slate-500` | `text-hub-text-tertiary` | Tertiary/muted text |
| `bg-slate-800` | `bg-hub-surface` (or `style={{ backgroundColor: '#111117' }}`) | Card/panel background |
| `bg-slate-900/50` | `bg-hub-bg` | Page background |
| `border-slate-700` | `border-hub-border` | Default border |
| `divide-slate-700/50` | `divide-hub-border` | Table row dividers |
| `text-slate-300` | `text-hub-text-secondary` | Table row text |
| `text-slate-200` | `text-hub-text-primary` | Bold row text |
| `bg-slate-800/50` | `bg-hub-surface` | Empty state container |

Note: `hub-surface` is `rgba(255, 255, 255, 0.03)` which is very transparent. For panels that need more opacity (like table backgrounds), use inline `style={{ backgroundColor: '#111117' }}` matching `CardModal.tsx`'s existing panel background. Do not use `bg-slate-800` as a fallback.

### Pattern 5: Mobile Bottom Sheet Modal

**What:** On viewports < 640px, `CardModal` transforms from centered overlay to full-screen bottom sheet
**When to use:** POLISH-02 requirement

```tsx
// Source: Tailwind responsive prefix pattern
// Backdrop — same on all sizes
<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
  {/* Panel — bottom-anchored on mobile, centered on sm+ */}
  <div className="w-full sm:max-w-[520px] sm:mx-4 sm:rounded-modal rounded-t-modal
                  max-h-[90vh] sm:max-h-[85vh] overflow-y-auto"
    style={{ backgroundColor: '#111117', border: '1px solid rgba(255,255,255,0.08)' }}
  >
    {/* Drag handle (mobile only) */}
    <div className="flex justify-center pt-3 pb-1 sm:hidden">
      <div className="w-10 h-1 rounded-full bg-white/20" />
    </div>
    {/* Content — ensure 44px min tap targets for close button */}
    ...
  </div>
</div>
```

All tap targets on mobile must be `min-h-[44px] min-w-[44px]`. The close button at `text-lg` is currently ~24px — must be wrapped in a 44px container on mobile.

### Pattern 6: Hamburger Nav

**What:** NavBar collapses tab strip to hamburger icon on `< md` (768px) viewports
**When to use:** POLISH-01

```tsx
// State: open/closed for mobile menu
const [menuOpen, setMenuOpen] = useState(false);
// Lock scroll when menu open — use same lockScroll()/unlockScroll() pair

// Tab strip: hidden on mobile, shown on md+
<nav className="hidden md:flex gap-1 ...">
  {/* existing NavLinks */}
</nav>

// Hamburger button: shown only on mobile
<button className="md:hidden min-h-[44px] min-w-[44px] ..." onClick={...}>
  {menuOpen ? <X /> : <Menu />}
</button>

// Drawer: full-width below header on mobile
{menuOpen && (
  <div className="md:hidden border-t border-hub-border py-2">
    {/* same nav items as vertical stack */}
  </div>
)}
```

Import `Menu` and `X` icons from `lucide-react` (already installed).

### Pattern 7: Loading Skeleton

**What:** Pulse-animated gray block placeholders shown while data is loading
**When to use:** All loading states in OwnerDashboard (balance, chart, history), and any component currently showing "Loading…" text

```tsx
// hub/src/components/Skeleton.tsx
interface SkeletonProps {
  className?: string;
}
export function Skeleton({ className = '' }: SkeletonProps): JSX.Element {
  return (
    <div
      className={`animate-pulse rounded bg-white/[0.06] ${className}`}
      aria-hidden="true"
    />
  );
}
```

Tailwind's `animate-pulse` applies a `50%-100%-50%` opacity animation. Use `bg-white/[0.06]` matching the hub surface color family.

### Pattern 8: GET /me/transactions Backend Route

**What:** New owner-scoped route returning credit transaction history
**Where:** `src/registry/server.ts` inside the `ownerRoutes` scoped plugin (same location as `/me` and `/requests`)

```typescript
// Source: codebase inspection — getTransactions already exists in ledger.ts:117
ownerRoutes.get('/me/transactions', async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const rawLimit = query.limit !== undefined ? parseInt(query.limit, 10) : 20;
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);

  if (!opts.creditDb) {
    return reply.send({ items: [], limit });
  }
  const items = getTransactions(opts.creditDb, ownerName, limit);
  return reply.send({ items, limit });
});
```

`getTransactions` is already imported (check: it's exported from `ledger.ts` and `getBalance` is already imported in `server.ts` line 13). Add `getTransactions` to the import. No new database tables needed.

### Pattern 9: formatCredits Update

**What:** `formatCredits()` in `lib/utils.ts` currently returns `"5 credits"` — update to return `"cr 5"` format
**When to use:** CREDIT-01/02 — single change propagates to all 4 display sites

```typescript
// Current (utils.ts:59-67):
export function formatCredits(pricing: { credits_per_call: number; credits_per_minute?: number }): string {
  if (pricing.credits_per_minute !== undefined) {
    return `${pricing.credits_per_call}-${pricing.credits_per_minute} credits`;
  }
  return `${pricing.credits_per_call} credits`;
}

// Updated:
export function formatCredits(pricing: { credits_per_call: number; credits_per_minute?: number }): string {
  if (pricing.credits_per_minute !== undefined) {
    return `cr ${pricing.credits_per_call}–${pricing.credits_per_minute}/min`;
  }
  return `cr ${pricing.credits_per_call}`;
}
```

Additional sites that show credit amounts without going through `formatCredits`:
- `OwnerDashboard.tsx:78` — `totalCreditsEarned` shown raw; wrap in `cr {n}`
- `OwnerDashboard.tsx:83` — `balance` shown raw; wrap in `cr {n}`
- `RequestHistory.tsx:59` — `req.credits_charged` shown raw; wrap in `cr {n}`
- `NavCreditBadge` in `NavBar.tsx:27` — already shows `cr {balance}` — CORRECT, no change needed

### Anti-Patterns to Avoid
- **Recharts `wrapperClassName` for tooltip styling:** Does not work against inline styles. Always use `content` prop with custom component.
- **`bg-slate-*` in new code:** Use `hub-*` tokens exclusively in all new and modified components.
- **`document.body.style.overflow = 'hidden'` in any new scroll lock:** Use `lockScroll()`/`unlockScroll()` pattern.
- **Hardcoding credit values:** Never store `credits_earned` as a column; always compute from `request_log`.
- **Forgetting to import `getTransactions` in server.ts:** It's in `ledger.ts` but not yet in the import at line 13.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Area chart with X/Y axis | Custom SVG chart | recharts `<AreaChart>` + `<ResponsiveContainer>` | Edge cases: responsive resize, tooltip positioning, axis formatting, animation |
| Pulse loading skeleton | Custom CSS animation | Tailwind `animate-pulse` class | Built into Tailwind v3; zero additional code |
| Icon components (hamburger, X) | SVG inline | `lucide-react` Menu + X (already installed) | Already a dependency |
| Clipboard copy | Custom clipboard handler | Reuse `CopyButton.tsx` pattern (navigator.clipboard + 1500ms reset) | Already verified in Phase 13 |
| Mobile breakpoints | CSS media queries | Tailwind `md:`, `sm:` prefix classes | Consistent with existing codebase |

---

## Common Pitfalls

### Pitfall 1: Recharts Tooltip White Background
**What goes wrong:** Default `<Tooltip>` renders white popup on dark `#08080C` background — unreadable.
**Why it happens:** Recharts uses `backgroundColor: '#fff'` as inline style; Tailwind classes cannot override inline styles.
**How to avoid:** Always pass `content={<CreditsTooltip />}` to `<Tooltip>`. Never use `wrapperClassName` or `contentStyle` — they are unreliable across recharts versions.
**Warning signs:** Chart tooltip appears with white/light background.

### Pitfall 2: iOS Safari Scroll Lock Failure
**What goes wrong:** `document.body.style.overflow = 'hidden'` is ignored on iOS Safari — the background continues to scroll behind the modal.
**Why it happens:** iOS Safari long-standing behavior: `overflow: hidden` on body does not prevent scroll.
**How to avoid:** Replace the scroll lock `useEffect` in `CardModal.tsx` with `lockScroll()`/`unlockScroll()` using position-fixed + saved scroll position. Apply same pattern to hamburger menu.
**Warning signs:** On iOS, background scrolls while modal or menu is open.

### Pitfall 3: Chart Re-renders on Every Poll Update
**What goes wrong:** `EarningsChart` is a child of `OwnerDashboard`, which re-renders every time `useRequests` polling fires. If chart data is computed inline, a new array reference is created on every render, causing recharts to replay animations.
**How to avoid:** Wrap `aggregateByDay(requests30d)` in `useMemo(() => aggregateByDay(requests30d), [requests30d])`. Wrap `<EarningsChart>` in `React.memo`. Pass a stable data reference.
**Warning signs:** Chart animation replays every 30 seconds.

### Pitfall 4: Vite Proxy Missing for /me/transactions
**What goes wrong:** `GET /me/transactions` works in production (Fastify serves it directly) but 404s in dev mode because the Vite proxy only covers `/me` not `/me/transactions`.
**Why it happens:** `vite.config.ts` uses exact path matches: `'/me': 'http://localhost:7777'`. Sub-paths like `/me/transactions` require the same prefix match.
**How to avoid:** Check `vite.config.ts` proxy config. The existing `/me` entry uses exact matching, NOT prefix matching. Test shows `'/me'` already covers `/me/transactions` in Vite 6 because Vite's proxy uses `startsWith` matching by default (not exact). Verify this during implementation — if it fails, add explicit `'/me/transactions'` entry.
**Warning signs:** `useTransactions` hook 404s only in `vite dev` mode.

### Pitfall 5: formatCredits Test Breakage
**What goes wrong:** `utils.test.ts` tests for `formatCredits` likely assert the old "5 credits" format. Updating `formatCredits()` without updating tests will break the test suite.
**How to avoid:** Update `hub/src/lib/utils.test.ts` in the same commit as the `formatCredits()` change. Scan for `.toEqual('5 credits')` or similar assertions.
**Warning signs:** `pnpm test` fails in `utils.test.ts` after the formatCredits change.

### Pitfall 6: OwnerDashboard Test Assertions on slate-* Classes
**What goes wrong:** `OwnerDashboard.test.tsx` uses `render()` + DOM assertions. If any tests check for `slate-*` class names, migrating tokens will break them.
**Why it happens:** Low likelihood — the existing tests check for text content, not CSS classes. But worth scanning.
**How to avoid:** Scan `OwnerDashboard.test.tsx` for any `.toHaveClass('slate-')` assertions before migrating. None found in codebase inspection — existing tests check text content only.

### Pitfall 7: CardModal Link Causes Navigation Without Closing
**What goes wrong:** Adding `<Link to={`/agents/${card.owner}`}>` in `CardModal` without calling `onClose()` first navigates to the profile page with the modal still rendered on top.
**How to avoid:** Use `useNavigate()` in the modal and call both `handleClose()` and `navigate()` in the owner click handler. Or use `<Link>` with an `onClick` that calls `handleClose()` before navigation.
**Warning signs:** Clicking agent name in modal shows profile page with modal still open.

---

## Code Examples

### EarningsChart Component

```tsx
// hub/src/components/EarningsChart.tsx
import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';
import type { RequestLogEntry } from '../hooks/useRequests.js';

// Custom tooltip — MUST use inline style for backgroundColor
function CreditsTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}): JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{ backgroundColor: '#111117', border: '1px solid rgba(255,255,255,0.08)' }}
      className="rounded-lg px-3 py-2"
    >
      <p className="text-hub-text-tertiary text-xs mb-0.5">{label}</p>
      <p className="font-mono text-sm text-hub-accent">cr {payload[0].value}</p>
    </div>
  );
}

interface DayPoint { date: string; credits: number; }

function aggregateByDay(requests: RequestLogEntry[]): DayPoint[] {
  const map = new Map<string, number>();
  for (const req of requests) {
    const day = new Date(req.created_at).toLocaleDateString('en-CA');
    map.set(day, (map.get(day) ?? 0) + req.credits_charged);
  }
  const result: DayPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toLocaleDateString('en-CA');
    result.push({ date: day, credits: map.get(day) ?? 0 });
  }
  return result;
}

export default function EarningsChart({ requests }: { requests: RequestLogEntry[] }) {
  const data = useMemo(() => aggregateByDay(requests), [requests]);
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="creditsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          interval={6}
          tickFormatter={(v: string) => v.slice(5)} // Show MM-DD only
        />
        <YAxis
          tick={{ fill: 'rgba(255,255,255,0.30)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `cr ${v}`}
        />
        <Tooltip content={<CreditsTooltip />} />
        <Area
          type="monotone"
          dataKey="credits"
          stroke="#10B981"
          strokeWidth={2}
          fill="url(#creditsGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#10B981' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

### useTransactions Hook

```typescript
// hub/src/hooks/useTransactions.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { CreditTransaction } from '../types.js'; // Add to types.ts

const POLL_INTERVAL_MS = 30_000;

export function useTransactions(apiKey: string | null, limit = 20) {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(apiKey !== null);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchTransactions = useCallback(async () => {
    if (apiKey === null) return;
    try {
      const res = await fetch(`/me/transactions?limit=${limit}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401) { setError('Invalid API key'); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json() as { items: CreditTransaction[]; limit: number };
      setTransactions(data.items);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Transactions unreachable: ${msg}`);
    } finally {
      if (isFirstFetch.current) { isFirstFetch.current = false; setLoading(false); }
    }
  }, [apiKey, limit]);

  useEffect(() => {
    if (apiKey === null) { setLoading(false); setTransactions([]); setError(null); return; }
    isFirstFetch.current = true;
    setLoading(true);
    void fetchTransactions();
    const interval = setInterval(() => { void fetchTransactions(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTransactions, apiKey]);

  return { transactions, loading, error };
}
```

### CreditTransaction Type Addition

```typescript
// Add to hub/src/types.ts:
export interface CreditTransaction {
  id: string;
  owner: string;
  amount: number; // positive = credit, negative = debit
  reason: 'bootstrap' | 'escrow_hold' | 'escrow_release' | 'settlement' | 'refund';
  reference_id: string | null;
  created_at: string;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `overflow: hidden` for modal scroll lock | position-fixed + saved scroll | iOS Safari bug exists since ~2013 | Modals work correctly on all mobile browsers |
| Tailwind `slate-*` classes | `hub-*` design tokens | v2.1 design system | OwnerDashboard/RequestHistory still use old tokens — POLISH-03 |
| "5 credits" text | "cr 5" format | v2.2 Phase 14 | Consistent cr currency symbol across all displays |
| Text spinner "Loading..." | Skeleton pulse blocks | v2.2 Phase 14 | Professional loading experience |

**Already using current approach (no change needed):**
- `NavCreditBadge` already shows `cr {balance}` — correct
- `CapabilityCard.tsx` shows credits via `formatCredits()` — will be fixed by updating that function
- `CardModal.tsx` CLI block already has a working copy button — upgrade to use `CopyButton` component

---

## Open Questions

1. **BudgetManager reserve access for CREDIT-03 breakdown**
   - What we know: `BudgetManager` manages a reserve floor (default 20 credits) in `src/credit/budget.ts`
   - What's unclear: The `GET /me` route currently returns `{ owner, balance }` — it does not return reserve amount. To show "available = balance - reserve" breakdown, either (a) the `/me` route must be enhanced to return reserve, or (b) the frontend hardcodes a "20 cr reserve floor" display note
   - Recommendation: Enhance `GET /me` to return `{ owner, balance, reserve }` by reading the `BudgetManager` reserve config. If `BudgetManager` is not accessible in the server context, display balance with a "(20 cr reserve)" annotation hardcoded.

2. **Idle rate in CardModal availability indicator (MODAL-02)**
   - What we know: `Skill` interface in `src/types/index.ts` has `metadata?.idle_rate`. `HubCard` in `hub/src/types.ts` does NOT include `idle_rate` on its `metadata`.
   - What's unclear: Does the `/cards` or `/api/agents/:owner` endpoint return `idle_rate` in card metadata?
   - Recommendation: Add `idle_rate?: number` to `HubCard.metadata` interface in `hub/src/types.ts`. Availability indicator shows "Online + busy" vs "Online + idle (70%)" based on idle_rate value. If null, show only online/offline.

3. **Vite proxy for `/me/transactions`**
   - What we know: `vite.config.ts` has `'/me': 'http://localhost:7777'` — Vite 6 proxy uses prefix matching, so `/me/transactions` should be covered by the `/me` entry.
   - What's unclear: Needs runtime verification during development.
   - Recommendation: Trust prefix matching. If 404s occur in dev, add explicit `/me/transactions` entry.

---

## Validation Architecture

nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.4 |
| Config file | `hub/vite.config.ts` (test section) + root `vitest.config.ts` for backend |
| Quick run command (hub) | `cd hub && pnpm test` |
| Quick run command (backend) | `pnpm test` (root) |
| Full suite command | `pnpm test && cd hub && pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CREDIT-01 | `formatCredits()` returns `"cr X"` not `"X credits"` | unit | `cd hub && pnpm test -- utils.test` | ✅ `hub/src/lib/utils.test.ts` |
| CREDIT-02 | `CapabilityCard` renders `cr` prefix on credit amount | unit | `cd hub && pnpm test -- CapabilityCard.test` | ✅ `hub/src/components/CapabilityCard.test.tsx` |
| CREDIT-03 | `OwnerDashboard` renders balance and reserve breakdown | unit | `cd hub && pnpm test -- OwnerDashboard.test` | ✅ `hub/src/components/OwnerDashboard.test.tsx` |
| CREDIT-04 | `EarningsChart` renders with data points | unit | `cd hub && pnpm test -- EarningsChart.test` | ❌ Wave 0 |
| CREDIT-05 | `TransactionHistory` renders transactions list | unit | `cd hub && pnpm test -- TransactionHistory.test` | ❌ Wave 0 |
| CREDIT-06 | `GET /me/transactions` returns paginated credit transactions | integration | `pnpm test -- server.test` | ✅ `src/registry/server.test.ts` (extend) |
| MODAL-01 | `CardModal` renders CopyButton for CLI command | unit | `cd hub && pnpm test -- CardModal.test` | ❌ Wave 0 |
| MODAL-02 | `CardModal` shows availability indicator with idle status | unit | `cd hub && pnpm test -- CardModal.test` | ❌ Wave 0 |
| MODAL-03 | `CardModal` owner name links to `/agents/:owner` | unit | `cd hub && pnpm test -- CardModal.test` | ❌ Wave 0 |
| POLISH-01 | NavBar renders hamburger button | unit | `cd hub && pnpm test -- NavBar.test` | ❌ Wave 0 |
| POLISH-02 | CardModal uses `items-end` on mobile | visual-only | manual | n/a — manual test |
| POLISH-03 | OwnerDashboard renders without any `slate-*` classes | unit | `cd hub && pnpm test -- OwnerDashboard.test` | ✅ (extend) |
| POLISH-04 | `Skeleton` component renders with `animate-pulse` class | unit | `cd hub && pnpm test -- Skeleton.test` | ❌ Wave 0 |
| POLISH-05 | `CardModal` scroll lock uses position-fixed not overflow:hidden | unit | `cd hub && pnpm test -- CardModal.test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd hub && pnpm test`
- **Per wave merge:** `pnpm test && cd hub && pnpm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `hub/src/components/EarningsChart.test.tsx` — covers CREDIT-04; mock recharts components
- [ ] `hub/src/components/TransactionHistory.test.tsx` — covers CREDIT-05
- [ ] `hub/src/components/CardModal.test.tsx` — covers MODAL-01, MODAL-02, MODAL-03, POLISH-02, POLISH-05
- [ ] `hub/src/components/NavBar.test.tsx` — covers POLISH-01
- [ ] `hub/src/components/Skeleton.test.tsx` — covers POLISH-04

**Existing tests to extend (no new file needed):**
- `hub/src/lib/utils.test.ts` — update assertions for new `formatCredits()` output format
- `hub/src/components/OwnerDashboard.test.tsx` — extend for reserve breakdown, token migration check
- `hub/src/components/CapabilityCard.test.tsx` — verify `cr` prefix in rendered output
- `src/registry/server.test.ts` — add tests for `GET /me/transactions` route

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `hub/src/components/CardModal.tsx` — current scroll lock (line 65), CLI copy block (lines 263-286), close animation pattern
- Direct codebase inspection: `hub/src/components/OwnerDashboard.tsx` — all `slate-*` tokens enumerated, existing structure
- Direct codebase inspection: `hub/src/components/RequestHistory.tsx` — `slate-*` token usage, credits display (line 59)
- Direct codebase inspection: `hub/src/lib/utils.ts` — `formatCredits()` current output format
- Direct codebase inspection: `hub/src/hooks/useRequests.ts` — hook pattern, `RequestLogEntry` interface
- Direct codebase inspection: `src/credit/ledger.ts` — `getTransactions()` already at line 117, `CreditTransaction` interface at line 8
- Direct codebase inspection: `src/registry/server.ts` lines 385-468 — `ownerRoutes` scoped plugin structure, existing `/me` and `/requests` routes
- Direct codebase inspection: `hub/tailwind.config.js` — full `hub-*` token list for migration mapping
- Direct codebase inspection: `hub/vite.config.ts` — proxy entries; `/me` and `/api` already covered
- Direct codebase inspection: `hub/package.json` — recharts NOT yet installed; lucide-react IS installed
- `.planning/research/PITFALLS.md` — Pitfall 6 (Recharts tooltip), Pitfall 9 (iOS scroll lock) — verified patterns with code

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` — recharts ^3.8.0 version recommendation, confirmed via project-level research
- Phase 12 VERIFICATION.md — confirmed `NavCreditBadge` already uses `cr {balance}` format
- Phase 13 VERIFICATION.md — confirmed `CopyButton.tsx` pattern (navigator.clipboard + 1500ms timeout) available for reuse in MODAL-01

### Tertiary (LOW confidence — flagged)
- Vite 6 proxy prefix matching behavior for `/me/transactions` — needs runtime verification; documented as open question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — recharts version from project research; all other deps already installed
- Architecture: HIGH — all patterns derived from direct codebase inspection; no speculation
- Pitfalls: HIGH — Recharts tooltip and iOS scroll lock verified patterns with exact code

**Research date:** 2026-03-16
**Valid until:** 2026-04-15 (recharts API is stable; Tailwind v3 is stable; 30-day validity)
