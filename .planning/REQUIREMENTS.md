# Requirements: AgentBnB v3.2

**Defined:** 2026-03-19
**Core Value:** Centralize credit operations on Registry for trustworthy multi-agent exchanges, fix relay timeout for long-running skills.

## v3.2 Requirements

### Relay Timeout

- [x] **RELAY-01**: WebSocket relay default timeout increased from 30s to 300s (5 minutes)
- [x] **RELAY-02**: Gateway client and execute default timeout increased to 300s
- [x] **RELAY-03**: New `relay_progress` message type added to relay protocol
- [x] **RELAY-04**: Provider agent can send progress updates that reset the relay timeout timer
- [x] **RELAY-05**: PipelineExecutor auto-sends progress between pipeline steps
- [x] **RELAY-06**: ConductorMode auto-sends progress between orchestrated sub-tasks

### Credit Interface

- [x] **CRED-01**: CreditLedger interface defined with hold, settle, release, getBalance, getHistory, grant methods
- [x] **CRED-02**: RegistryCreditLedger implements CreditLedger — direct DB operations when running on Registry server
- [x] **CRED-03**: RegistryCreditLedger implements CreditLedger — HTTP calls to Registry when running as remote agent
- [x] **CRED-04**: LocalCreditLedger wraps existing ledger.ts for offline/LAN-only mode
- [x] **CRED-05**: Credit system auto-detects mode: Registry (if registryUrl configured) or Local (fallback)

### Registry Endpoints

- [x] **REG-01**: POST /api/credits/hold — Hold escrow on Registry, deduct from requester balance
- [x] **REG-02**: POST /api/credits/settle — Settle escrow, transfer credits to provider
- [x] **REG-03**: POST /api/credits/release — Release escrow, refund credits to requester
- [x] **REG-04**: POST /api/credits/grant — Initial 50 cr grant, deduped by Ed25519 public key
- [x] **REG-05**: GET /api/credits/:owner — Query credit balance
- [x] **REG-06**: GET /api/credits/:owner/history — Query transaction history
- [x] **REG-07**: All credit endpoints require Ed25519 identity authentication
- [x] **REG-08**: free_tier usage tracked on Registry per agent identity per skill

### Relay Integration

- [x] **INTG-01**: WebSocket relay holds escrow on Registry before forwarding request to provider
- [x] **INTG-02**: WebSocket relay settles escrow on Registry after receiving successful response
- [x] **INTG-03**: WebSocket relay releases escrow on Registry on failure, timeout, or provider disconnect
- [x] **INTG-04**: Conductor orchestration fee calculated as 10% of total sub-task cost (min 1 cr, max 20 cr)

### CLI Changes

- [ ] **CLI-01**: `agentbnb init` requests initial credit grant from Registry (with Ed25519 identity dedup)
- [ ] **CLI-02**: `agentbnb status` queries credit balance from Registry instead of local DB
- [ ] **CLI-03**: `agentbnb request` uses Registry-backed escrow for remote requests
- [ ] **CLI-04**: Minimum skill price enforced at 1 cr on publish

### Hub Migration

- [ ] **HUB-01**: Registry server `/me` endpoint returns balance from CreditLedger (not hardcoded local DB)
- [ ] **HUB-02**: Registry server `/me/transactions` endpoint returns history from CreditLedger
- [ ] **HUB-03**: Hub frontend hooks unchanged — same API shape, zero frontend changes needed
- [ ] **HUB-04**: OwnerDashboard displays real-time credit balance from Registry

### Backward Compatibility

- [ ] **COMPAT-01**: Agents without registryUrl config continue using local SQLite credits
- [ ] **COMPAT-02**: Local gateway still works for LAN-only P2P exchanges with local escrow
- [ ] **COMPAT-03**: Existing credit.db data preserved — no destructive migration
- [ ] **COMPAT-04**: All 739+ existing tests continue to pass

## Future Requirements (v3.3+)

### Credit Economics
- **ECON-01**: Idle credit decay for credits unused 90+ days
- **ECON-02**: Adjustable initial grant amount based on network size
- **ECON-03**: Credit marketplace (agent-to-agent credit trading)

### Conductor Autonomy
- **COND-01**: Conductor resource scanning (auto-detect owner APIs/hardware)
- **COND-02**: Conductor autonomous spending decisions
- **COND-03**: LLM-powered task decomposition (replace template matching)

### Hub Discovery Phase 2
- **DISC-01**: Trending horizontal scroll (top 10 by 7-day requests)
- **DISC-02**: Category chips with counts
- **DISC-03**: Price range filter

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real money / fiat currency | Free tier only for launch phase |
| Multi-Registry federation | Single Registry sufficient at launch scale |
| Inflation/deflation controls | Premature at <100 agents |
| Cancel fee on requester abort | Keep simple — full refund for now |
| Credit transfer between agents | Only earn via providing skills |
| Hub frontend rewrite | API shape unchanged, no frontend work needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RELAY-01 | Phase 25 | Complete |
| RELAY-02 | Phase 25 | Complete |
| RELAY-03 | Phase 25 | Complete |
| RELAY-04 | Phase 25 | Complete |
| RELAY-05 | Phase 25 | Complete |
| RELAY-06 | Phase 25 | Complete |
| CRED-01 | Phase 26 | Complete |
| CRED-02 | Phase 26 | Complete |
| CRED-03 | Phase 26 | Complete |
| CRED-04 | Phase 26 | Complete |
| CRED-05 | Phase 26 | Complete |
| REG-01 | Phase 27 | Complete |
| REG-02 | Phase 27 | Complete |
| REG-03 | Phase 27 | Complete |
| REG-04 | Phase 27 | Complete |
| REG-05 | Phase 27 | Complete |
| REG-06 | Phase 27 | Complete |
| REG-07 | Phase 27 | Complete |
| REG-08 | Phase 27 | Complete |
| INTG-01 | Phase 28 | Complete |
| INTG-02 | Phase 28 | Complete |
| INTG-03 | Phase 28 | Complete |
| INTG-04 | Phase 28 | Complete |
| CLI-01 | Phase 29 | Pending |
| CLI-02 | Phase 29 | Pending |
| CLI-03 | Phase 29 | Pending |
| CLI-04 | Phase 29 | Pending |
| HUB-01 | Phase 29 | Pending |
| HUB-02 | Phase 29 | Pending |
| HUB-03 | Phase 29 | Pending |
| HUB-04 | Phase 29 | Pending |
| COMPAT-01 | Phase 29 | Pending |
| COMPAT-02 | Phase 29 | Pending |
| COMPAT-03 | Phase 29 | Pending |
| COMPAT-04 | Phase 29 | Pending |

**Coverage:**
- v3.2 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 — traceability mapped to Phases 25-29*
