# Pitfalls Research

**Domain:** Adding autonomous agent behavior to existing synchronous capability-sharing system (AgentBnB v2.0)
**Researched:** 2026-03-15
**Confidence:** HIGH (grounded in existing codebase analysis + OWASP 2026 agentic security framework + OpenClaw docs)

---

## Critical Pitfalls

### Pitfall 1: The Paradigm Shift Is Not Additive — It Touches Everything

**What goes wrong:**
The team treats "add idle monitoring" and "add auto-share" as new modules dropped alongside existing code. In reality, the gateway (`server.ts`) is currently a pure request-handler: it receives a call, executes it, and returns. Adding autonomous background behavior means the gateway process must now also *initiate* outbound calls, monitor system state on a timer, and make decisions — three things the current architecture has no interface for. The paradigm shift from "receive and respond" to "sense, decide, act" is a rewrite of the execution model, not an additive feature.

**Why it happens:**
The existing code is clean and modular. Developers see `auto-share.ts` as a new file that calls `insertCard()` on a timer. They don't see that this background loop now needs to share state with the HTTP server (same SQLite db handle), survive server restarts, and be shut down gracefully on SIGTERM — none of which are designed into the current gateway.

**How to avoid:**
Before writing any autonomous feature, define the "agent process model" explicitly: one long-running process that owns both the HTTP gateway and all background loops. Create a single `AgentRuntime` class that holds the database handles, starts the Fastify server, and owns all `setInterval`/`setTimeout` timers. All autonomous loops must be started and stopped through this runtime. Pass the runtime's database handles to all modules — never open new connections inside loops.

**Warning signs:**
- A new file opens its own `better-sqlite3` database connection (produces `SQLITE_BUSY` under load)
- Background loops are started in `bin/agentbnb.js` outside of gateway startup
- No cleanup in the `SIGTERM` handler for timers started by the new features

**Phase to address:**
The very first phase of v2.0 — before idle monitoring, before auto-share. Build the `AgentRuntime` scaffold first; all subsequent features plug into it.

---

### Pitfall 2: Idle Rate "Detection" Is a Fiction Without a Metrics Source

**What goes wrong:**
`idle_rate` appears in the AGENT-NATIVE-PROTOCOL.md as a real number (e.g., `idle_rate: 0.95`). Developers write a function that returns `idle_rate` — but there is no actual data source for this value. The v1.1 system has no instrumentation of how often each capability is called. The registry tracks `avg_latency_ms` and `success_rate` via EWA in `updateReputation()`, but has no call-frequency counter. An "idle rate" computed from no data is either hardcoded (always triggers sharing) or wrong (triggers at wrong times).

**Why it happens:**
The protocol spec describes the *desired state* (agent knows its utilization). The codebase doesn't yet have the *mechanism* to measure it. It's easy to write `const idle_rate = 1 - (calls_last_hour / capacity)` before building the call counter.

**How to avoid:**
Build the call-frequency tracking first. The `request_log` table already exists — add a `calls_per_hour` query against it for each card. `idle_rate` = `1 - (observed_calls_per_hour / max_calls_per_hour)`. `max_calls_per_hour` is declared by the owner in the card (add a `capacity.calls_per_hour` field). Without a real metric, auto-share must remain disabled even if the code is written.

**Warning signs:**
- `idle_rate` is computed without querying `request_log`
- `max_calls_per_hour` is hardcoded or missing from the card schema
- Auto-share activates immediately when the agent starts (before any call history exists)

**Phase to address:**
Idle monitoring phase. Define and instrument the metric before building the decision logic.

---

### Pitfall 3: Schema Migration Breaks Existing Cards — One-Card-Per-Agent Requires a Data Migration Strategy

**What goes wrong:**
v1.1 has a one-card-per-skill model: one `CapabilityCard` per capability (TTS, video-gen, etc.). v2.0 wants one-card-per-agent with a `skills[]` array. This is not additive. Every existing card in every deployed SQLite database is in the old format. If the new code reads old cards expecting `skills[]`, it gets `undefined`. If it writes a new card in the new format, FTS5 triggers (which do `json_extract(new.data, '$.name')`) break or produce garbage because the field structure changed.

