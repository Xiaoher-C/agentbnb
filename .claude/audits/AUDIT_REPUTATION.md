# Reputation Audit

Audited: 2026-03-21

---

## Issue 3: AutoRequestor scoring — card-level vs skill-level

**Status**: FIXED

**Files**:
- `src/autonomy/auto-request.ts` — `Candidate` interface, `scorePeers()`, `requestWithAutonomy()`

**Finding**:

`scorePeers()` read only card-level `card.metadata?.success_rate` and `card._internal?.idle_rate`, even when the candidate was a v2.0 skill with its own per-skill `metadata.success_rate` and `_internal.idle_rate`. The `requestWithAutonomy()` method correctly flattened v2.0 multi-skill cards into per-skill `Candidate` objects (with `skillId` set), but dropped the per-skill metadata in the process — so all skills from the same card received identical scores, defeating the purpose of per-skill performance tracking.

The bug manifests when a v2.0 card exposes two skills with different success rates (e.g. skill A = 0.95, skill B = 0.30). Before the fix, both were scored using only `card.metadata.success_rate` (card-level EWA aggregate). After the fix, skill A gets its per-skill rate (0.95) and skill B gets its per-skill rate (0.30), producing correct relative ranking.

**Action taken**:

1. Added two new optional fields to the `Candidate` interface:
   - `skillMetadata?: { success_rate?: number }` — carries skill-level metadata for v2.0 candidates
   - `skillInternal?: Record<string, unknown>` — carries skill-level `_internal` (e.g. `idle_rate`) for v2.0 candidates

2. Updated `requestWithAutonomy()` Step 2 to carry per-skill metadata when building v2.0 candidates. The inline type cast was expanded to include `metadata` and `_internal` on each skill object.

3. Updated `scorePeers()` to prefer `candidate.skillMetadata.success_rate` over `card.metadata.success_rate`, and prefer `candidate.skillInternal.idle_rate` over `card._internal.idle_rate`. Falls back to card-level for both when skill-level fields are absent (v1.0 cards or v2.0 skills without explicit metadata).

The fix is backward-compatible: v1.0 cards produce candidates without `skillMetadata`/`skillInternal`, so the fallback path is identical to the pre-fix behavior.

**Risk**: Low — additive change, no schema migration. Existing tests for `scorePeers()` pass (7/7). The 13 DB-dependent integration tests fail due to a pre-existing `better-sqlite3` native module version mismatch (NODE_MODULE_VERSION 141 vs 137), confirmed present before and after the fix.

---

## Issue 8: Reputation source — execution signals vs feedback signals — unified or split?

**Status**: DOCUMENTED

**Files**:
- `src/registry/store.ts` — `updateReputation()` (EWA success_rate on card metadata, execution-based)
- `src/feedback/store.ts` — `insertFeedback()`, `getFeedbackForProvider()` (feedback table)
- `src/feedback/reputation.ts` — `getReputationScore()`, `computeReputation()` (feedback-only score)
- `src/registry/matcher.ts` — `buildReputationMap()`, `applyReputationFilter()` (feedback-only)
- `src/registry/server.ts` — `/cards` API, `reputation_score` field, `sort=reputation_desc/asc`

**Finding**:

Two separate reputation signals exist and are NOT unified:

1. **Execution-based signal**: `card.metadata.success_rate` — updated by `updateReputation()` using Exponentially Weighted Average (alpha=0.1) on each execution outcome. Lives on the card JSON blob. Drives `sort=success_rate`, `sort=rated`, the `performance_tier` trust badge, and the `min_success_rate` filter.

2. **Feedback-based signal**: `feedback` table — stores structured peer ratings (1-5 star + quality + cost_value_ratio + would_reuse). Computed by `computeReputation()` with recency decay. Drives `reputation_score` field on `/cards` API items, `sort=reputation_desc/asc`, `min_reputation` filter, and `GET /api/reputation/:agent_id`.

The `/cards` API response exposes both separately: `metadata.success_rate` (execution EWA) and `reputation_score` (feedback-only). These two values can diverge significantly — e.g. an agent with 100% execution success rate but negative peer feedback would show high `success_rate` but low `reputation_score`.

**Why not fixed (architectural conflict)**:

CLAUDE.md explicitly documents a two-axis trust model: "Two-axis trust model (keep these separate) — performance_tier (execution metrics) vs verification_badges (external grants)". The current architecture was designed with this separation in mind. Unifying the two into a single score would:

- Require a new composite score field (e.g. `composite_reputation`) alongside the existing fields, to avoid breaking the Hub v2 trust layer that displays them separately
- Require a new weighting decision (e.g. what fraction of the score should be execution-based vs feedback-based?) that is not yet specified in the roadmap
- Potentially conflict with the Phase 2 verification engine roadmap, which plans to introduce `verification_badges` as a third trust axis

**Recommended next step** (not implemented — requires roadmap alignment):

If a unified score is desired, the correct approach is to add a new `composite_reputation_score` field computed in `buildReputationMap()` as a weighted combination. Suggested starting weights: 0.6 x feedback_score + 0.4 x min(execution_success_rate, 1.0). This preserves the existing separate fields while adding a unified sort/filter option. This should be tracked as a roadmap item, not a hotfix.

**Risk**: High — unifying without roadmap alignment could break the two-axis trust model displayed in the Hub and documented in CLAUDE.md. No code change made.
