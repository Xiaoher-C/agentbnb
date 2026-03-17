# Phase 17: Below-Fold Sections — Research

**Researched:** 2026-03-17
**Domain:** React UI composition — static below-fold marketing sections in an existing dark SaaS Hub
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOLD-01 | "Compatible With" section below the Discover card grid using Marquee component — shows tool/framework logos | Marquee component fully implemented in hub/src/components/ui/marquee.tsx; keyframes registered in tailwind.config.js; only content (logos/text items) needed |
| FOLD-02 | FAQ accordion section with common questions about AgentBnB | Accordion, AccordionItem, AccordionTrigger, AccordionContent all implemented in hub/src/components/ui/accordion.tsx; FAQ copy needs to be authored |
| FOLD-03 | Brief description / value proposition section explaining the protocol | Pure JSX + Tailwind — no new component needed; reuse existing hub- design tokens |
| FOLD-04 | Below-fold sections maintain the existing minimalist dark aesthetic | hub- design token system fully documented; color/spacing/typography conventions confirmed from source |
</phase_requirements>

---

## Summary

Phase 17 is almost entirely a composition task: three UI sections are added to the bottom of `DiscoverPage.tsx` using components that are already 100% implemented from Phase 16. No new dependencies, no new routes, no backend changes. The work is creating the section layouts, writing the content (FAQ questions, tool names, value prop copy), and wiring the existing Marquee and Accordion primitives into the page.

The Marquee component (`hub/src/components/ui/marquee.tsx`) scrolls children horizontally via a CSS keyframe animation already registered in `tailwind.config.js` as `animate-marquee`. It accepts `pauseOnHover`, `reverse`, and `repeat` props. The Accordion components wrap `@radix-ui/react-accordion` and are pre-styled to the dark theme with `border-white/[0.06]` separators and `text-hub-text-*` token colors. Both are ready to drop in without modification.

The existing `DiscoverPage.tsx` renders a fragment (`<>...</>`) of `StatsBar`, `SearchFilter`, and a conditional card grid. Below-fold sections are appended after the card grid block. A thin separator and section headings using the `text-hub-text-secondary` + small-caps or uppercase label pattern (matching the rest of the Hub) will tie everything together visually.

**Primary recommendation:** Add three new section components (`CompatibleWithSection`, `FAQSection`, `ValuePropSection`) in `hub/src/components/` and compose them at the bottom of `DiscoverPage.tsx` after the card grid. Keep each section self-contained with its own file so tests can target them independently.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 18 | ^18.3.1 | Component authoring | Already in hub/package.json |
| Tailwind CSS | ^3.4.17 | Utility styling | Already configured with hub- tokens |
| @radix-ui/react-accordion | ^1.2.12 | Accessible accordion primitive | Already installed, used by accordion.tsx |
| lucide-react | ^0.469.0 | Icon SVGs for tool logos (fallback) | Already installed |
| clsx + tailwind-merge | ^2.1.1 / ^3.5.0 | Class composition via `cn()` | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| motion/react | ^12.37.0 | Scroll-triggered entrance animations | Optional — only if subtle fade-in on scroll is desired for sections; already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline SVG logos in Marquee | Image files (PNG/SVG assets) | Inline SVG requires no network requests and uses currentColor; image files need /hub/ path prefix and are harder to theme. Use inline SVG or text+icon combos. |
| Self-contained section components | Inline JSX in DiscoverPage | Components make each section independently testable. Inline JSX makes DiscoverPage too long and untestable. |

**Installation:** No new packages required. All dependencies present.

---

## Architecture Patterns

### Recommended Project Structure

New files for Phase 17:

```
hub/src/components/
├── CompatibleWithSection.tsx    # Marquee-based tool logos strip
├── FAQSection.tsx               # Accordion FAQ with 5-6 Q&A items
└── ValuePropSection.tsx         # 2-3 sentence value prop with optional stats
```

Modified files:

```
hub/src/pages/
└── DiscoverPage.tsx             # Import and append the three sections
```

### Pattern 1: Section Layout Wrapper

All three sections use the same outer container pattern to maintain consistent spacing and visual separation from the card grid.

**What:** A `<section>` wrapper with top border, vertical padding, and optional section heading label.
**When to use:** Every below-fold section.

```tsx
// Consistent section container pattern (matches rest of Hub spacing)
<section className="mt-16 border-t border-hub-border pt-12 pb-8">
  <h2 className="text-xs font-semibold uppercase tracking-widest text-hub-text-muted mb-6">
    Compatible With
  </h2>
  {/* section content */}
</section>
```

### Pattern 2: Marquee Tool Strip

**What:** Tool/framework names (or inline SVG brand marks) scrolled via the existing Marquee component.
**When to use:** FOLD-01 "Compatible With" section.

```tsx
// Source: hub/src/components/ui/marquee.tsx (Phase 16)
import { Marquee } from './ui/marquee.js';

const TOOLS = [
  'Claude Code', 'OpenClaw', 'Antigravity', 'Cursor', 'Windsurf',
  'Node.js', 'Python', 'TypeScript', 'JSON-RPC', 'HTTP',
];

// Each item rendered as a pill chip — matches existing CategoryChip aesthetic
function ToolPill({ name }: { name: string }) {
  return (
    <span className="mx-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-hub-border text-sm text-hub-text-secondary whitespace-nowrap">
      {name}
    </span>
  );
}

export function CompatibleWithSection() {
  return (
    <section className="mt-16 border-t border-hub-border pt-12 pb-8">
      <h2 className="text-center text-xs font-semibold uppercase tracking-widest text-hub-text-muted mb-6">
        Compatible With
      </h2>
      <Marquee pauseOnHover className="[--duration:30s]">
        {TOOLS.map((name) => (
          <ToolPill key={name} name={name} />
        ))}
      </Marquee>
    </section>
  );
}
```

**Marquee width gotcha:** The Marquee container must span full page width (no `max-w-*` constraint) to achieve the edge-to-edge scroll effect. The `App.tsx` `main` container uses `max-w-7xl mx-auto px-4`. Options:

1. Negative margin technique: `className="-mx-4"` to break out of padding
2. Place CompatibleWithSection outside the `main` container (preferred — cleaner, no hacks)

Option 2 is architecturally cleaner. DiscoverPage renders inside `<main className="max-w-7xl mx-auto px-4 py-8 pb-12">` in App.tsx. The sections can either:
- Stay inside `main` (constrained width, simpler) — adequate for pills that wrap
- Use a full-bleed wrapper via negative margins

Given the minimalist goal, constrained width (inside existing `main`) is acceptable and simpler. Full-bleed is a visual enhancement, not a requirement.

### Pattern 3: FAQ Accordion

**What:** 5-6 common AgentBnB questions using the existing Accordion components.
**When to use:** FOLD-02.

```tsx
// Source: hub/src/components/ui/accordion.tsx (Phase 16)
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './ui/accordion.js';

const FAQ_ITEMS = [
  {
    id: 'what-is',
    q: 'What is AgentBnB?',
    a: 'AgentBnB is a P2P protocol for AI agents to share and discover capabilities...',
  },
  // ... more items
];

export function FAQSection() {
  return (
    <section className="mt-12 border-t border-hub-border pt-12 pb-8">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-hub-text-muted mb-6">
        FAQ
      </h2>
      <Accordion type="single" collapsible className="max-w-2xl">
        {FAQ_ITEMS.map(({ id, q, a }) => (
          <AccordionItem key={id} value={id}>
            <AccordionTrigger>{q}</AccordionTrigger>
            <AccordionContent>{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
```

**Radix Accordion `type` prop:** Must pass either `type="single"` (one open at a time) or `type="multiple"` (many open). With `type="single"` pass `collapsible` to allow closing the active item. This is required by the Radix API.