**Why it happens:**
Schema changes look easy in TypeScript (just add `skills?: Skill[]` to the Zod schema). But the SQLite store uses `JSON.stringify(card)` / `JSON.parse(row.data)` — the database rows are opaque blobs. There's no ORM enforcing schema evolution. Old rows just sit there in the old format forever until someone writes a migration.

**How to avoid:**
Treat multi-skill cards as additive, not replacement. Option A: Keep the old `CapabilityCard` schema for existing one-skill cards; add a new `AgentCard` schema for the multi-skill model. The registry stores both, distinguished by a `card_type: 'skill' | 'agent'` field. Option B: Write an explicit migration script (`migrate-cards.ts`) that reads every card, wraps it in `skills: [existingCard]`, and re-writes the row. Run this migration at startup with a version guard (`PRAGMA user_version`). Never ship code that assumes all cards are the new format without first running the migration.

**Warning signs:**
- New Zod schema has `skills: z.array(...)` without a migration path for old cards
- FTS5 triggers are not updated when the card structure changes (silent data corruption in search)
- Tests only create cards in the new format, never load old-format cards

**Phase to address:**
Multi-skill card phase. Migration script must ship in the same PR as the schema change, and must be tested against real v1.1 card fixtures.

---

### Pitfall 4: Auto-Request Creates Escrow Deadlock When the Agent Requests Its Own Capability

**What goes wrong:**
Auto-request logic detects a capability gap and queries the registry. If the agent's own card matches the query (it knows how to do TTS, and the task requires TTS), the auto-requester selects itself as the best peer. It then initiates an escrow hold against its own balance and sends an HTTP request to its own gateway. The gateway receives the request, tries to hold another escrow, and the system either double-charges the agent or the synchronous SQLite write in the inner request deadlocks with the outer escrow hold (both within the same WAL write window).

**Why it happens:**
The peer-selection algorithm ranks by (reputation × idle_rate / cost). The local agent will always score well on its own capabilities. The auto-requester has no concept of "self" to exclude from the peer list.

**How to avoid:**
Peer-selection must explicitly exclude the requesting agent's `owner` from the candidate list. Add an assertion in `auto-request.ts`: `if (peer.owner === self.owner) continue`. Also: before initiating an auto-request, check if the local registry already has a matching card that is online — if yes, execute locally without escrow. Local execution should always take priority over network requests.

**Warning signs:**
- Integration tests don't check the case where the agent's own card matches the request
- Peer selection code has no `exclude_owner` parameter
- The HTTP client in auto-request points to `localhost:${port}` for its own gateway address

**Phase to address:**
Auto-request phase. Self-exclusion must be part of the initial peer-selection implementation, not added as a bug fix later.

---

### Pitfall 5: Autonomy Tiers Bypassed at Startup — Default Tier Is Too Permissive

**What goes wrong:**
Autonomy tiers (Tier 1: silent, Tier 2: notify-after, Tier 3: ask-before) require a configuration file or database row that is read at startup. If the config doesn't exist yet (first boot, or user deleted `~/.agentbnb/config.json`), the code falls back to a default. If that default is Tier 1 (full autonomy), the agent immediately starts sharing capabilities and spending credits without any owner awareness. This is the opposite of safe defaults.

**Why it happens:**
The design spec says "Tier 1 is the goal" (maximum autonomy). Developers read this and set Tier 1 as the default. Safe-defaults thinking requires defaulting to the most restrictive tier, not the most capable one.

**How to avoid:**
Default tier must be Tier 3 (ask before action). Auto-sharing and auto-requesting are DISABLED until the owner explicitly configures a tier. The first-run `agentbnb init` flow must ask the owner to select a tier — do not skip this step with `--yes`. After tier selection, write it to config with explicit confirmation. OWASP's 2026 Least-Agency principle: grant the minimum autonomy required, expand only on explicit owner request.

**Warning signs:**
- `config.json` has `"autonomy_tier": 1` as the hardcoded default
- `agentbnb init --yes` sets Tier 1 silently
- No test that verifies Tier 3 behavior when config is missing

