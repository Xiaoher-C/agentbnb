# Phase 9: Hub UI Redesign - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning
**Source:** PRD Express Path (v2.1-milestone.md)

<domain>
## Phase Boundary

This phase delivers a complete visual redesign of the AgentBnB Hub (React SPA at `/hub`). The Hub transforms from a functional Tailwind app into a premium dark SaaS showcase with ambient atmosphere. This is NOT a functional enhancement — it's a visual quality upgrade that makes the Hub screenshot-worthy and share-worthy.

The Hub is AgentBnB's recruiting tool — first impression > information density.

</domain>

<decisions>
## Implementation Decisions

### Design System
- Background: NOT pure black. Use `#08080C` base with subtle radial gradient glow in hero area
- The glow: soft, large (600px radius), low-opacity (0.08) circle of accent color, positioned behind stats bar
- Optional: very faint grid lines (opacity 0.03) in background for tech/network feel
- Accent color: emerald green `#10B981` (Tailwind emerald-500) — ONLY accent color
- Used on: online dots, credit numbers, primary CTA, stats numbers
- Everything else: white at various opacities
- Typography headers: `"Inter"`, semibold (600), tracking tight (-0.02em)
- Typography body: `"Inter"`, regular (400)
- Typography code/numbers: `"JetBrains Mono"` or `"SF Mono"` for credit amounts, CLI commands, latency numbers
- Text hierarchy via opacity ONLY:
  - Primary: `rgba(255,255,255, 0.92)` — card titles, stats numbers
  - Secondary: `rgba(255,255,255, 0.55)` — owner names, labels
  - Tertiary: `rgba(255,255,255, 0.30)` — hints, timestamps
- No colored text except accent green for key metrics

### Card Component
- Card bg: `rgba(255,255,255, 0.03)`
- Card border: `1px solid rgba(255,255,255, 0.06)`
- Card border-radius: 16px
- Card padding: 24px
- Card gap: 16px
- Card hover: `transform: translateY(-2px)`, border brightens to `rgba(255,255,255, 0.12)`, shadow `0 8px 32px rgba(0,0,0,0.3)`
- Card transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1)
- Compact view: 32px identicon, 15px semibold title (white 92%), 13px owner (white 30%), tiny level pill (11px), ghost category chips (12px), green dot + monospace stats
- Badges/chips: ghost style, transparent bg, `1px solid rgba(255,255,255, 0.12)`, rounded-full
- Category chips: small text (12px), pill shape, no bg fill
- Level badge: Atomic = small dot, Pipeline = connected dots icon, Environment = solid block
- Online indicator: 8px circle, accent green with `box-shadow: 0 0 8px rgba(16,185,129,0.4)` glow

### Modal Overlay
- Backdrop: `rgba(0,0,0,0.7)` + `backdrop-filter: blur(12px)`
- Modal max-width: 520px
- Modal bg: `#111117`
- Modal border: `1px solid rgba(255,255,255,0.08)`
- Modal border-radius: 20px
- Modal padding: 32px
- Animate in: opacity 0→1 + scale 0.96→1 (200ms ease-out)
- Animate out: opacity 1→0 + scale 1→0.96 (150ms ease-in)
- Content: 48px identicon, full name + locale, owner handle, description, inputs/outputs sections, stats section, CLI request code block
- CLI code block: `JetBrains Mono`, bg `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.06)`
- Copy button: ghost style, shows checkmark after click for 2 seconds
- Close: ESC key or click backdrop
- Body scroll locked when modal open

### Header + Stats Bar
- "AgentBnB" logo: 24px, semibold, white 92%
- Stats numbers: 32px, `JetBrains Mono`, accent green
- Stats labels: 14px, white 40%
- Ambient glow behind stats — halo effect
- Search bar: full width, 48px height, rounded-xl, ghost style (transparent bg + border)
- Stats count-up: numbers animate from 0 to current value over 400ms with easing

### Tabs
- Subtle pill-switcher below search bar
- Active tab: filled with `rgba(255,255,255,0.08)`
- Inactive tab: transparent, white 40% text
- No underline, no border — just fill difference

### Grid Layout
- CSS Grid with `align-items: start` (prevents row height stretching)
- `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- Gap: 16px

### Claude's Discretion
- How to import Inter + JetBrains Mono fonts (Google Fonts CDN vs local)
- Identicon generation library choice (jdenticon, minidenticons, or CSS-based)
- Animation implementation (CSS keyframes vs JS requestAnimationFrame for count-up)
- How to structure CSS variables (single file vs Tailwind config extension)
- Modal state management (React state vs URL hash)
- Responsive breakpoints for the grid

</decisions>

<specifics>
## Specific Ideas

- The visual quality should reference HackerRank's landing page (dark bg + green accent + bold typography) and modern DeFi dashboards (deep black + subtle gradient glows + minimal UI)
- Stats "feel alive" with count-up animation on page load
- The Hub is a recruiting tool — screenshot impact is the #1 priority
- Priority order: Screenshot impact > operation speed > info density > mobile

</specifics>

<deferred>
## Deferred Ideas

None — v2.1-milestone.md covers the full phase scope.

</deferred>

---

*Phase: 09-hub-ui-redesign*
*Context gathered: 2026-03-16 via PRD Express Path*
