# Phase 18: README Visual Overhaul - Research

**Researched:** 2026-03-17
**Domain:** GitHub README composition, SVG banner creation, Playwright screenshot capture
**Confidence:** HIGH

---

## Summary

Phase 18 has four concrete deliverables: (1) badges at the top of README.md, (2) a hero banner image, (3) restructured sections with clear headings, and (4) a real 1280×800 screenshot at `docs/hub-screenshot.png`. Phase 15 already added badges and an install table; this phase elevates the visual presentation and fixes the 0-byte screenshot placeholder.

The README is purely a Markdown/HTML file — no build tooling is required. The hero banner is best implemented as a hand-crafted SVG committed directly to the repo at `docs/banner.svg`, displayed with a centered `<p align="center"><img>` block. The screenshot requires a short Playwright Node script that launches Chromium headless, opens the built Hub at `localhost:4173` (Vite preview), and saves a viewport PNG.

GitHub strips arbitrary CSS and `<style>` tags from Markdown HTML, so complex styling (shadows, backgrounds) must live inside the SVG itself. Shields.io provides the canonical badge URLs for npm version, test status, and license — all of which resolve live from the npm registry and GitHub Actions.

**Primary recommendation:** Write a one-shot `scripts/take-screenshot.mjs` using the globally-available `playwright` package (v1.58 is already installed), run `pnpm build:hub && npx vite preview --port 4173` in the hub directory, and capture the Hub Discover page at 1280×800.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| README-01 | OpenClaw-style badges at top of README (npm version, tests passing, license) | shields.io badge URL patterns confirmed; existing badges in README partially satisfy this — verify badge set and add tests badge |
| README-02 | Hero image or banner prominently displayed | SVG banner approach confirmed; committed to `docs/banner.svg` and referenced via `<p align="center"><img>` |
| README-03 | Structured sections: What, Install, Quick Start, Architecture, Contributing | Current README has these sections but in different order/naming — restructuring plan documented |
| README-04 | Real hub screenshot replaces 0-byte placeholder at docs/hub-screenshot.png | Playwright v1.58 available globally; `playwright install chromium` complete; screenshot script pattern confirmed |
</phase_requirements>

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| shields.io | N/A (CDN) | Badge SVGs (npm version, test status, license) | Industry standard; renders live from npm registry; zero maintenance |
| Playwright | 1.58.0 (global) | Headless Chromium screenshot capture | Already installed globally (`/opt/homebrew/bin/playwright`); Chromium browser confirmed available |
| Vite preview | (hub devDependency) | Serve built Hub for screenshot | Deterministic output vs dev server; no proxy needed for static screenshot |
| SVG (hand-crafted) | N/A | Hero banner | Self-contained; dark background baked in; no external dependencies; GitHub renders reliably |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pnpm build:hub | (project script) | Build the Hub SPA before screenshotting | Required — screenshot must run against production build |
| `<p align="center">` HTML | N/A | Center banner/screenshot in README | GitHub strips CSS but honors deprecated HTML alignment attributes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-crafted SVG banner | readme-banners.vercel.app / leviarista generator | Generator tools require external service; SVG is self-contained and matches brand colors exactly |
| Playwright screenshot script | Manual screenshot (human action) | Manual is fragile — wrong resolution, no reproducibility; Playwright gives exact 1280×800 every time |
| Vite preview for screenshot | agentbnb serve (full stack) | Full stack requires SQLite data, auth — too complex for a visual screenshot of the UI |

**Installation:**
```bash
# Playwright already installed globally — no new deps needed
# For local re-run of screenshot script:
playwright install chromium
```

---

## Architecture Patterns

### Recommended File Changes

```
agentbnb/
├── README.md                    # Full rewrite — new structure + banner ref
├── docs/
│   ├── banner.svg               # NEW: hero banner (hand-crafted SVG)
│   └── hub-screenshot.png       # REPLACE: 0-byte → real 1280×800 PNG
└── scripts/
    └── take-screenshot.mjs      # NEW: Playwright script to capture Hub
```

### Pattern 1: shields.io Badge Row

**What:** A row of badges rendered via img.shields.io URLs placed at the top of README.md, before any prose.

