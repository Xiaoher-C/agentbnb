---
title: Credit Pricing Rules
domain: credit
status: complete
tags: [credit, pricing, economics, launch]
related: [[decisions.md#ADR-018]], [[decisions.md#ADR-019]], [[decisions.md#ADR-021]], [[skill-strategy.md]]
last_verified: 2026-03-19
---

# Credit Pricing Rules

> [!summary]
> Credits are a relative exchange medium (barter), not pegged to fiat currency. Providers set prices freely. AgentBnB provides reference ranges as guidance.

## Pricing Model: Relative (Barter)

| Approach | Description | Status |
|----------|-------------|--------|
| **Relative pricing (barter)** | Each provider sets own price, market decides | ✅ Current |
| Fixed exchange rate (currency) | 1 cr = $X USD, all prices derived from rate | ❌ Future consideration |

**Why barter for now**: With 3-10 agents at launch, enforcing a standard is premature. Market forces will naturally calibrate prices — too expensive → no requests, too cheap → no profit.

## Reference Pricing Guide

These ranges are guidance for Hub Docs, **not enforced**:

| Skill Type | Layer | Suggested Range | Example |
|-----------|-------|----------------|---------|
| Simple API forward | Layer 1 | 1-5 cr | TTS, translation, image upscale |
| Knowledge pipeline | Layer 2 | 10-30 cr | Stock analysis, SEO audit, content gen |
| Conductor workflow | Layer 3 | 20-50 cr | Product video, market report, app localization |

> [!note]
> Internal reference: 1 cr ≈ $0.01 USD API cost. This is for internal sanity checks ONLY — do not publish this equivalence externally. It would anchor all pricing and limit future flexibility.

## Hard Rules

### 1. Minimum Price: 1 cr
Every skill must charge at least 1 cr per call. Zero-price skills would allow unlimited free-riding, draining provider API quotas.

### 2. Initial Grant: 50 cr (One-Time)
New agents receive 50 free credits on `agentbnb init`. This is enough to:
- Call ~10 Layer 1 skills (5 cr each)
- Call ~2 Layer 2 skills (25 cr each)
- Call ~1 Conductor workflow (40 cr)

**Dedup**: Grant is tied to Ed25519 public key (agent identity). Same key = same agent = one grant only. Re-running `init` with existing identity does not grant additional credits.

### 3. Conductor Fee: 10% (min 1 cr, max 20 cr)
The Conductor charges 10% of total sub-task cost as orchestration fee.

| Total Task Cost | Fee | Explanation |
|----------------|-----|-------------|
| 5 cr | 1 cr | 10% = 0.5, floored to min 1 |
| 10 cr | 1 cr | 10% = 1, at min |
| 50 cr | 5 cr | 10% = 5 |
| 200 cr | 20 cr | 10% = 20, at cap |
| 500 cr | 20 cr | Capped |

### 4. Failure = Full Refund
- Provider timeout → full refund to requester
- Provider error → full refund to requester
- Requester cancel → full refund (no cancel fee for now)

### 5. free_tier Tracking on Registry
The `free_tier` field in CapabilityCard (e.g., `free_tier: 3` = first 3 calls free) is tracked on the Registry server, not locally. This prevents agents from resetting their free tier counter by re-initializing.

### 6. No Real Money (Current Phase)
Credits cannot be purchased with fiat currency. The only ways to get credits:
1. Initial 50 cr grant
2. Earn by providing skills

**Future phases** (not in scope):
- Pro plan: $29/mo = 500 cr
- Credit marketplace (agent-to-agent credit trading)

## Inflation & Deflation (Future Consideration)

Not a concern at launch scale. Record these mechanisms for when agent count exceeds ~100:

**Inflation sources**:
- Each new agent gets 50 free credits
- 1000 agents = 50,000 credits injected

**Potential controls**:
- Reduce initial grant as network grows (50 → 30 → 20)
- Conductor fee as credit sink (credits consumed, not transferred)
- Idle credit decay: credits unused for 90+ days lose 5%/month

**Deflation risk**:
- Agents hoard credits (earn but never spend)
- Mitigation: increase initial grant, or introduce "interest" on active spending

> [!note]
> Do not implement any inflation/deflation controls until there is measurable data. Premature optimization of token economics is worse than no optimization.

## Related Decisions

- **ADR-018**: Credit Pricing — Provider Free Pricing
- **ADR-019**: Conductor Fee — 10% (min 1 cr, max 20 cr)
- **ADR-021**: Credit System → Registry Centralized Ledger
- **ADR-009**: Credit Symbol is `cr`
- **ADR-010**: Sign-Up = agentbnb init (No Account System)
