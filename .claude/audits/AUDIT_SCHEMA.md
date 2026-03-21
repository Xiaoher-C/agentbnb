# Audit: Schema & Discovery (Issues 1, 2, 4)

Audited: 2026-03-21 | Auditor: schema-audit-agent + Claude Code

---

## Issue 1: v2 card-level vs skill-level mixing in discover/search/display

**Status**: DOCUMENTED (architectural gap — requires design decision)

**Files**:
- `hub/src/components/CapabilityCard.tsx`
- `hub/src/components/CardModal.tsx`
- `hub/src/types.ts` (`HubCard` type)
- `src/cli/index.ts` (discover command)

**Finding**:
The Hub `HubCard` type and all display components assume v1-shaped card-root fields (`name`, `level`, `pricing`, `inputs`, `outputs`, `description`). v2 cards store this information in `skills[]` at the array level, not at the card root. For any v2 multi-skill card:
- Hub `CapabilityCard.tsx` and `CardModal.tsx` would render blank name, undefined level badge
- `formatCredits(card.pricing)` would throw TypeError (pricing is undefined on v2)
- CLI `discover` has partial fallbacks (`card.name ?? card.agent_name`) but Hub has none

The CLI is partially safe for v1-compat cards (cards with both root AND skills[]), but breaks on pure v2.

**Action taken**: DOCUMENTED — not fixed.
Fixing requires either: (a) API-level projection that flattens v2 cards before sending to Hub, or (b) Hub-side multi-shape support. This is a significant design decision that should be planned as a dedicated phase.

**Risk**: High — any pure v2 card reaching the Hub will crash the card display.

---

## Issue 2: updateCard() v2 schema compatibility

**Status**: FIXED

**Files**: `src/registry/store.ts` (lines 2, 422)

**Finding**:
`updateCard()` was calling `CapabilityCardSchema.safeParse(merged)` — the v1-only schema that requires `name`, `description`, `level`, `inputs`, `outputs` at card root. Since v2 cards have none of these at root, the result was:
- `PATCH /cards/:id` always returned 400 VALIDATION_ERROR for v2 cards
- `toggle-online` (which calls updateCard internally) would throw VALIDATION_ERROR for v2 cards

**Fix applied**:
- Added `AnyCardSchema` to import in `store.ts`
- Changed `updateCard()` to use `AnyCardSchema.safeParse(merged)` instead of `CapabilityCardSchema.safeParse(merged)`
- `AnyCardSchema` is a `discriminatedUnion` on `spec_version` supporting both v1 and v2 cards

**Risk**: High (before fix) — owner routes for v2 cards were completely broken.

---

## Issue 4: Search/filter/sort SQL — skill-level awareness

**Status**: FIXED (crashes) + DOCUMENTED (silent exclusions)

**Files**: `src/registry/server.ts` (lines ~313, ~422)

### Fixed: sort=cheapest crash (TypeError)

**Finding**: `a.pricing.credits_per_call - b.pricing.credits_per_call` — `a.pricing` is `undefined` for v2 cards. Any call to `GET /cards?sort=cheapest` would throw TypeError and crash the route when v2 cards exist in the registry.

**Fix applied**: Changed cheapest sort to check `pricing?.credits_per_call` first, falling back to `skills?.[0]?.pricing?.credits_per_call`, then `Infinity`. v2 cards sort by their first skill's price; cards with no price go last.

### Fixed: tag filter silently excluding all v2 cards

**Finding**: `c.metadata?.tags?.includes(tag)` — v2 cards have no root `metadata`. All v2 cards were silently dropped from any `?tag=...` query.

**Fix applied**: Changed tag filter to check both `c.metadata?.tags` (v1) and `c.skills?.flatMap(s => s.metadata?.tags)` (v2). A v2 card matches if any of its skills has the requested tag.

### Documented: level filter excludes all v2 cards (SQL)

**Finding**: `json_extract(data, '$.level')` in FTS5 filter SQL returns NULL for v2 cards (level is on skills[], not root). All v2 cards silently excluded from `?level=N` queries.
**Not fixed**: Requires SQL schema migration or stored computed column. Document for future phase.

### Documented: sort=rated and sort=latency deprioritize all v2 cards

**Finding**: `a.metadata?.success_rate` is undefined for v2 cards — they always sort as `-1` (last). Non-crashing but incorrect ordering.
**Not fixed**: Phase 1 acceptable — trust data is owner-level from request_log anyway. Document for skill-level trust phase.

**Risk (before fix)**: High for sort=cheapest crash; Medium for tag filter silent exclusion.
