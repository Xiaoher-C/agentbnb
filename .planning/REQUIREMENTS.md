# Requirements: AgentBnB

**Defined:** 2026-03-24
**Core Value:** No good protocol exists for agent-to-agent capability exchange. AgentBnB fills that gap — making it easy for any agent to discover, execute, and orchestrate another agent's skills.

## v6.0 Requirements

### COND — Conductor Enhancement

- [x] **COND-01**: Conductor finds task_decomposition provider via `capability_type` key lookup first, falls back to text search only if no exact match found
- [x] **COND-02**: External decomposition output is normalized and validated before entering CapabilityMatcher, including: required fields present, unique subtask IDs, valid dependency references, acyclic DAG (topological sort), valid role values, sane estimated_credits values
- [x] **COND-03**: Conductor enforces depth limits — `decomposition_depth >= 1` routes to Rule Engine directly; `orchestration_depth >= 2` returns error without executing
- [x] **COND-03b**: Conductor does not select itself as the task_decomposition provider unless explicitly configured for local fallback mode
- [x] **COND-04**: genesis-template SOUL.md declares `task_decomposition` skill with `capability_type: task_decomposition` by default
- [x] **COND-05**: AgentBnB bootstrap.ts `activate()` auto-registers a `task_decomposition` Capability Card with `capability_type` field set
- [x] **COND-06**: If no task_decomposition provider is available, or remote decomposition fails validation or execution, Conductor falls back to the built-in Rule Engine without breaking existing `agentbnb conduct` behavior

### RESIL — Production Resilience

- [x] **RESIL-01**: System categorizes execution failures with FailureReason enum: `bad_execution` | `overload` | `timeout` | `auth_error` | `not_found`; failure_reason recorded in request_log
- [x] **RESIL-02**: `overload` failures are excluded from the reputation score denominator — overload does not reduce provider reputation
- [x] **RESIL-03**: Per-skill `capacity.max_concurrent` can be declared in skills.yaml; gateway tracks in-flight count per skill_id
- [x] **RESIL-04**: When max_concurrent is exceeded, gateway returns a structured busy/overload response without executing the skill, and the event is recorded with `failure_reason: overload`

### TEAM — Team Formation

- [x] **TEAM-01**: Role type defines exactly 4 values as routing hints only — `researcher` | `executor` | `validator` | `coordinator`; roles are not authorization boundaries or hierarchy levels
- [x] **TEAM-02**: Conductor can form a Team from SubTask[] — each SubTask with a role hint maps to a TeamMember with matched agent; supports `cost_optimized`, `quality_optimized`, `balanced` formation strategies
- [x] **TEAM-03**: Pipeline execution schedules sub-tasks using role-aware agent selection; same role-hint subtasks may be batched to the same agent if capacity allows

### TRACE — Team Traceability

- [x] **TRACE-01**: request_log records `team_id` and `role` columns for team-originated executions
- [x] **TRACE-02**: Hub request history displays role context when `role` is present in log entries

## v7.0 Requirements (Deferred)

### BRIDGE — External Swarm Integration

- **BRIDGE-01**: TeamBridge interface defines pluggable adapter for external swarm frameworks
- **BRIDGE-02**: ClawTeam Bridge implements first external framework adapter
- **BRIDGE-03**: Fallback to native AgentBnB team execution when no bridge available

### REPGRAPH — Team-Aware Reputation Graph

- **REPGRAPH-01**: Reputation weighting accounts for team role context
- **REPGRAPH-02**: Role-level success rate computed from team execution history
- **REPGRAPH-03**: Team coordinator reputation includes orchestration quality dimension

## Out of Scope

| Feature | Reason |
|---------|--------|
| LLM SDK in AgentBnB core | Violates agent-native philosophy — decomposition is a capability, not infrastructure |
| Role hierarchy / specialist taxonomy | Complexity not justified until team executions are validated in production |
| Role-based access control / permissions | Roles are routing hints only |
| Multi-provider routing / dynamic pricing | Long-term v7+ |
| Node-level backpressure | Per-owner relay rate limit (60/min) is sufficient at current scale |
| ClawTeam Bridge | Wait for stable team model + real execution cases |
| team-aware reputation weighting | Wait for real data before modeling |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| COND-01 | Phase 50 | Complete |
| COND-02 | Phase 50 | Complete |
| COND-03 | Phase 50 | Complete |
| COND-03b | Phase 50 | Complete |
| COND-04 | Phase 50 | Complete |
| COND-05 | Phase 50 | Complete |
| COND-06 | Phase 50 | Complete |
| RESIL-01 | Phase 51 | Complete |
| RESIL-02 | Phase 51 | Complete |
| RESIL-03 | Phase 51 | Complete |
| RESIL-04 | Phase 51 | Complete |
| TEAM-01 | Phase 52 | Complete |
| TEAM-02 | Phase 52 | Complete |
| TEAM-03 | Phase 52 | Complete |
| TRACE-01 | Phase 53 | Complete |
| TRACE-02 | Phase 53 | Complete |

**Coverage:**
- v6.0 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-24*
*Last updated: 2026-03-24 after v6.0 milestone start*
