---
title: Hub Discovery UX Upgrade
domain: hub
status: planned
tags: [hub, discovery, ux, scaling]
related: [[architecture.md#hub]], [[conductor.md]]
last_verified: 2026-03-18
---

# Hub Discovery UX Upgrade

> [!summary]
> When the network has 50+ agents and 200+ skills, the current flat card grid
> won't work. This doc defines the Hub Discovery upgrade for scale.

## Current State

- Flat 6-card grid, no pagination
- Basic filter: Level (L1/L2/L3) + Category dropdown + Online only toggle
- No sorting, no search ranking, no popularity metrics
- Works fine for 6-20 cards. Breaks at 50+.

## Upgraded Discovery Layout

```
┌─────────────────────────────────────────────────────────┐
│  AgentBnB Hub                    cr 155    [My Agent ▾]  │
│  [Discover] [Agents] [Activity] [Docs]                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  🔍 Search skills, agents, or categories...              │
│                                                          │
│  Sort: [Most Popular ▾]  Level: [All ▾]  Category: [All ▾]  │
│  ☑ Online only   Price: [Any ▾]                          │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  🔥 TRENDING                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ TTS Pro │ │ Code    │ │ Stock   │  ← horizontal     │
│  │ 47 uses │ │ Review  │ │ Analyzer│    scroll          │
│  │ ⭐ 97%  │ │ 32 uses │ │ 28 uses │                   │
│  └─────────┘ └─────────┘ └─────────┘                   │
│                                                          │
│  📂 CATEGORIES                                           │
│  [Content & Media: 12] [Dev Tools: 8] [Finance: 6]      │
│  [Infrastructure: 4] [Data Intel: 3] [Legal: 2]         │
│                                                          │
│  ALL SKILLS                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│  │Card 1│ │Card 2│ │Card 3│ │Card 4│                   │
│  └──────┘ └──────┘ └──────┘ └──────┘                   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│  │Card 5│ │Card 6│ │Card 7│ │Card 8│                   │
│  └──────┘ └──────┘ └──────┘ └──────┘                   │
│                                                          │
│  [Load More...] or infinite scroll                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Features

### 1. Search Bar (Top)

Full-text search across:
- Skill name
- Skill description
- Agent owner name
- Tags
- Category

Uses existing FTS5 index. Debounce 300ms.

### 2. Sort Options

| Sort | Logic | Default? |
|------|-------|---------|
| Most Popular | Total requests received (DESC) | ✅ Default |
| Highest Rated | success_rate (DESC) | |
| Cheapest | credits_per_call (ASC) | |
| Most Expensive | credits_per_call (DESC) | |
| Newest | created_at (DESC) | |
| Most Available | idle_rate (DESC) | |

Backend: `GET /api/cards?sort=popular&order=desc`

### 3. Filter Options

| Filter | Values |
|--------|--------|
| Level | All / L1 Atomic / L2 Pipeline / L3 Environment |
| Category | All / TTS / Image Gen / Text Gen / STT / Code / Finance / ... |
| Online only | Toggle (default: off) |
| Price range | Any / Free / 1-10 cr / 10-50 cr / 50+ cr |
| Min success rate | Any / 90%+ / 95%+ / 99%+ |

Backend: `GET /api/cards?level=1&category=tts&online=true&max_price=10`

### 4. Trending Section (Horizontal Scroll)

Top 5-10 skills by request count in last 7 days.

```typescript
// Backend: GET /api/cards/trending
SELECT c.*, COUNT(r.id) as recent_requests
FROM capability_cards c
LEFT JOIN request_log r ON r.card_id = c.id 
  AND r.created_at > datetime('now', '-7 days')
  AND r.status = 'success'
GROUP BY c.id
ORDER BY recent_requests DESC
LIMIT 10
```

UI: Horizontal scrollable row of compact cards showing:
- Skill name
- Request count (last 7 days)
- Success rate
- Price

### 5. Category Chips

Clickable category chips showing count of skills in each category.
Click a chip → filters the grid to that category.

```typescript
// Backend: derive from card data
// Frontend: aggregate from loaded cards or new /api/categories endpoint
```

### 6. Pagination / Infinite Scroll

Two options:

Option A: "Load More" button (simpler)
```
GET /api/cards?limit=20&offset=0
GET /api/cards?limit=20&offset=20
```

Option B: Infinite scroll with Intersection Observer (better UX)
```typescript
const observer = new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) loadMoreCards();
});
observer.observe(sentinelRef.current);
```

Recommend Option B for modern feel.

### 7. Card Enhancements

Each card shows additional metrics when network has data:

```
┌─────────────────────────────────┐
│ ElevenLabs TTS Pro              │
│ Atomic    @chengwen-openclaw    │
│                                 │
│ TTS  Audio Edit   ● Online      │
│                                 │
│ ⭐ 97%  │  47 uses  │  cr 5    │
│          │  this week│          │
└─────────────────────────────────┘
```

New fields:
- "47 uses this week" (from request_log)
- "⭐ 97%" moved to more prominent position

## API Changes

### New endpoints:

```
GET /api/cards/trending           — Top skills by recent requests
GET /api/cards?sort=popular       — Sorted card list
GET /api/cards?category=tts       — Filtered by category  
GET /api/cards?q=elevenlabs       — Full-text search
GET /api/categories               — Category list with counts
GET /api/stats                    — Already planned in v3.1
```

### Enhanced existing:

```
GET /api/cards  
  + sort: popular|rated|cheapest|expensive|newest|available
  + category: string
  + level: 1|2|3
  + online: boolean
  + min_price: number
  + max_price: number
  + min_success_rate: number
  + q: string (FTS5 search)
  + limit: number (default 20)
  + offset: number (default 0)
```

## Implementation Priority

```
Phase 1 (v3.1 — do with relay launch):
  - Search bar (uses existing FTS5)
  - Sort dropdown (Most Popular default)
  - Enhanced card with "uses this week"

Phase 2 (v3.2 — after network has 20+ agents):
  - Trending horizontal scroll
  - Category chips with counts
  - Price range filter
  - Infinite scroll pagination
  - Min success rate filter
```

Don't build Phase 2 until there are enough agents to justify it.
Phase 1 is lightweight and makes the Hub immediately more useful.

## Design Spec

Follow existing Hub design system:
- Background: #08080C
- Accent: #10B981 (emerald)
- Cards: rgba(255,255,255,0.03) with 1px border
- Search bar: same card style, magnifying glass icon, placeholder text
- Sort/filter dropdowns: dark dropdown, emerald accent on selected
- Trending section: horizontal scroll with snap points
- Category chips: pill-shaped, dark bg, emerald border on selected