**When to use:** Always at the very top, immediately below the `# AgentBnB` h1.

**Current state:** README already has 5 badges. Phase 15 added npm version, Node.js, License, Claude Code Plugin, Agent Skills. The requirement says "OpenClaw-style" — this means adding a **tests passing** badge. The existing badge set is close; verify and add a test/CI badge.

**Existing badges to keep:**
```markdown
[![npm version](https://img.shields.io/npm/v/agentbnb.svg)](https://www.npmjs.com/package/agentbnb)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

**Badge to add (tests):**
```markdown
[![Tests](https://img.shields.io/badge/tests-302%2B%20passing-brightgreen.svg)](https://github.com/Xiaoher-C/agentbnb)
```

**Note:** A live CI badge requires GitHub Actions configured — use a static badge (`img.shields.io/badge/`) for now since there is no CI workflow. This is acceptable and mirrors OpenClaw's approach.

### Pattern 2: SVG Hero Banner

**What:** A hand-crafted SVG at `docs/banner.svg` displayed centered at the top of README below badges.

**When to use:** Immediately after the badge row.

**GitHub SVG rendering rules (verified):**
- SVG referenced via `<img src="...">` renders reliably on GitHub
- SVG with a `<rect>` background fill renders correctly (background is baked into SVG)
- GitHub strips `<style>` tags from inline HTML, but SVG `<style>` inside a `.svg` file is honored when referenced as `<img>`
- `<foreignObject>` (HTML inside SVG) does NOT render on GitHub — use pure SVG text elements only

**Banner design spec (matches AgentBnB brand):**
- Dimensions: 1200×300px viewBox
- Background: filled `<rect fill="#08080C"/>` (hub-bg color)
- Title: "AgentBnB" in large SVG `<text>` with JetBrains Mono / monospace fallback
- Tagline: "Your agent has idle APIs. It knows. It wants to trade them."
- Accent: emerald #10B981 for decorative elements or title color
- Optionally: include the doodle creature at reduced size (source: `agentbnb-doodle-creature.svg` — paths can be inlined)
- Grid overlay: subtle rectangle grid lines at 0.03 opacity for the tech feel

**README placement:**
```markdown
<p align="center">
  <img src="docs/banner.svg" alt="AgentBnB — P2P Agent Capability Sharing" width="100%">
</p>
```

### Pattern 3: Playwright Screenshot Script

**What:** A Node.js ESM script at `scripts/take-screenshot.mjs` that:
1. Builds the Hub SPA (`pnpm build:hub`)
2. Starts `vite preview` on port 4173
3. Launches Playwright Chromium headless
4. Navigates to `http://localhost:4173/hub/`
5. Waits for the card grid to render
6. Takes a 1280×800 viewport screenshot
7. Saves to `docs/hub-screenshot.png`

**When to use:** Run once during Phase 18 execution to replace the 0-byte placeholder.

**Key implementation details:**
- Use `{ waitUntil: 'networkidle' }` in `page.goto()` to wait for API calls to complete (Hub fetches `/cards` etc — in preview mode these will 404, but the UI renders a fallback empty state which is still visually representable)
- Alternatively seed mock data or use `waitForSelector('[data-testid="card-grid"]')` or a fixed `waitForTimeout(2000)`
- Viewport: `{ width: 1280, height: 800 }` — standard GitHub social preview size
- The Hub navigates to `#/` (Discover page) which is the marketing-worthy view

**Script skeleton:**
```javascript
// Source: playwright.dev/docs/screenshots
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const preview = spawn('pnpm', ['--prefix', 'hub', 'preview', '--port', '4173'], {
  stdio: 'pipe',
});

// Wait for server ready
await new Promise(r => setTimeout(r, 2000));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('http://localhost:4173/hub/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'docs/hub-screenshot.png' });
await browser.close();
preview.kill();
```

**Chromium confirmed available:** `/opt/homebrew/bin/playwright` v1.58.0, `chromium.launch()` tested — version 145.0.7632.6.

### Pattern 4: README Section Structure (Restructured)

**Current README order:** The Core Idea → Install → OpenClaw Integration → Agent Hub (screenshot) → Features → Multi-Skill Capability Card → Autonomy Tiers → Auto-Share + Auto-Request → Requirements → Quick Start → Two-Machine Setup → Commands Reference → Architecture → Development → Examples → License.

**Problem:** "Quick Start" is buried after several dense technical sections. "What" (The Core Idea) is the first section but uses no visual hierarchy. No explicit "Contributing" section exists.

**Target structure aligned with README-03 requirement:**
```
# AgentBnB
[badges]
[hero banner]
[one-line tagline]

## What Is This?
## Install
## Quick Start
## Key Features
## Architecture
## Development
## Contributing
## License
```

**Changes from current state:**
- Move "Quick Start" up to position 3 (after Install)
- Rename "The Core Idea" to "What Is This?" for scan-friendliness
- Collapse verbose sections (Multi-Skill Card JSON, Autonomy Tiers table, Auto-Share detail) into "Key Features" with links to detailed docs
- Add explicit `## Contributing` section (short — point to AGENT-NATIVE-PROTOCOL.md and open issues)
- Keep "Agent Hub" section (screenshot) near the top, after Quick Start

### Anti-Patterns to Avoid

- **foreignObject in SVG for banner:** GitHub does not render HTML inside SVG `<foreignObject>` when the SVG is referenced via `<img>`. Use pure SVG `<text>` elements only.
- **External image services for banner:** Services like vercel-og or readme-typing-svg add external dependencies. A committed SVG is more reliable and loads instantly.
- **Screenshotting the dev server:** The Vite dev server proxies to `localhost:7777` (backend). The screenshot script should use `vite preview` on the built Hub, which renders the UI with graceful empty states.
- **Static badge showing wrong test count:** The 302+ tests count is from v1.1. Don't hardcode "302 passing" — use a generic "tests passing" label or verify current count first.
- **`<style>` tags in README HTML:** GitHub sanitizes these. All README styling must use SVG-internal styles or `align=` HTML attributes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animated typing SVG | Custom canvas/JS animation | Static SVG text (for now) | GitHub doesn't execute JS in SVGs; animation via CSS keyframes in SVG works but adds complexity |
| Test count badge (live) | GitHub Actions CI integration | Static `img.shields.io/badge/` | CI setup is Phase 19 scope (deployment); static badge is correct for Phase 18 |
| Screenshot automation server | Express + Puppeteer service | Simple one-shot `mjs` script | Overkill; screenshot is a one-time operation |

**Key insight:** README is a static document. The only "tooling" needed is a one-shot screenshot script — everything else is hand-editing Markdown and creating an SVG file.

---

## Common Pitfalls

### Pitfall 1: Vite Preview Hub Base Path

**What goes wrong:** Navigating to `http://localhost:4173/` returns 404; the Hub SPA is served at `/hub/` (configured in `hub/vite.config.ts` with `base: '/hub/'`).
**Why it happens:** Vite preview respects the `base` config. The correct URL is `http://localhost:4173/hub/`.
**How to avoid:** Use `page.goto('http://localhost:4173/hub/')` in the screenshot script.
**Warning signs:** 404 or blank page in screenshot.

### Pitfall 2: Screenshot Captures Empty State

**What goes wrong:** The Hub Discover page shows "No capabilities found" because there's no backend running during `vite preview`.
**Why it happens:** The Hub fetches `/cards` which proxies to `localhost:7777` in dev — but in preview mode, the proxy is not active. The fetch fails and the empty state renders.
**How to avoid:** The empty state IS still visually representative of the premium dark UI. Proceed with the screenshot; alternatively, before screenshotting, point the Hub at a running agentbnb instance with seed data for a more populated look. The requirement (README-04) only says "real screenshot," not "populated screenshot."
**Warning signs:** All screenshots show empty/error state.

### Pitfall 3: SVG Not Rendering on GitHub

**What goes wrong:** Banner SVG shows as broken image on GitHub.
**Why it happens:** GitHub serves SVG through a proxy (camo) for security. SVGs with external resource references (fonts, images via `<image href="...">`) are blocked.
**How to avoid:** Use system font fallbacks (`font-family="monospace"`) not web fonts. Do not reference external images inside the SVG. Keep all content self-contained.
**Warning signs:** Broken image icon on GitHub, but SVG renders fine locally.

### Pitfall 4: Existing Badge Set Already Partially Complete

**What goes wrong:** Duplicating badges already present from Phase 15.
**Why it happens:** Phase 15 (DIST-05) already added npm version, Node.js, License, Claude Code Plugin, and Agent Skills badges.
**How to avoid:** Read the current README badge section before writing. Add the tests badge, confirm the existing 5 badges are correctly formatted. Do not remove or duplicate.
**Warning signs:** Double badges in the rendered README.

### Pitfall 5: README-03 Section Naming

**What goes wrong:** Planner creates section headings that don't match the requirement: "What, Install, Quick Start, Architecture, Contributing."
**Why it happens:** The requirement is prescriptive — these exact section names (or close equivalents) are required.
**How to avoid:** Ensure the final README contains headings matching: `## What Is This?` (or `## What`), `## Install`, `## Quick Start`, `## Architecture`, `## Contributing`.

---

## Code Examples

Verified patterns from official sources:

### Playwright Screenshot (minimal)
```javascript
// Source: playwright.dev/docs/screenshots
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('http://localhost:4173/hub/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'docs/hub-screenshot.png' });
await browser.close();
```

### shields.io Badge URL Patterns
```markdown
<!-- npm version — live from npm registry -->
[![npm version](https://img.shields.io/npm/v/agentbnb.svg)](https://www.npmjs.com/package/agentbnb)

<!-- Static tests badge -->
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/Xiaoher-C/agentbnb)

<!-- License -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- Node.js requirement -->
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
```

### SVG Banner Skeleton (GitHub-safe)
```xml
<!-- docs/banner.svg — pure SVG, no foreignObject, no external refs -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="1200" height="300">
  <!-- Dark background (baked in — GitHub strips CSS bg) -->
  <rect width="1200" height="300" fill="#08080C"/>
  <!-- Subtle grid overlay -->
  <defs>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="300" fill="url(#grid)"/>
  <!-- Title -->
  <text x="600" y="140" text-anchor="middle" font-family="monospace" font-size="56"
        font-weight="700" fill="#10B981">AgentBnB</text>
  <!-- Tagline -->
  <text x="600" y="195" text-anchor="middle" font-family="monospace" font-size="20"
        fill="rgba(255,255,255,0.55)">Your agent has idle APIs. It knows. It wants to trade them.</text>
  <!-- Accent line -->
  <line x1="480" y1="220" x2="720" y2="220" stroke="#10B981" stroke-width="1" opacity="0.4"/>
</svg>
```

### README Banner Placement
```markdown
<p align="center">
  <img src="docs/banner.svg" alt="AgentBnB — P2P Agent Capability Sharing" width="100%">
</p>
```

### README Hub Screenshot Placement
```markdown
<p align="center">
  <img src="docs/hub-screenshot.png" alt="AgentBnB Hub — premium dark SaaS dashboard" width="100%">
</p>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain text README | README with badges + screenshot (Phase 15) | Phase 15 (v2.2) | Partial — badges and install table exist; hero and structure still needed |
| No screenshot | 0-byte placeholder `docs/hub-screenshot.png` | Phase 15 (v2.2) | Placeholder must be replaced with real screenshot |
| Generic section names | Standard sections (What, Install, Quick Start, Architecture, Contributing) | Phase 18 (this phase) | Enables quick scanning by first-time GitHub visitors |

**Deprecated/outdated:**
- `docs/hub-screenshot.png` (0-byte placeholder): Replace with real PNG.
- Vague "The Core Idea" section name: Rename to "What Is This?" for clarity.

---

## Open Questions

1. **Should the screenshot show populated card data or the empty state?**
   - What we know: `vite preview` serves the built Hub without a backend proxy; card fetches will fail gracefully with empty state
   - What's unclear: Whether the founder wants to run a local agentbnb instance during screenshotting to populate cards
   - Recommendation: Take the empty-state screenshot first (it still shows the premium dark UI). Note in plan that optionally the founder can run `agentbnb serve` locally and re-run the script for a populated screenshot. README-04 just says "real screenshot," not "populated."

2. **Exact GitHub repo path for badges**
   - What we know: STATE.md notes "Confirm exact GitHub repository path (Xiaoher-C/agentbnb vs chengwenchen/agentbnb)" as a pending todo
   - What's unclear: Which GitHub username is canonical for public launch
   - Recommendation: Plan uses `Xiaoher-C/agentbnb` (the value currently in README badges from Phase 15). If the repo path changes pre-launch, badges are updated in Phase 19 pre-flight.

3. **Does the doodle creature SVG belong in the banner?**
   - What we know: The doodle creature SVG (`agentbnb-doodle-creature.svg`) uses `#2C2C2A` stroke (near-black on white) and is designed for light backgrounds. In NavBar it uses `currentColor` for dark theme.
   - What's unclear: Whether inlining the creature paths into the banner SVG is worth the complexity
   - Recommendation: Include creature in banner — adapt stroke color to `rgba(255,255,255,0.7)` or emerald `#10B981`. A recognizable mascot in the banner differentiates AgentBnB from generic developer tools.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.0.4 |
| Config file | `hub/vite.config.ts` (test section) + root `vitest` |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| README-01 | Badges present in README.md | manual-only | N/A — visual inspection of README | N/A |
| README-02 | Hero banner image renders on GitHub | manual-only | N/A — visual/GitHub render check | N/A |
| README-03 | Sections: What, Install, Quick Start, Architecture, Contributing | manual-only | N/A — content structure check | N/A |
| README-04 | `docs/hub-screenshot.png` is non-zero bytes | smoke | `node -e "const fs=require('fs'); const s=fs.statSync('docs/hub-screenshot.png'); if(s.size===0) process.exit(1)"` | ✅ (file exists, 0 bytes) |

**Note on manual-only:** README content (badges, sections, images) is Markdown/HTML — no automated test framework covers it. Verification is visual inspection + `wc -c docs/hub-screenshot.png` to confirm non-zero file size.

### Sampling Rate
- **Per task commit:** `node -e "const fs=require('fs'); if(fs.statSync('docs/hub-screenshot.png').size===0) process.exit(1)"` (for README-04 only)
- **Per wave merge:** Full suite green (`pnpm test:run`)
- **Phase gate:** All existing tests pass + `hub-screenshot.png` size > 0 + manual visual review of README

### Wave 0 Gaps
- [ ] `scripts/take-screenshot.mjs` — the screenshot script itself (created in Wave 1, not a test gap)

*(No test framework gaps — existing Vitest infrastructure covers all automated checks; README content validation is manual-only by nature.)*

---

## Sources

### Primary (HIGH confidence)
- `playwright.dev/docs/screenshots` — screenshot API, `path` parameter, `setViewportSize`
- `shields.io/badges/npm-version` — badge URL format confirmed
- `hub/vite.config.ts` in repo — `base: '/hub/'`, dev server proxy config, preview port behavior
- `hub/src/index.css` in repo — brand colors (#08080C, #10B981) confirmed
- `agentbnb-doodle-creature.svg` in repo — mascot paths and design
- `README.md` in repo — current state of badges and sections

### Secondary (MEDIUM confidence)
- github.com/matiassingers/awesome-readme — structural patterns (logo+badge+description trio, TOC, GIF demo)
- dev.to/grahamthedev — SVG foreignObject for GitHub READMEs (confirmed GitHub limitation: foreignObject doesn't render)
- driesvints.com/blog — dark mode SVG investigation (confirmed: `<img src=".svg">` works; CSS media queries inside SVG work in file mode)

### Tertiary (LOW confidence)
- WebSearch results on "README hero banner best practices" — general patterns, not verified against specific GitHub behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Playwright confirmed installed and working; shields.io URLs are well-documented; SVG rendering on GitHub is a known, stable behavior
- Architecture: HIGH — based on direct inspection of repo files (current README, vite.config, brand colors)
- Pitfalls: HIGH — Vite base path issue is verifiable from config; SVG foreignObject limitation is a documented GitHub behavior; badge duplication is verifiable from current README

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain — GitHub Markdown rendering, shields.io, Playwright are slow-moving)
