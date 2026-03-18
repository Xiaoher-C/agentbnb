# AgentBnB Project Brain — Map of Content

> This is the knowledge graph for AgentBnB development.
> Claude Code: read this file at the start of every session.
> For deep context on specific domains, read the linked files.

## Quick Navigation

**Working on gateway/protocol?** → [[architecture.md#gateway]]
**Working on credits?** → [[architecture.md#credit-system]], [[credit-pricing.md]], [[gaps.md#credit-registry-migration]]
**Working on Hub UI?** → [[architecture.md#hub]]
**Adding features?** → [[vision.md]], [[decisions.md]]
**Deploying?** → [[gaps.md#deployment]]
**Checking what's complete?** → [[milestones.md]]
**Understanding design philosophy?** → [[vision.md]], also read `/AGENT-NATIVE-PROTOCOL.md`
**Skill strategy & pricing?** → [[skill-strategy.md]], [[credit-pricing.md]]
**Conductor vision?** → [[conductor.md]], [[conductor-demo.md]]

## Project Status (2026-03-19)

- **v3.0 complete**: SkillExecutor (5 modes), Conductor, Signed Escrow — shipped 2026-03-17
- **v3.1 complete**: WebSocket relay, remote registry, public network — shipped 2026-03-18
- **npm agentbnb v3.1.6** published, hub.agentbnb.dev live on Fly.io (Tokyo nrt)
- **Next**: v3.2 — Registry Credit Ledger + Relay Timeout Fix (see [[gaps.md#credit-registry-migration]])

## File Index

```
docs/brain/
├── 00-MOC.md              ← You are here
├── vision.md              ← Core insight, economic model, design principles
├── architecture.md        ← Gateway, credits, registry, autonomy, hub, openclaw
├── gaps.md                ← Known architecture gaps blocking launch
├── decisions.md           ← Key design decisions with rationale (ADR-001 ~ ADR-021)
├── conductor.md           ← Orchestrator agent design (task decomposition + multi-agent coordination)
├── conductor-demo.md      ← Conductor cold start narrative (north star vision, v4.0+)
├── skill-strategy.md      ← Three-layer skill depth framework (L1/L2/L3)
├── credit-pricing.md      ← Credit pricing rules, free pricing model, conductor fee
├── source-map.md          ← Every key file with one-line description
├── coverage-map.md        ← Test suites and what they cover
└── milestones.md          ← v1.1 → v2.3 summary
```

## Tags

- `#status/complete` — Implemented and tested
- `#status/gap` — Known deficiency, needs work
- `#status/planned` — Designed but not implemented
- `#domain/gateway` `#domain/credit` `#domain/hub` `#domain/autonomy` `#domain/openclaw` `#domain/registry`