**Phase to address:**
Autonomy tier phase. Default-to-restrictive must be baked into the tier system before any autonomous operations are wired up.

---

### Pitfall 6: Credit Budget Does Not Account for Held Escrow — Available Balance Is Over-Reported

**What goes wrong:**
The spending limit logic reads `getBalance(creditDb, owner)` and compares against the tier's spend limit. But `getBalance` returns the *settled* balance — it does not include credits currently held in `credit_escrow` with status `'held'`. If the agent has 100 credits, a 40-credit escrow is held, and the limit is 50 credits: the balance reads as 60 (correct — the hold deducted it). But if the agent then auto-requests a 45-credit capability, the balance check passes (60 > 45), and now the agent has only 15 credits left — below any useful reserve.

Wait — actually the hold *does* deduct from balance (see `holdEscrow` in `escrow.ts`: `balance = balance - amount`). So the current escrow design is correct. The real version of this pitfall: **the reserve floor is not enforced before auto-request initiates an escrow hold.**

The correct failure mode: auto-request reads balance (60), holds escrow for 45 (balance now 15), then immediately tries another auto-request because another gap was detected. Balance is 15, hold for the second escrow fails with `INSUFFICIENT_CREDITS`. The system has no reserve enforcement — no floor that says "keep at least 20 credits liquid."

**Why it happens:**
The reserve concept (`HEARTBEAT.md` mentions "maintain minimum balance of 20 credits") is written in documentation but not enforced in code. `holdEscrow` doesn't know about reserves — it just checks `balance >= amount`.

**How to avoid:**
Before initiating any auto-request escrow, compute `effective_available = balance - configured_reserve`. Only proceed if `effective_available >= credits_needed`. The reserve amount is owner-configured (default: 20 credits). Add a `credit_budget.ts` module that wraps `holdEscrow` with reserve awareness. Never call `holdEscrow` directly from auto-request — always go through `budget.holdWithReserve(owner, amount)`.

**Warning signs:**
- Auto-request calls `holdEscrow` directly
- No `reserve` field in the autonomy tier config
- Tests don't verify behavior when balance approaches the reserve floor

**Phase to address:**
Credit budgeting phase — must ship before auto-request is activated.

---

### Pitfall 7: Background Timers Survive Graceful Shutdown — Leaving Orphaned Escrows

**What goes wrong:**
The idle monitor runs on a `setInterval`. When the user sends SIGTERM (to restart the agent), Node.js begins shutdown. If an auto-request was mid-flight (escrow held, HTTP request to peer in-flight), the timer fires one more time, starts a new escrow hold, then the process exits. The escrow is now `'held'` forever — it will never be settled or released. The agent's next boot doesn't know about this escrow and the credits are locked permanently.

**Why it happens:**
`setInterval` keeps the Node.js event loop alive, preventing clean shutdown. Developers call `clearInterval` in the SIGTERM handler, but if the interval callback is already executing (mid-async-await), the cleanup runs while the async operation is still in flight.

**How to avoid:**
Three requirements:
1. All autonomous loops must be registered in the `AgentRuntime` and cleared in a single `runtime.shutdown()` call.
2. Any in-flight auto-request must be awaited before shutdown completes (use a `draining` flag that prevents new requests from starting).
3. On startup, scan `credit_escrow` for rows with `status = 'held'` and `created_at < now - 10 minutes`. These are orphaned from a previous crash. Release them automatically with a log warning.

**Warning signs:**
- `setInterval` is called outside of a centralized runtime manager
- SIGTERM handler uses `process.exit(0)` without awaiting in-flight operations
- No startup check for stale `'held'` escrow rows

**Phase to address:**
Agent runtime scaffold (first phase). Orphaned escrow recovery at startup is part of credit system hardening.

---

### Pitfall 8: OpenClaw HEARTBEAT.md Integration Competes With Auto-Share Timer