### Pattern 4: Value Proposition Section

**What:** 2-3 sentences + optional 3-column stat or bullet layout.
**When to use:** FOLD-03.

```tsx
export function ValuePropSection() {
  return (
    <section className="mt-12 border-t border-hub-border pt-12 pb-16">
      <div className="max-w-xl">
        <p className="text-hub-text-secondary text-base leading-relaxed">
          AgentBnB is a peer-to-peer protocol for AI agents to share idle
          capabilities and discover new ones. Agents list what they can do,
          set a credit price, and other agents book and use them — no human
          required.
        </p>
      </div>
    </section>
  );
}
```

### Anti-Patterns to Avoid

- **Importing full framer-motion animation for below-fold sections:** The sections should feel native, not attention-grabbing. Skip entrance animations unless very subtle (opacity-only, no translateY). motion/react is available but not required here.
- **Using `bg-hub-bg` explicitly in section wrappers:** The body background already is `#08080C`. Setting `bg-hub-bg` creates a redundant paint. Omit and let the page background show through.
- **Hard-coding hex colors inside new components:** Always use `text-hub-*`, `border-hub-border`, `bg-white/[0.04]` etc. — never inline `#10B981` or `rgba(...)` strings. This ensures FOLD-04 compliance.
- **Forgetting `overflow-hidden` on Marquee parent:** The Marquee component uses `overflow-hidden` internally, but if the section wrapper has a fixed height without overflow handling, the marquee pills can bleed.
- **Full-bleed negative margins without testing:** If using `-mx-4` to break out of App padding, ensure the Marquee's inner pill content doesn't render partially off-screen on mobile.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scrolling logo strip | Custom CSS animation with `@keyframes` | `Marquee` from `hub/src/components/ui/marquee.tsx` | Already handles reverse, pause-on-hover, vertical, repeat, CSS custom property duration — and keyframes are already in tailwind.config.js |
| Expandable FAQ | Custom useState toggle + animated div | `Accordion*` from `hub/src/components/ui/accordion.tsx` | Radix handles keyboard nav, ARIA expanded/collapsed, focus management, and the animate-accordion-down/up keyframes are already registered |
| Section divider line | Custom hr or box shadow | `border-t border-hub-border` | Existing token, zero code, consistent |

**Key insight:** Phase 16 was specifically designed to pre-build the Marquee and Accordion so Phase 17 is pure composition. Any custom re-implementation would duplicate code and risk visual inconsistency.

---

## Common Pitfalls

### Pitfall 1: Accordion `type` Prop Missing
**What goes wrong:** TypeScript error or runtime warning — Radix AccordionRoot requires `type` prop (`"single"` or `"multiple"`).
**Why it happens:** The accordion.tsx wrapper re-exports the Radix root without a default for `type`. The caller must always pass it.
**How to avoid:** Always include `type="single" collapsible` or `type="multiple"` on the `<Accordion>` element.
**Warning signs:** TypeScript: "Property 'type' is missing in type ... required in type 'AccordionSingleProps | AccordionMultipleProps'"

### Pitfall 2: Marquee Content Not Duplicated Enough for Seamless Loop
**What goes wrong:** When the total width of tools is less than viewport width, the animation visibly resets.
**Why it happens:** The Marquee uses `repeat={4}` by default (renders children 4 times). With only ~10 short items the default should be fine. If items are wide or few, increase `repeat`.
**How to avoid:** Use at least 10 tools in TOOLS array and keep default `repeat={4}`. Test at wide viewport.
**Warning signs:** Visible gap or jump in the scrolling strip at wide screen widths.

### Pitfall 3: FAQ Section Centering vs Full-Width Accordion
**What goes wrong:** FAQ accordion stretches to full `max-w-7xl`, which looks like a wide blank line on large screens.
**Why it happens:** Accordion has no intrinsic max-width constraint.
**How to avoid:** Wrap Accordion in `<div className="max-w-2xl">` or similar. See Pattern 3 above.
**Warning signs:** Each AccordionItem trigger spans the full 1280px container width.

