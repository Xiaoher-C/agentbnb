# Session Smoke Test (v10)

End-to-end manual verification that the existing `agentbnb session ...` CLI flow
works, plus the new v10 REST surface (`POST /api/sessions`, `GET /o/:share_token`).

Run this before touching session code or shipping changes that affect:
- `src/session/*` (manager / executor / escrow / types)
- `src/relay/websocket-relay.ts` (session handler attachment)
- `src/registry/session-routes.ts` (REST surface)
- `src/cli/session-action.ts` (CLI client)

## Prerequisites

```bash
pnpm install
pnpm rebuild better-sqlite3   # if native bindings missing (different Node ABI)
pnpm build
```

## A. Automated checks (must be green before manual flow)

```bash
pnpm vitest run src/session/privacy.test.ts        # ADR-024 privacy contract
pnpm vitest run src/registry/session-routes.test.ts # REST surface lifecycle
pnpm vitest run src/session/                       # SessionManager + executors
pnpm tsc --noEmit
```

All four must pass with zero failures.

## B. CLI smoke test — two local agents

This exercises the WebSocket relay + SessionManager + escrow flow used by
existing capability rentals. New v10 features (threads, files, outcome page)
are NOT exercised here — see Section C for the REST surface.

### B.1 — Terminal A: registry + relay

```bash
cd /Users/leyufounder/Github/agentbnb
pnpm dev   # spins up registry + relay on :7777 (see package.json scripts)
```

Look for:
- `registry listening on http://0.0.0.0:7777`
- `WebSocket relay attached at /ws`

### B.2 — Terminal B: provider agent

```bash
agentbnb init --owner provider-test
agentbnb publish ./examples/sample-card.json   # any card with a session-capable skill
agentbnb serve                                 # registers card with relay, opens gateway
```

Note the printed `card_id` and `skill_id`.

### B.3 — Terminal C: requester opens session

```bash
agentbnb init --owner requester-test
agentbnb session open <card_id> \
  --skill <skill_id> \
  --budget 30 \
  --message "hello, this is a smoke test"
```

Expected:
- Session id printed
- WebSocket connects to relay
- Initial message sent
- Provider's response streams back

### B.4 — Send + end

```bash
agentbnb session send <session_id> "second turn"
agentbnb session end <session_id> --reason completed
```

Expected:
- Provider receives second turn
- Session settled with credit deduction
- Both terminals show `session_settled` event

### B.5 — Verify privacy invariants (ADR-024)

```bash
sqlite3 ~/.agentbnb/registry.db "SELECT COUNT(*) FROM request_log WHERE created_at > datetime('now', '-5 minutes');"
```

For requests made via `agentbnb session open` with `session_mode: true`
propagated through the SDK consumer (Phase 2 wiring), expect 0 rows.

For the legacy session flow used here without explicit session_mode, the
existing `request_log` rows are persisted (acceptable backward compat).

## C. REST surface smoke test

With the registry server still running from B.1:

### C.1 — Create session

```bash
curl -X POST http://localhost:7777/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "renter_did": "did:key:z-renter-test",
    "owner_did":  "did:key:z-owner-test",
    "agent_id":   "agent-bgm-designer",
    "duration_min": 30,
    "budget_credits": 50
  }'
```

Expected: `201` with `{session_id, share_token, relay_url, status: "open"}`.

### C.2 — Read session

```bash
curl http://localhost:7777/api/sessions/<session_id>
```

Expected: `200` with full session object including `participants` (renter +
rented_agent) and empty `threads: []`.

### C.3 — Open + complete a thread

```bash
curl -X POST http://localhost:7777/api/sessions/<session_id>/threads \
  -H 'Content-Type: application/json' \
  -d '{"title": "smoke test thread", "description": "test deliverable"}'
# Note thread_id from response

curl -X POST http://localhost:7777/api/sessions/<session_id>/threads/<thread_id>/complete
```

### C.4 — End + outcome

```bash
curl -X POST http://localhost:7777/api/sessions/<session_id>/end \
  -H 'Content-Type: application/json' \
  -d '{"end_reason": "completed"}'
```

Expected: `200` with `{session_id, outcome}` where `outcome.summary.tasks_done == 1`.

### C.5 — Submit rating

```bash
curl -X POST http://localhost:7777/api/sessions/<session_id>/rating \
  -H 'Content-Type: application/json' \
  -d '{"rater_did": "did:key:z-renter-test", "stars": 4, "comment": "smoke OK"}'
```

### C.6 — Public outcome by share token (no auth)

```bash
curl http://localhost:7777/o/<share_token>
```

Expected: `200` with full outcome page including the completed thread.

## D. Failure modes to check

| Action | Expected response |
|---|---|
| GET /api/sessions/00000000-0000-0000-0000-000000000000 | 404 |
| POST /api/sessions/:id/end called twice | 409 on second call |
| POST /api/sessions/:id/rating with stars=0 or stars=6 | 400 |
| GET /o/<bad-token> | 404 |
| POST /api/sessions with missing required field | 400 |

## E. What this smoke test does NOT cover (Phase 2+)

- Real-time message routing via the new REST surface (currently only WebSocket)
- File upload (`POST /api/sessions/:id/files`) — Phase 2 Track B Week 4
- Hub UI (`/s/:id` and `/s/:id/outcome` pages) — Phase 2 Track B
- Hermes plugin integration — Phase 2 Track A
- Cross-machine session (renter and provider on different hosts via relay)
- session_mode=true privacy enforcement on real capability calls during a session
  — depends on Phase 2 wiring through gateway/execute.ts

When those land, extend this doc with the corresponding manual checks.

## F. Cheng Wen × Hannah dogfood (Phase 2 Track A — Week 2)

Once the Hermes plugin alpha is installable:

1. Install plugin in Cheng Wen's Hermes: `hermes plugin install agentbnb`
2. Cheng Wen publishes a Hermes agent: `hermes agentbnb publish --rental-md ./RENTAL.md`
3. Hannah's bgm-designer published via existing OpenClaw skill (backward compat path)
4. Cheng Wen rents Hannah's agent for 60 min via the Hub
5. Real task: produce BGM for a Hermes-related project
6. End session → grab outcome page URL → use as Hub hero asset

Outcome page from this session is the launch-day hero artifact (Phase 3).