**What goes wrong:**
AgentBnB runs its idle monitor on a Node.js `setInterval`. OpenClaw's heartbeat also runs on an interval (every 30 minutes). If the AgentBnB skill triggers auto-share inside a heartbeat callback, and the heartbeat is skipped (because the main queue is busy), auto-share is silently missed. Meanwhile, the AgentBnB process timer fires anyway. Result: two competing systems that may both trigger auto-share, producing duplicate card publishes or conflicting `availability.online` states.

**Why it happens:**
The design spec says "AgentBnB should be an OpenClaw skill." But the existing codebase is a standalone Node.js process. Deep integration means the AgentBnB skill's timing must be coordinated with OpenClaw's heartbeat scheduler — not running a parallel timer. This architectural choice is not made explicit in the spec.

**How to avoid:**
Define the integration boundary clearly before implementation. Two valid options:
- Option A (Standalone): AgentBnB runs as its own process. OpenClaw writes to a shared config file or sends a webhook to AgentBnB's HTTP API. AgentBnB does not depend on OpenClaw's heartbeat timing.
- Option B (Skill): AgentBnB is an OpenClaw skill. All autonomous behavior is triggered by OpenClaw's heartbeat. AgentBnB exposes no timers of its own — it exports functions that the skill's HEARTBEAT.md checklist invokes.

Do not mix both. The hybrid approach (own timers plus heartbeat triggers) is where conflicts arise.

**Warning signs:**
- `auto-share.ts` has its own `setInterval` AND exports a function for heartbeat invocation
- No documentation of which timing system is authoritative
- Duplicate card inserts in integration tests

**Phase to address:**
OpenClaw deep integration phase. The integration mode (standalone vs. skill) must be decided before any heartbeat wiring is built.

---

### Pitfall 9: Multi-Skill Card's `skills[]` Array Makes Peer Selection Ambiguous

**What goes wrong:**
Auto-request needs to find a peer that can handle a specific skill (e.g., TTS). In v1.1, every card IS a skill — the matcher searches cards directly. In v2.0 with multi-skill cards, a card describes an agent with multiple skills. The matcher now needs to search inside `skills[]` to find which agents have the needed skill. But the FTS5 index (`cards_fts`) indexes the top-level `name` and `description` fields — not the skill-level fields. A search for "text-to-speech" returns no results because the skill's name is nested in `skills[0].name`, not in the card's top-level `name`.

**Why it happens:**
The SQLite FTS5 trigger uses `json_extract(new.data, '$.name')`. When the card schema changes to put skill names inside an array, this path produces `NULL`. The FTS index silently becomes useless for skill-level search.

**How to avoid:**
The FTS trigger must be updated when the schema changes. For multi-skill cards, index the concatenation of all skill names and descriptions: `GROUP_CONCAT(json_extract(value, '$.name'), ' ')` from `json_each(new.data, '$.skills')`. Alternatively, maintain a separate `card_skills` denormalization table with one row per skill per card, and search that table instead of FTS. Update all `matcher.ts` query functions to join against `card_skills`.

**Warning signs:**
- `searchCards()` returns 0 results when querying for a skill name that exists in `skills[]`
- FTS trigger code still does `json_extract(new.data, '$.name')` after schema change
- Tests only search for agents by agent name, not by skill name

**Phase to address:**
Multi-skill card phase. FTS trigger update must be part of the same migration as the schema change.

---

### Pitfall 10: Surplus Alert Fires Repeatedly — No Cooldown on Autonomous Notifications