### Pitfall 4: Section Heading Style Inconsistency
**What goes wrong:** Section headings look different from existing Hub element labels (StatsBar labels use `text-hub-text-muted text-sm`, CategoryChip uses small-caps, Docs headings use specific sizes).
**Why it happens:** No existing "section heading" component to reference.
**How to avoid:** Use `text-xs font-semibold uppercase tracking-widest text-hub-text-muted` — this matches the sparse, technical label aesthetic already in CapabilityCard and CategoryChip.
**Warning signs:** Section heading text looks too big, too bright, or incorrectly weighted vs surrounding content.

### Pitfall 5: DiscoverPage Fragment Gets Too Long
**What goes wrong:** DiscoverPage.tsx becomes a 150-line file that mixes data-fetching logic with layout.
**Why it happens:** Inlining all three sections instead of using dedicated files.
**How to avoid:** Import the three sections as named components. DiscoverPage stays under ~50 lines.

---

## Code Examples

Verified patterns from source code:

### Existing hub- design tokens (from hub/tailwind.config.js)
```
hub-bg:            #08080C
hub-surface:       rgba(255,255,255,0.03)
hub-surface-hover: rgba(255,255,255,0.06)
hub-border:        rgba(255,255,255,0.06)
hub-border-hover:  rgba(255,255,255,0.12)
hub-accent:        #10B981  (emerald)
hub-text-primary:  rgba(255,255,255,0.92)
hub-text-secondary:rgba(255,255,255,0.55)
hub-text-tertiary: rgba(255,255,255,0.30)
hub-text-muted:    rgba(255,255,255,0.40)
```

### DiscoverPage extension point (from hub/src/pages/DiscoverPage.tsx)
```tsx
// Current structure — append below-fold sections after the card grid block
return (
  <>
    <StatsBar ... />
    <SearchFilter ... />
    {loading ? ... : error ? ... : cards.length === 0 ? ... : (
      <CardGrid>...</CardGrid>
    )}
    {/* Phase 17: below-fold sections go here */}
    <CompatibleWithSection />
    <FAQSection />
    <ValuePropSection />
  </>
);
```

### Accordion usage with required type prop
```tsx
// Source: @radix-ui/react-accordion (via hub/src/components/ui/accordion.tsx)
<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Question text?</AccordionTrigger>
    <AccordionContent>Answer text.</AccordionContent>
  </AccordionItem>
</Accordion>
```

### Marquee with custom speed
```tsx
// Source: hub/src/components/ui/marquee.tsx
// Duration CSS custom property controls speed (default 40s = slow)
// Shorter = faster
<Marquee pauseOnHover className="[--duration:30s]">
  {items.map(item => <Item key={item} />)}
</Marquee>
```

