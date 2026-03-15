---
phase: 09-hub-ui-redesign
plan: "01"
subsystem: ui
tags: [react, tailwind, css-variables, design-system, dark-theme, inter, jetbrains-mono]

requires: []

provides:
  - CSS custom properties design system (--color-bg #08080C, --color-surface, --color-border, --color-accent #10B981, --font-sans, --font-mono, --radius-card)
  - Tailwind hub-* color tokens referencing new dark SaaS palette
  - Google Fonts: Inter (400,600) + JetBrains Mono (400,600) via CDN
  - Compact-only CapabilityCard with onClick prop (no in-place expand)
  - Ghost-style CategoryChip, LevelBadge, StatusDot sub-components
  - Updated SkeletonCard matching new card dimensions
  - CardGrid with minmax(280px,1fr) auto-fill and items-start

affects:
  - 09-02 (modal overlay — builds on CapabilityCard onClick prop and design tokens)
  - 09-03 (header/stats bar — consumes hub-* tokens and font variables)
  - 09-04 (search/filter — consumes ghost-style chip pattern)

tech-stack:
  added: []
  patterns:
    - "CSS custom properties as single source of truth, consumed by Tailwind theme extension"
    - "Ghost style components: transparent bg + border-hub-border-hover + rounded-full pill"
    - "Dark text hierarchy via opacity only: 0.92 primary, 0.55 secondary, 0.30 tertiary"
    - "All colors reference hub-* Tailwind tokens, no raw hex in component classes"

key-files:
  created: []
  modified:
    - hub/index.html
    - hub/tailwind.config.js
    - hub/src/index.css
    - hub/src/components/CapabilityCard.tsx
    - hub/src/components/CapabilityCard.test.tsx
    - hub/src/components/CardGrid.tsx
    - hub/src/components/CategoryChip.tsx
    - hub/src/components/LevelBadge.tsx
    - hub/src/components/StatusDot.tsx
    - hub/src/components/SkeletonCard.tsx
    - hub/src/lib/utils.ts
    - hub/src/lib/utils.test.ts
    - hub/src/types.ts
    - hub/src/App.tsx
    - hub/src/hooks/useCards.ts

key-decisions:
  - "StatusColor type changed from 'emerald'|'rose' to 'accent'|'dim' to match design token naming"
  - "App.tsx expandedId state removed — replaced with no-op handleCardClick placeholder for plan 02 modal"
  - "selectedId not stored in state until plan 02 adds modal overlay (avoids noUnusedLocals TS error)"

patterns-established:
  - "Ghost chip pattern: border border-hub-border-hover bg-transparent text-hub-text-secondary rounded-full"
  - "Card hover pattern: hover:-translate-y-0.5 hover:border-hub-border-hover hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
  - "Stats row pattern: font-mono text-hub-accent for credit amounts"

requirements-completed: [HUI-01, HUI-02]

duration: 6min
completed: 2026-03-16
---

# Phase 9 Plan 01: Hub UI Redesign — Design System Summary

**Dark SaaS design system (CSS variables, Inter + JetBrains Mono fonts, Tailwind hub-* tokens) with compact CapabilityCard, ghost-style chips, green online glow, and hover lift effect.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-15T18:36:33Z
- **Completed:** 2026-03-15T18:41:56Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments

- Replaced slate-900/indigo Tailwind theme with dark SaaS palette: #08080C background, #10B981 accent, white-at-opacity text hierarchy
- Rebuilt CapabilityCard as compact-only (32px identicon, 15px title, ghost chips, green online dot with glow, monospace credits), removing all in-place expand code
- Updated all sub-components (CategoryChip, LevelBadge, StatusDot, SkeletonCard, CardGrid) to consume new hub-* design tokens

## Task Commits

Each task was committed atomically:

1. **Task 1: Design system — CSS variables, font imports, Tailwind config** - `1d60aa5` (feat)
2. **Task 2: Card component + sub-components redesign** - `3b71fd7` (feat)

## Files Created/Modified

- `hub/index.html` - Added Google Fonts preconnect + Inter/JetBrains Mono import
- `hub/tailwind.config.js` - New hub-* dark theme tokens (#08080C bg, #10B981 accent, rgba surfaces/borders)
- `hub/src/index.css` - CSS custom properties design system (--color-bg through --radius-chip)
- `hub/src/components/CapabilityCard.tsx` - Compact-only card, onClick prop, dark SaaS aesthetic
- `hub/src/components/CapabilityCard.test.tsx` - Updated tests for onClick prop, compact-only behavior
- `hub/src/components/CardGrid.tsx` - Changed minmax from 320px to 280px, items-start
- `hub/src/components/CategoryChip.tsx` - Ghost style (transparent bg, border-hub-border-hover, rounded-full)
- `hub/src/components/LevelBadge.tsx` - 11px text, ghost style, hub-text-secondary icon colors
- `hub/src/components/StatusDot.tsx` - 8px bg-hub-accent with glow shadow (online), bg-hub-text-tertiary (offline)
- `hub/src/components/SkeletonCard.tsx` - rounded-card, p-6, bg-hub-surface, white/[0.06] bars
- `hub/src/lib/utils.ts` - Ghost badge styles for getLevelBadge, accent/dim StatusColor
- `hub/src/lib/utils.test.ts` - Updated getStatusIndicator tests to expect accent/dim
- `hub/src/types.ts` - StatusColor type changed to 'accent' | 'dim'
- `hub/src/App.tsx` - Updated to onClick prop, hub-* tokens in header/tabs, removed expandedId state
- `hub/src/hooks/useCards.ts` - Removed unused CardsResponse import

## Decisions Made

- StatusColor type changed from `'emerald' | 'rose'` to `'accent' | 'dim'` to align with design token naming rather than Tailwind color names
- `expandedId` state in App.tsx removed and replaced with a no-op `handleCardClick` placeholder so plan 02 can add modal state cleanly
- App.tsx header/tab colors updated to hub-* tokens even though it wasn't in the plan's file list — required to prevent TypeScript errors and maintain visual consistency

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript noUnusedLocals errors blocking compilation**
- **Found during:** Task 2 (TypeScript verification step)
- **Issue:** `selectedId` state declared but never read (TS6133); `CardsResponse` imported but never used (TS6196)
- **Fix:** Removed `selectedId` state (replaced with no-op function for plan 02 placeholder); removed `CardsResponse` from useCards.ts import
- **Files modified:** hub/src/App.tsx, hub/src/hooks/useCards.ts
- **Verification:** `tsc --noEmit` exits 0
- **Committed in:** 3b71fd7 (Task 2 commit)

**2. [Rule 1 - Bug] Updated utils.test.ts to match StatusColor rename**
- **Found during:** Task 2 (test run)
- **Issue:** Tests expected `getStatusIndicator` to return 'emerald'/'rose' but function now returns 'accent'/'dim'
- **Fix:** Updated 2 test descriptions and expected values
- **Files modified:** hub/src/lib/utils.test.ts
- **Verification:** All utils tests pass (8/8)
- **Committed in:** 3b71fd7 (Task 2 commit)

**3. [Rule 2 - Missing] Updated App.tsx header/tabs to hub-* tokens**
- **Found during:** Task 2 (reviewing App.tsx for prop update)
- **Issue:** App.tsx still used slate-900/slate-100/emerald-400 classes in header and tab nav after updating the body wrapper
- **Fix:** Replaced all old slate/emerald references in header and tab navigation with hub-* tokens
- **Files modified:** hub/src/App.tsx
- **Verification:** TypeScript passes, visual consistency with new design system
- **Committed in:** 3b71fd7 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing)
**Impact on plan:** All auto-fixes necessary for TypeScript compilation correctness and visual consistency. No scope creep.

## Issues Encountered

- `pnpm exec tsc` and `npx tailwindcss` failed because node_modules were not installed in the hub directory. Ran `pnpm install` in hub/ to resolve. TypeScript check then succeeded.
- `useAuth.test.ts` has 6 pre-existing failures (`localStorage.clear is not a function`) unrelated to this plan's changes. Logged to deferred-items.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Design system foundation complete — all hub-* Tailwind tokens available for phase 09-02 through 09-04
- CapabilityCard.tsx onClick prop ready for modal overlay wiring in plan 09-02
- Ghost chip pattern established for search filter chips in plan 09-04

## Self-Check: PASSED

All files verified present. All commits confirmed. Must-have assertions confirmed:
- `--color-bg` CSS variable in hub/src/index.css
- `#08080C` in hub/tailwind.config.js
- Inter font import in hub/index.html
- CapabilityCard.tsx: 89 lines, onClick prop present, no expanded prop
- StatusDot used in CapabilityCard.tsx

---
*Phase: 09-hub-ui-redesign*
*Completed: 2026-03-16*