**What goes wrong:**
Credit budgeting adds a surplus alert: "if balance exceeds 500, notify owner." The auto-share loop runs every N minutes. Every iteration checks balance. If the balance stays above 500 (owner doesn't act on the alert), the notification fires every iteration — producing a stream of duplicate alerts. This is the credit equivalent of notification spam, and it defeats the purpose of the "agent handles things quietly" design goal.

**Why it happens:**
The surplus check is implemented as a simple threshold comparison without any "already notified" state. Every loop iteration sees `balance > 500` and fires the notification.

**How to avoid:**
All threshold-based notifications must track their last-fired timestamp. Store `last_surplus_alert_at` in config. Before firing: if `now - last_surplus_alert_at < 24 hours`, skip. After firing: update `last_surplus_alert_at = now`. Apply the same pattern to reserve-floor warnings, peer-discovery failures, and any other event-driven notification.

**Warning signs:**
- Notification logic is a bare `if (balance > threshold)` with no cooldown check
- No `last_*_alert_at` fields in config schema
- Integration test verifies notification fires, but doesn't verify it doesn't fire twice in a row

**Phase to address:**
Credit budgeting phase. Notification deduplication must be built into the first notification implementation — retrofitting it is tedious.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode `idle_rate = 0.9` as placeholder | Unblocks auto-share development | Auto-share always triggers; agents over-commit idle resources | Never — even in tests, derive from mock request_log data |
| Skip the `AgentRuntime` wrapper, start timers in CLI | Faster initial implementation | Graceful shutdown is impossible; timers leak across test runs | Never |
| Default autonomy tier to Tier 1 | "It just works" out of the box | Agents act without owner knowledge; violates OWASP Least-Agency | Never |
| One migration script that runs at startup without version guard | Simpler than `PRAGMA user_version` | Runs the migration twice on second boot, corrupting cards | Never |
| Call `holdEscrow` directly from auto-request without reserve check | Fewer layers | Agent drains below reserve; no credit for emergencies | Never |
| Use `setInterval` with no reference stored | Less boilerplate | Cannot cancel on shutdown; produces `SQLITE_BUSY` on exit | Never |
| Skip FTS trigger update when schema changes | Fewer lines to change | Search silently returns wrong results — no error, just nothing | Never — update triggers in same transaction as schema change |

---

## Integration Gotchas

Common mistakes when connecting the new autonomous features to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| SQLite + background timer | Open a second `better-sqlite3` connection inside the timer callback | Pass the existing database handle from `AgentRuntime` to the timer; SQLite only allows one writer at a time under WAL |
| Fastify + auto-request client | Reuse the Fastify HTTP server's internal `inject()` for outbound auto-requests | Use the existing `gateway/client.ts` (`requestCapability()`) — it is built for outbound calls |
| FTS5 trigger + multi-skill schema | FTS trigger extracts `$.name` — works for old schema, returns NULL for new schema | Update all three triggers (`cards_ai`, `cards_au`, `cards_ad`) in the same migration that adds `skills[]` |
| OpenClaw HEARTBEAT.md + Node.js timers | Both systems trigger auto-share on independent schedules | Choose one scheduler — heartbeat OR timer, not both |
| Autonomy tier config + init flow | `--yes` flag skips tier selection, leaving default (which must be Tier 3) | Tier selection is NOT skipped by `--yes`; always requires explicit owner input on first boot |
| Credit reserve + `holdEscrow` | Auto-request calls `holdEscrow` directly; reserve never checked | Wrap in `budget.holdWithReserve()` which subtracts reserve before comparing to `credits_needed` |
| Peer selection + self-exclusion | Auto-requester queries registry, own card matches, agent requests from itself | Peer-selection always filters `candidate.owner !== self.owner` before ranking |
| Orphaned escrow at startup | Boot up after crash; stale `'held'` escrow rows block balance | Startup check: release any `'held'` escrow older than 10 minutes with a warning log |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Idle rate query scans full `request_log` on every timer tick | Timer fires every 60s; SQLite full-table scan grows with log size | Add `CREATE INDEX idx_request_log_card_time ON request_log(card_id, created_at)` | When request_log exceeds ~10K rows (a few days of moderate use) |
| FTS5 search on multi-skill cards without denormalization | `searchCards()` latency grows with skills per card | Maintain `card_skills` table; search it with `WHERE skill = ?` | At ~50 skills per agent × ~100 agents |
| Peer-selection ranks all registry cards on every auto-request | Auto-request runs every N minutes; full-scan of registry | Cache top-N peers per skill-category; invalidate on registry change event | At ~500 registered agents |
| Auto-share publishes a new card every time idle_rate exceeds threshold | Card table grows with duplicates; FTS index bloats | `UPSERT` on agent `owner` + skill combination, not `INSERT` every time | After 24 hours of normal operation (one new card per hour = 24 duplicates per day) |
| Background timer holds SQLite write lock while HTTP request is in-flight | Incoming gateway requests queue behind the timer write | WAL mode helps but does not eliminate this — keep timer writes short; never await HTTP inside a DB transaction | Under moderate concurrent load (~10 simultaneous requests) |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Auto-request trusts peer-reported `card_id` without verifying registry | A malicious peer returns a fake card_id; agent pays for a capability that doesn't exist | Always look up `card_id` in local registry or verified remote registry before initiating escrow |
| Autonomy tier threshold stored only in config file (editable by user) | Agent modified its own config to change Tier 3 → Tier 1 (prompt injection via HEARTBEAT.md) | Validate tier config on every autonomous action; log any mid-session config change as a security event |
| Auto-share publishes capabilities without scrubbing `_internal` fields | `_internal` (private metadata) leaks to network peers | The existing server already strips `_internal` — ensure auto-share goes through the same registry server path, not a direct `insertCard()` bypass |
| Credit budget limit not applied to incoming requests (only outbound) | A peer agent spams incoming requests consuming all the local agent's handler capacity | Rate-limit incoming `/rpc` requests per `requester` identity; track velocity of incoming requests |
| HEARTBEAT.md rules are readable by other agents (if shared workspace) | A malicious skill could read autonomy tier thresholds and craft requests just under the Tier 1 limit | HEARTBEAT.md must not contain numeric credit thresholds — those live in encrypted config, not in a Markdown file |

---

## UX Pitfalls

Common experience mistakes — remembering that the "UX" here is primarily agent-facing (AGENT-NATIVE-PROTOCOL.md: "user of AgentBnB is the agent").

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Autonomy tier configuration buried in advanced docs | Agent owners never find it; default Tier 3 feels "broken" because nothing happens automatically | `agentbnb init` explicitly prompts for tier selection with plain-language descriptions ("Do you want your agent to share idle capabilities automatically?") |
| Auto-share publishes card without showing what was published | Owner doesn't know agent published on their behalf until they check logs | Tier 2 notify-after must write a visible event to the dashboard's request history (or stdout if no dashboard); at minimum, log to a file |
| Surplus alert fires in logs but owner has no easy "do something" action | Alert is seen but ignored; 500 credits sit idle | Surplus alert must include actionable text: "Run `agentbnb status` or check Hub dashboard to adjust pricing" |
| Auto-request fails silently when peer is offline | Agent's task fails with no diagnosis available to the owner | Auto-request must write failure events to `request_log` even when no escrow was initiated; owner can see "tried to request TTS from 3 peers, all offline" |
| Multi-skill card's `skills[]` shows all skills as online even when only some are | Requesters try to book offline skills; high failure rate damages reputation score | Each skill in `skills[]` must have its own `availability.online` flag, checked independently |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Idle Rate Detection:** Timer fires and reads `request_log` — but verify the query uses the indexed `card_id + created_at` path and has been tested with a non-empty log table
- [ ] **Auto-Share:** Card gets published — but verify it goes through the server's `_internal`-stripping path, not direct `insertCard()`; verify `UPSERT` not `INSERT` so duplicate cards don't accumulate
- [ ] **Auto-Request:** Escrow is held and request is sent — but verify self-exclusion check exists, reserve floor is checked, and failure is logged to `request_log`
- [ ] **Autonomy Tiers:** Config reads a tier number — but verify the default is Tier 3, verify Tier 3 actually blocks auto-actions (not just logs a warning), verify `--yes` does NOT bypass tier selection
- [ ] **Credit Budgeting:** Spending limit blocks high-value requests — but verify the reserve floor is separate from the spending limit, and verify notification cooldown prevents repeat alerts
- [ ] **Multi-Skill Cards:** New cards insert with `skills[]` — but verify FTS triggers were updated in the same migration, verify old-format cards are migrated before new code reads them, verify per-skill `availability.online` is tracked
- [ ] **OpenClaw Deep Integration:** HEARTBEAT.md contains autonomy rules — but verify numeric thresholds are NOT in the Markdown file (security), verify AgentBnB timer is disabled when running as OpenClaw skill
- [ ] **Graceful Shutdown:** SIGTERM handler runs — but verify in-flight auto-requests are awaited, verify all `setInterval` refs are cleared, verify orphaned escrow cleanup runs on next boot

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned escrow from crash | LOW | Script: `SELECT id FROM credit_escrow WHERE status='held' AND created_at < datetime('now', '-10 minutes')` → call `releaseEscrow()` for each |
| Duplicate cards from auto-share without UPSERT | LOW | Script: keep the latest `updated_at` card per `(owner, skill_id)`, delete the rest; rebuild FTS index with `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` |
| Corrupted FTS index after schema migration | LOW | `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` — SQLite FTS5 full rebuild from `content=capability_cards` |
| Auto-request drained agent below reserve | MEDIUM | Manually run `bootstrapAgent(db, owner, X)` to inject credits; add reserve enforcement and redeploy |
| Old-format cards unreadable after multi-skill migration | HIGH | Requires rollback to v1.1 code if no migration script was written; then write the migration and re-deploy. Prevention is cheaper than recovery here. |
| Autonomy tier defaulted to Tier 1 on first boot, agent acted without owner knowledge | MEDIUM | Audit `request_log` for autonomous actions taken; notify owner of all actions; reset tier to Tier 3; add explicit first-boot tier selection |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Paradigm shift — no runtime scaffold | Phase v2.0-01: Agent Runtime | `AgentRuntime.shutdown()` test — all timers stop cleanly under SIGTERM |
| Idle rate has no real metric | Phase v2.0-02: Idle Monitoring | Unit test: `idle_rate` computed from mock `request_log` data; 0 calls → rate = 1.0 |
| Schema migration without migration script | Phase v2.0-03: Multi-Skill Cards | Migration test: load a real v1.1 card fixture, run migration, verify it reads correctly as v2.0 |
| FTS trigger not updated after schema change | Phase v2.0-03: Multi-Skill Cards | Integration test: insert a multi-skill card, search by skill name, verify result is returned |
| Auto-request self-exclusion missing | Phase v2.0-04: Auto-Request | Test: agent's own card matches query → no escrow initiated, task executed locally |
| Autonomy tier defaults to Tier 1 | Phase v2.0-05: Autonomy Tiers | Test: boot with no config → all autonomous operations blocked; explicit tier set → operations enabled |
| Reserve floor not enforced | Phase v2.0-06: Credit Budgeting | Test: balance at reserve + 1 credit → auto-request blocked; balance at reserve + cost → auto-request proceeds |
| Surplus alert fires repeatedly | Phase v2.0-06: Credit Budgeting | Test: balance above threshold, run budget check twice → notification fires exactly once |
| Graceful shutdown leaves orphaned escrows | Phase v2.0-01: Agent Runtime | Test: send SIGTERM mid-auto-request → escrow is either settled or released on next boot |
| OpenClaw heartbeat + Node.js timer conflict | Phase v2.0-07: OpenClaw Integration | Test: running as OpenClaw skill → no `setInterval` active in AgentBnB process |

---

## Sources

- OWASP Top 10 for Agentic Applications 2026: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- OpenClaw Heartbeat Documentation: https://docs.openclaw.ai/gateway/heartbeat
- SQLite WAL concurrent writes analysis: https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/
- SQLite WAL official docs: https://sqlite.org/wal.html
- TrueFoundry: FinOps for Autonomous Systems (per-request budget context, runaway agent detection): https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems
- A2A Protocol Agent Skills specification: https://a2a-protocol.org/latest/tutorials/python/3-agent-skills-and-card/
- OWASP AI Agent Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- Codebase: `src/credit/escrow.ts`, `src/credit/ledger.ts`, `src/gateway/server.ts`, `src/registry/store.ts`, `src/types/index.ts`
- Project design bible: `AGENT-NATIVE-PROTOCOL.md`

---
*Pitfalls research for: Adding autonomous agent behavior to AgentBnB v1.1 (sync request-response) → v2.0 (autonomous capability sharing)*
*Researched: 2026-03-15*