### Section separator pattern (consistent with existing Hub borders)
```tsx
<section className="mt-16 border-t border-hub-border pt-12 pb-8">
  ...
</section>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom @keyframes animation for scrolling | Marquee component with tailwind animation class | Phase 16 (2026-03-17) | No new keyframes needed |
| Raw Radix accordion imports | Pre-themed accordion.tsx with hub- tokens | Phase 16 (2026-03-17) | No inline styling needed |
| Hash-based tab switching | react-router v7 hash routing | Phase 12 | DiscoverPage is a route component, uses `useOutletContext` |

---

## Open Questions

1. **What tool/framework logos to include in Compatible With?**
   - What we know: Claude Code, OpenClaw, Antigravity, and CLI are the four install paths from DIST-02 / Docs page
   - What's unclear: Whether to use brand SVG logos (requires sourcing assets) or text pill chips
   - Recommendation: Use text pill chips with lucide icons as decorators. Zero asset management, consistent with Hub aesthetic, fast to implement. Can be upgraded to brand SVGs later.

2. **What FAQ questions to include?**
   - What we know: The Docs page (DocsPage.tsx) has a Getting Started section and API reference. The value prop is agent-to-agent capability sharing.
   - What's unclear: Exact FAQ copy not specified in requirements.
   - Recommendation: 5-6 questions covering: (1) What is AgentBnB? (2) How do credits work? (3) How do I list my agent's skills? (4) Which AI frameworks are supported? (5) Is it open source? (6) How do agents discover each other?

3. **Should the value prop section include animated stats?**
   - What we know: StatsBar already shows live counts above the fold. The ValuePropSection is described as "brief description."
   - What's unclear: Whether FOLD-03 means literal text only, or includes visual elements.
   - Recommendation: Text only in ValuePropSection. Keep it minimal — the StatsBar above already provides live data. Adding another stats block below would feel redundant.

4. **Should sections be hidden when cards are loading or errored?**
   - What we know: DiscoverPage shows loading/error states only for the card grid; Stats and SearchFilter always render.
   - What's unclear: Whether below-fold sections should wait for cards to load.
   - Recommendation: Render below-fold sections unconditionally. They contain static content and don't depend on card data. Always visible = better perceived performance.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.4 + @testing-library/react ^16.1.0 |
| Config file | hub/vite.config.ts (`test.environment: 'jsdom'`) |
| Quick run command | `cd hub && pnpm test -- --reporter=verbose` |
| Full suite command | `cd hub && pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOLD-01 | CompatibleWithSection renders tool names inside Marquee | unit | `cd hub && pnpm test -- CompatibleWithSection` | Wave 0 |
| FOLD-02 | FAQSection renders accordion items; clicking trigger expands content | unit | `cd hub && pnpm test -- FAQSection` | Wave 0 |
| FOLD-03 | ValuePropSection renders a description paragraph with expected text | unit | `cd hub && pnpm test -- ValuePropSection` | Wave 0 |
| FOLD-04 | All sections use hub- tokens — no hard-coded hex; visual regression is manual | manual | n/a | n/a |

### Sampling Rate
- **Per task commit:** `cd hub && pnpm test`
- **Per wave merge:** `cd hub && pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `hub/src/components/CompatibleWithSection.test.tsx` — covers FOLD-01
- [ ] `hub/src/components/FAQSection.test.tsx` — covers FOLD-02
- [ ] `hub/src/components/ValuePropSection.test.tsx` — covers FOLD-03

*(Framework and config already exist — no new setup needed. Tests only need component files to exist first.)*

---

## Sources

### Primary (HIGH confidence)
- `hub/src/components/ui/marquee.tsx` — Marquee component API, props, animation class names
- `hub/src/components/ui/accordion.tsx` — Accordion API, Radix primitive wrapping, token usage
- `hub/tailwind.config.js` — Keyframe registrations (marquee, accordion-down/up), hub- color tokens
- `hub/src/pages/DiscoverPage.tsx` — Exact composition point for new sections
- `hub/src/components/NavBar.tsx`, `StatsBar.tsx`, `EmptyState.tsx` — Reference patterns for hub- token usage
- `hub/package.json` — Confirmed installed dependency versions
- `hub/vite.config.ts` — Confirmed test setup (jsdom, vitest)

### Secondary (MEDIUM confidence)
- `@radix-ui/react-accordion` v1.2.12 — `type` prop requirement confirmed from official Radix UI Accordion docs (type is required, values: "single" | "multiple")

### Tertiary (LOW confidence)
- None — all findings verified from source code directly.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all verified from hub/package.json and existing component source
- Architecture: HIGH — insertion point confirmed from DiscoverPage.tsx source, component APIs confirmed from Phase 16 files
- Pitfalls: HIGH — derived from direct source inspection (Radix accordion type requirement, Marquee repeat behavior)

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable dependencies, no fast-moving areas)
