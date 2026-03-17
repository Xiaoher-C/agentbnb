# AgentBnB Project Brain — Map of Content

> This is the knowledge graph for AgentBnB development.
> Claude Code: read this file at the start of every session.
> For deep context on specific domains, read the linked files.

## Quick Navigation

**Working on gateway/protocol?** → [[architecture.md#gateway]]
**Working on credits?** → [[architecture.md#credit-system]], [[gaps.md#cross-machine-credits]]
**Working on Hub UI?** → [[architecture.md#hub]]
**Adding features?** → [[vision.md]], [[decisions.md]]
**Deploying?** → [[gaps.md#deployment]]
**Checking what's complete?** → [[milestones.md]]
**Understanding design philosophy?** → [[vision.md]], also read `/AGENT-NATIVE-PROTOCOL.md`

## Project Status (2026-03-17)

- **59 plans completed** across 5 milestones (v1.1 → v2.0 → v2.1 → v2.2 → v2.3)
- **v2.3 Phase 16 complete**, Phase 17 (Below-Fold Sections) next
- **Hub**: 5 pages (Discover ✅, Agents ✅, Activity ✅, Docs ✅, My Agent ❌ 404)
- **Critical gap**: Credit system doesn't work across machines (see [[gaps.md#cross-machine-credits]])
- **Critical gap**: No real handlers exist — gateway dispatches to empty localhost:8080

## File Index

```
docs/brain/
├── 00-MOC.md              ← You are here
├── vision.md              ← Core insight, economic model, design principles
├── architecture.md        ← Gateway, credits, registry, autonomy, hub, openclaw
├── gaps.md                ← Known architecture gaps blocking launch
├── decisions.md           ← Key design decisions with rationale
├── conductor.md           ← Orchestrator agent design (task decomposition + multi-agent coordination)
├── source-map.md          ← Every key file with one-line description
├── coverage-map.md        ← Test suites and what they cover
└── milestones.md          ← v1.1 → v2.3 summary
```

## Tags

- `#status/complete` — Implemented and tested
- `#status/gap` — Known deficiency, needs work
- `#status/planned` — Designed but not implemented
- `#domain/gateway` `#domain/credit` `#domain/hub` `#domain/autonomy` `#domain/openclaw` `#domain/registry`
