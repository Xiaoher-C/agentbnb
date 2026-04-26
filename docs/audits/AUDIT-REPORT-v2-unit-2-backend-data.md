# Audit Report — Unit 2: Backend API & Data Layer

**Date:** 2026-04-27
**Auditor:** Security Reviewer Agent (Unit 2 of 5)
**Scope:** `src/registry/**`, `src/gateway/**`, `src/credit/**`, `src/relay/**`
**Branch:** `audit/unit-2-backend-data`
**Version reviewed:** commit at HEAD of `main` (2026-04-27)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| WARNING  | 9 |
| INFO     | 5 |

This is the largest audit unit (~90 files). The codebase demonstrates strong fundamentals: extensive use of parameterized queries via `better-sqlite3`, Zod schema validation on incoming data, atomic `db.transaction()` wrapping for multi-step credit operations, and a 5-minute replay-window on Ed25519 request signatures. The most serious issues are concentrated in three areas: (1) two SQL injection vectors in migration helpers that accept caller-controlled table/column names, (2) unauthenticated `balance_sync` over WebSocket that leaks any agent's balance to any connected peer, and (3) the register token on the WebSocket relay is never verified server-side, leaving the relay open to impersonation.

---

## Findings

### SQL / Database

---

### Finding 1: SQL Injection in Migration Helper via Caller-Controlled Table Name

- **File:** `src/migrations/credit-migrations.ts:15`, `src/migrations/registry-migrations.ts:19`
- **Severity:** CRITICAL
- **Description:** Both migration files define an `addColumnIfNotExists` helper that interpolates a caller-supplied `table` string directly into a `PRAGMA table_info(${table})` query and a subsequent `ALTER TABLE ${table} ADD COLUMN` statement. The `table` and `column` arguments are passed as plain TypeScript strings from the migration arrays in the same files, meaning in the current codebase the values are static. However, the function signature is `(db, table, column, type)` with no allow-list guard. Any future caller that passes a user-derived or externally sourced value would silently introduce a SQL injection point. SQLite `PRAGMA table_info` and `ALTER TABLE` do not support bind parameters, so parameterization cannot be applied — the fix must be an explicit allow-list.

  ```ts
  // src/migrations/credit-migrations.ts:15 (also registry-migrations.ts:19)
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndConstraints}`);
  ```

- **Suggested fix:** Add an allow-list at the top of each migration file declaring valid table names and column names, and assert at the start of `addColumnIfNotExists` that `table` and `column` match. Throw an explicit error if they do not:
  ```ts
  const ALLOWED_TABLES = new Set(['credit_escrow', 'credit_grants', 'request_log']);
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Illegal migration table: ${table}`);
  ```

---

### Finding 2: FTS5 MATCH Injection — Partial Sanitization (Character Class Gap)

- **File:** `src/registry/matcher.ts:106-114`
- **Severity:** WARNING
- **Description:** The `searchCards` function attempts to sanitize user-supplied query strings before passing them to FTS5 `MATCH`. The approach quotes each word as `"${w}"` and strips the characters `["*^{}():]`. However, the character class regex is `["*^{}():]` — it is missing the backslash `\` character and the hyphen `-` (when placed inside brackets). More critically, FTS5 quoted phrases still permit the internal prefix operator (a trailing `*` is stripped but the leading `^` anchor is stripped correctly). The word-level join uses ` OR ` which, combined with very short or single-character terms, could cause expensive full-index scans. Additionally, the sanitization strips the operators after splitting on whitespace, meaning a term like `col:value` would be emitted as `"colvalue"` (colon stripped but the two halves concatenated), which is harmless but illustrates incomplete understanding of the FTS5 grammar.

  The most material gap is that the character `\` is not stripped. In SQLite FTS5, `\` has no special meaning in MATCH queries, so this is currently low-risk, but the sanitization is fragile and undocumented.

- **Suggested fix:** Use FTS5's built-in tokenizer instead of manual sanitization: replace each word with a parameterized bind and use `fts5_tokenize()` or limit accepted input to alphanumeric-plus-hyphen via a strict regex:
  ```ts
  const safeWord = (w: string) => w.replace(/[^a-zA-Z0-9\-_]/g, '');
  ```
  Then skip empty words after sanitization. Document the sanitization strategy inline.

---

### Finding 3: PRAGMA table_info Accepts Templated Table Name (Repeated in Migration Runner)

- **File:** `src/migrations/runner.ts:37`
- **Severity:** INFO
- **Description:** The `runner.ts` uses `db.exec(...)` with a hard-coded DDL string for `migration_metadata`. This is fine. However, the runner itself is called by both credit and registry migration lists that call `addColumnIfNotExists`, which is described in Finding 1. This finding is informational only — the runner itself is safe, but its callee is not.
- **Suggested fix:** See Finding 1.

---

### Authn/Authz

---

### Finding 4: WebSocket Register Token Is Never Verified Server-Side

- **File:** `src/relay/websocket-relay.ts:403-481`, `src/relay/types.ts:10-26`
- **Severity:** CRITICAL
- **Description:** The `RegisterMessage` schema requires a `token: z.string().min(1)` field, and the Zod schema validates its presence. However, in `handleRegister()`, the `msg.token` field is never checked against any known-good value or authenticated identity. Any WebSocket client can connect, send `{ type: "register", owner: "<any-name>", token: "x", card: {...} }` and claim any owner identity. The relay then:
  1. Stores the connection under the claimed `owner` key in the `connections` map.
  2. Upserts the supplied `card` data into the registry database (`upsertCard`).
  3. Marks the owner's cards online.
  4. Logs an `agent_joined` activity event.
  5. Allows that connection to send `relay_request` messages immediately.

  This means any unauthenticated actor can impersonate any agent name, overwrite their registry card, hijack their relay session (closing the legitimate owner's connection), and intercept or originate relay requests attributed to the victim's identity.

  The `is_ephemeral` check (`owner.includes(':req:')`) is also bypassable — an attacker can register as `victim:req:attacker` to create an ephemeral session under a crafted name.

- **Suggested fix:** Before accepting the registration, verify the `token` against a server-side secret or, preferably, verify that the connecting agent can produce a valid Ed25519 signature over a server-issued challenge. The existing `tryVerifyIdentity` infrastructure in `identity-auth.ts` provides exactly this capability. At minimum, the relay should compare `msg.token` to a shared secret configured via environment variable (same pattern used by `ownerApiKey`).

---

### Finding 5: `balance_sync` WebSocket Message Returns Any Agent's Balance to Any Peer

- **File:** `src/relay/websocket-relay.ts:874-886`
- **Severity:** CRITICAL
- **Description:** The `handleBalanceSync` handler accepts a `BalanceSyncMessage` containing an arbitrary `agent_id` and returns the credited balance for that agent to the requesting WebSocket connection. No authorization check is performed — any registered peer can query the balance of any other agent.

  ```ts
  function handleBalanceSync(ws: WebSocket, msg: BalanceSyncMessage): void {
    // ...
    const balance = getBalance(creditDb, msg.agent_id);   // no auth
    sendMessage(ws, { type: 'balance_sync_response', agent_id: msg.agent_id, balance });
  }
  ```

  This is a data-disclosure vulnerability: balances expose economic activity and can be used to profile agents (e.g., identify high-value targets for relay spam or selective attacks).

- **Suggested fix:** Restrict `balance_sync` so that a registered peer can only query their own balance. Enforce this by comparing `msg.agent_id` against the connection's registered `registeredOwner` (or the canonical `agentIdToOwner` lookup):
  ```ts
  const allowedKey = resolveConnectionKey(registeredOwner ?? '');
  const requestedKey = resolveConnectionKey(msg.agent_id);
  if (allowedKey !== requestedKey) {
    sendMessage(ws, { type: 'error', code: 'unauthorized', message: 'Cannot query other agents\' balance' });
    return;
  }
  ```

---

### Finding 6: `GET /api/credits/balance` and `GET /api/credits/transactions` Are Fully Public — Any Agent's Financial Data Exposed

- **File:** `src/registry/credit-routes.ts:81-159`
- **Severity:** WARNING
- **Description:** Both endpoints are documented as "public, no auth required" and intentionally return credit balance and full transaction history for any `?owner=` value supplied. The justification given in comments is that agents need to query their own balance before their Ed25519 keys are loaded. While this is a valid operational concern, the current design allows any party to enumerate all agents' balances and transaction histories without any credential. Transaction histories include `reason`, `amount`, `reference_id` (escrow ID), and `created_at`, leaking information about active escrow operations.

- **Suggested fix:** Consider requiring Ed25519 auth for the full transaction history endpoint. For balance-only queries, a short-term solution is to add IP-based rate limiting stricter than the global 100 req/min limit. If agent startup needs unauthenticated access, a dedicated minimal endpoint returning only a boolean `has_bootstrap_balance` rather than the numeric balance would be less informative.

---

### Finding 7: `POST /api/credits/settle` — No Verification That Authenticated Agent Is the Escrow Owner

- **File:** `src/registry/credit-routes.ts:261-297`
- **Severity:** WARNING
- **Description:** The `POST /api/credits/settle` endpoint requires Ed25519 auth but does not verify that the authenticated caller (`request.agentId`) is the original requester who created the escrow. Any authenticated agent can supply an `escrowId` they do not own and settle it, transferring credits to an arbitrary `recipientOwner`. The Ed25519 check only proves the caller has a valid key — it does not tie the caller to the specific escrow.

  The underlying `settleEscrow()` function in `src/credit/escrow.ts` also does not assert ownership — it only checks that the escrow exists and is in a finalizable state.

- **Suggested fix:** In `settleEscrow()` (or in the route handler), verify that the escrow's `owner` matches the authenticated agent ID:
  ```ts
  const escrow = getEscrowStatus(creditDb, escrowId);
  if (escrow?.owner !== request.agentId) {
    return reply.code(403).send({ error: 'Forbidden: escrow belongs to a different agent' });
  }
  ```

---

### Finding 8: `POST /api/credits/release` — No Ownership Verification for Escrow Refund

- **File:** `src/registry/credit-routes.ts:299-336`
- **Severity:** WARNING
- **Description:** Same pattern as Finding 7. Any Ed25519-authenticated agent can release (refund) any escrow by supplying its ID, regardless of ownership. This allows a malicious agent to refund a provider's pending escrow (voiding their payment) after the provider has already delivered the capability.
- **Suggested fix:** Same as Finding 7 — assert `escrow.owner === request.agentId` before calling `releaseEscrow`.

---

### Race Conditions

---

### Finding 9: `registerProvider` — TOCTOU Race on Provider Number Assignment

- **File:** `src/credit/ledger.ts:266-274`
- **Severity:** WARNING
- **Description:** `registerProvider` reads `MAX(provider_number)` and then inserts a new row with `nextNum = max + 1`. This two-step read-then-write is not wrapped in a transaction. Under concurrent access (multiple agents bootstrapping simultaneously on the same SQLite instance with WAL mode), two agents can read the same `maxNum`, both compute the same `nextNum`, and one will succeed while the other silently loses (due to `INSERT OR IGNORE`). The losing agent would receive the wrong (pre-existing) provider number from the subsequent `SELECT`.

  ```ts
  // ledger.ts:269-272
  const maxRow = db.prepare('SELECT MAX(provider_number) as maxNum FROM provider_registry').get();
  const nextNum = (maxRow?.maxNum ?? 0) + 1;
  db.prepare('INSERT OR IGNORE INTO provider_registry ...').run(canonicalOwner, nextNum, now);
  const row = db.prepare('SELECT provider_number ...').get(canonicalOwner);
  return row.provider_number;
  ```

  The practical impact is limited because better-sqlite3 with WAL mode serializes writes at the DB level, but the gap exists if multiple Node.js processes share the same file.

- **Suggested fix:** Wrap the entire `registerProvider` body in a `db.transaction()`:
  ```ts
  return db.transaction(() => {
    const maxRow = ...;
    const nextNum = ...;
    db.prepare('INSERT OR IGNORE ...').run(...);
    return db.prepare('SELECT provider_number ...').get(canonicalOwner).provider_number;
  })();
  ```

---

### Finding 10: `bootstrapAgent` — `isNew` Flag Set Outside Transaction, Voucher Issued After Commit

- **File:** `src/credit/ledger.ts:105-132`
- **Severity:** WARNING
- **Description:** The `bootstrapAgent` function wraps the `INSERT OR IGNORE` and transaction logging in a `db.transaction()`, but sets the outer `let isNew = false` variable inside the transaction closure and then uses it after the transaction commits to call `issueVoucher`. If the transaction fails after setting `isNew = true` (which is unusual with better-sqlite3 synchronous mode, but possible if an exception is thrown from the second `db.prepare().run()` inside the transaction), `isNew` would remain `false` and the voucher would not be issued. Conversely, if `issueVoucher` itself throws after the transaction committed, the agent receives bootstrap credits but no voucher — an inconsistent state.

  ```ts
  let isNew = false;
  db.transaction(() => {
    const result = db.prepare('INSERT OR IGNORE ...').run(...);
    if (result.changes > 0) {
      isNew = true; // Set inside tx body
      db.prepare('INSERT INTO credit_transactions ...').run(...);
    }
  })();
  if (isNew) {
    issueVoucher(db, canonicalOwner, 50, 30); // Outside tx
  }
  ```

- **Suggested fix:** Move `issueVoucher` inside the transaction body, or wrap both the bootstrap and voucher in a single outer `db.transaction()`. This ensures atomicity — either both succeed or neither does.

---

### Finding 11: `holdEscrow` — Voucher Read-Check-Use Is Not Atomic With Balance Deduction

- **File:** `src/credit/escrow.ts:127-163`
- **Severity:** WARNING
- **Description:** Inside `holdEscrow`, the transaction checks for an active voucher via `getActiveVoucher`, then calls `consumeVoucher` if sufficient. However, `getActiveVoucher` returns the voucher row via a `SELECT`, and `consumeVoucher` updates with `WHERE remaining >= ?`. Under concurrent requests (two simultaneous holds for the same agent), both could read the same voucher row showing `remaining = 50` and both could then attempt to `consumeVoucher` for 30 credits each. The `WHERE remaining >= ?` check prevents over-consumption, but the second `consumeVoucher` call would silently fail (0 rows updated), and the second `holdEscrow` call would proceed as if it had consumed a voucher, but the escrow record would still be inserted with `funding_source = 'voucher'` even though no voucher credits were actually deducted. This is a silent double-spend vector.

  The `consumeVoucher` function at line 337-339 does use an atomic `UPDATE ... WHERE remaining >= ?` which is safe on its own, but the calling code in `holdEscrow` does not check the result of `consumeVoucher` to confirm the update succeeded.

- **Suggested fix:** Check the return value of `consumeVoucher` (wrap it to return `result.changes`), and if it returns 0, fall through to the normal balance deduction path instead:
  ```ts
  const consumed = consumeVoucher(db, voucher.id, amount);
  if (consumed === 0) {
    // Fall through to balance path
  }
  ```

---

### WebSocket / Relay

---

### Finding 12: No Maximum Payload Size Limit on WebSocket Messages

- **File:** `src/relay/websocket-relay.ts:895-903`
- **Severity:** WARNING
- **Description:** The `socket.on('message', ...)` handler calls `JSON.parse()` on raw incoming data without any size check. A client can send arbitrarily large messages (e.g., a 100 MB card payload) which would be parsed entirely into memory before Zod validation rejects them. This is a memory exhaustion / denial-of-service vector. The Fastify HTTP routes benefit from `@fastify/rate-limit` and the platform's default body size limits, but the WebSocket route bypasses both.

  ```ts
  socket.on('message', (raw: Buffer | string) => {
    void (async () => {
      let data: unknown;
      try {
        data = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')); // no size check
      } catch { ... }
      const parsed = RelayMessageSchema.safeParse(data); // only validates after parse
  ```

- **Suggested fix:** Add a maximum message size check before JSON parsing:
  ```ts
  const MAX_WS_PAYLOAD = 1 * 1024 * 1024; // 1 MB
  const rawLen = typeof raw === 'string' ? raw.length : raw.byteLength;
  if (rawLen > MAX_WS_PAYLOAD) {
    sendMessage(socket, { type: 'error', code: 'payload_too_large', message: 'Message exceeds 1 MB limit' });
    socket.close(1009, 'Message too large');
    return;
  }
  ```
  Alternatively, configure the `@fastify/websocket` plugin with `maxPayload` option.

---

### Finding 13: No Per-IP Connection Limit on WebSocket Relay

- **File:** `src/relay/websocket-relay.ts:888-994`
- **Severity:** WARNING
- **Description:** The relay rate-limits `relay_request` messages per agent identity (60/minute), but there is no limit on the number of simultaneous WebSocket connections from a single IP address. An attacker can establish thousands of connections from a single host, each claiming a unique `owner` identity, exhausting memory and file descriptors. The `connections` Map grows unbounded as new registrations arrive.

- **Suggested fix:** Track connection counts per source IP using the Fastify request object available during the WebSocket upgrade, and reject connections that exceed a per-IP threshold (e.g., 20 concurrent connections per IP):
  ```ts
  const ipConnections = new Map<string, number>();
  const MAX_CONNECTIONS_PER_IP = 20;
  ```
  Also consider adding a global `MAX_TOTAL_CONNECTIONS` ceiling.

---

### Finding 14: `relay_response` and `relay_started` Messages Are Accepted From Any Registered Connection

- **File:** `src/relay/websocket-relay.ts:611-696`, `src/relay/websocket-relay.ts:570-584`
- **Severity:** INFO
- **Description:** When Agent B sends a `relay_response` message, the relay looks up the pending request by `msg.id` (a UUID) and routes the response back to the requester. The relay does NOT verify that the responding WebSocket connection is the same agent that was designated as the `targetOwner` in the pending request. Any connected agent that knows a valid `relay_request` UUID can send a `relay_response` and intercept the credit settlement flow or inject a malicious response to Agent A.

  While UUIDs are not guessable by default, an agent that is forwarded an `incoming_request` knows the request ID and could re-send a forged `relay_response` before completing the actual work, claiming the credit settlement.

- **Suggested fix:** In `handleRelayResponse`, verify that the responding connection matches the expected `targetOwner`:
  ```ts
  // Resolve who is sending this response
  const respondingKey = // look up fromOwner in the message dispatch context
  if (respondingKey !== pending.targetOwner) {
    // Reject forged response
    return;
  }
  ```
  This requires threading `registeredOwner` through to `handleRelayResponse`.

---

### Rate Limiting

---

### Finding 15: Credit Mutation Endpoints (`/api/credits/hold`, `/api/credits/settle`, `/api/credits/release`) Have No Route-Level Rate Limits

- **File:** `src/registry/credit-routes.ts:216-336`
- **Severity:** INFO
- **Description:** The global `@fastify/rate-limit` plugin applies a 100 requests/minute/IP ceiling across all routes. However, the credit mutation endpoints (hold, settle, release) are among the most sensitive: a burst of 100 rapid escrow-hold requests from one IP could drain another agent's balance if ownership verification is absent (see Findings 7 & 8). Only `POST /api/credits/grant` applies a tighter per-route limit (`max: 10, timeWindow: '1 minute'`). The other three mutation endpoints use the global limit.

- **Suggested fix:** Apply tighter per-route rate limits to all credit mutation endpoints, similar to the grant endpoint:
  ```ts
  scope.post('/api/credits/hold', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    ...
  ```

---

### Error Disclosure

---

### Finding 16: Fastify `throw err` Paths May Surface Internal Error Details

- **File:** `src/registry/card-routes.ts:490`, `src/registry/credit-routes.ts:252,295,334`, `src/registry/identity-routes.ts:90,327,546`, `src/registry/owner-routes.ts:189,236,276,301`
- **Severity:** INFO
- **Description:** In multiple route handlers, the pattern is:
  ```ts
  } catch (err) {
    if (err instanceof AgentBnBError) { ... handled ... }
    throw err; // re-throw anything else to Fastify
  }
  ```
  Fastify's default error handler in production mode (`logger: true`) will serialize unexpected errors and return a 500 with `{ statusCode: 500, error: "Internal Server Error", message: "..." }`. In development mode (or if Fastify's `disableRequestLogging` is not set), the message field could include SQLite error messages or internal file paths. The risk is mitigated by Fastify's built-in error sanitization, but better-sqlite3 errors can include schema details (e.g., `UNIQUE constraint failed: capability_cards.id`).

- **Suggested fix:** Add a global Fastify error handler that strips internal details before sending:
  ```ts
  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
    return reply.send(error);
  });
  ```

---

### Finding 17: `console.error` in Relay Logs Escrow IDs and Error Objects

- **File:** `src/relay/websocket-relay.ts` (multiple locations — lines 128, 157, 181, 205, 218, 231, 237, 453, 631, 646, 651, 679)
- **Severity:** INFO
- **Description:** Relay timeout and escrow lifecycle handlers log to `console.error` with error objects that include escrow IDs, request IDs, and exception details. These logs are appropriate for a backend service but warrant review if log aggregation systems forward them to environments with lower trust (e.g., external monitoring dashboards). Escrow IDs are UUIDs and not sensitive in isolation, but pairing them with agent owner names could enable correlation attacks in shared-infrastructure deployments.
- **Suggested fix:** Replace `console.error` with a structured logger (e.g., Fastify's `server.log.error`) that can be filtered at the transport layer. Redact escrow IDs at the highest log verbosity levels.

---

### Other

---

### Finding 18: `DELETE /cards/:id` Only Accepts `ownerApiKey` Bearer Token — No Ed25519 Path

- **File:** `src/registry/card-routes.ts:500-531`
- **Severity:** INFO
- **Description:** Unlike `POST /cards` which accepts Ed25519 identity headers, `DELETE /cards/:id` only accepts a Bearer token matching `ownerApiKey`. This means agents that published a card using their Ed25519 identity (the standard path) cannot delete their own card unless the server operator's `ownerApiKey` is known to them. The `ownerName` check further restricts deletion to cards owned by the server's configured `ownerName`, preventing the intended card author from deleting their own record.
- **Suggested fix:** Add an Ed25519 identity path to `DELETE /cards/:id` that allows any agent to delete their own card (where `card.owner === verifiedAgentId`), consistent with how `POST /cards` works.

---

## Positive Observations

The following patterns reflect good security practice and should be preserved:

1. **All `better-sqlite3` write operations use parameterized queries** (`db.prepare(...).run(?, ?, ?)`) with no string interpolation of user data in DML statements (INSERT, UPDATE, DELETE).

2. **Credit operations are wrapped in atomic transactions.** `holdEscrow`, `settleEscrow`, `releaseEscrow`, `recordEarning`, and `archiveTransactions` all use `db.transaction()`. The check-then-deduct pattern in `holdEscrow` uses `WHERE balance >= ?` in the UPDATE clause, preventing balance from going negative under concurrent reads.

3. **Ed25519 identity auth includes a 5-minute replay window.** `identity-auth.ts` validates `x-agent-timestamp` and rejects requests older than 5 minutes, preventing replay attacks.

4. **Agent ID is derived deterministically from the public key.** `deriveAgentId(publicKeyHex)` computes `sha256(pubkey).slice(0,16)`, and the server verifies that the claimed `x-agent-id` matches this derivation — preventing identity spoofing even if an attacker possesses a valid signature key.

5. **WebSocket relay validates all messages through a Zod discriminated union schema** before dispatching to handlers — unknown message types are ignored, and malformed messages receive a structured error response.

6. **`_internal` card fields are stripped before API responses.** `stripInternal()` in `card-routes.ts` ensures private metadata is never transmitted to external callers.

7. **Global rate limiting is applied** via `@fastify/rate-limit` at 100 requests/minute/IP on all HTTP endpoints.

---

## Summary Table

| # | Title | File | Severity |
|---|-------|------|----------|
| 1 | SQL injection in migration helper via caller-controlled table name | `src/migrations/credit-migrations.ts:15`, `src/migrations/registry-migrations.ts:19` | CRITICAL |
| 2 | FTS5 MATCH injection — partial sanitization gap | `src/registry/matcher.ts:106-114` | WARNING |
| 3 | PRAGMA table_info in migration runner (informational) | `src/migrations/runner.ts:37` | INFO |
| 4 | WebSocket register token never verified | `src/relay/websocket-relay.ts:403-481` | CRITICAL |
| 5 | `balance_sync` returns any agent's balance unauthenticated | `src/relay/websocket-relay.ts:874-886` | CRITICAL |
| 6 | Public credit balance and transaction endpoints leak financial data | `src/registry/credit-routes.ts:81-159` | WARNING |
| 7 | `POST /api/credits/settle` — no escrow ownership check | `src/registry/credit-routes.ts:261-297` | WARNING |
| 8 | `POST /api/credits/release` — no escrow ownership check | `src/registry/credit-routes.ts:299-336` | WARNING |
| 9 | `registerProvider` TOCTOU race on provider number | `src/credit/ledger.ts:266-274` | WARNING |
| 10 | `bootstrapAgent` isNew flag set outside transaction | `src/credit/ledger.ts:105-132` | WARNING |
| 11 | `holdEscrow` voucher consume result not verified | `src/credit/escrow.ts:127-163` | WARNING |
| 12 | No maximum payload size on WebSocket messages | `src/relay/websocket-relay.ts:895-903` | WARNING |
| 13 | No per-IP connection limit on WebSocket relay | `src/relay/websocket-relay.ts:888-994` | WARNING |
| 14 | `relay_response` sender identity not verified | `src/relay/websocket-relay.ts:611-696` | INFO |
| 15 | Credit mutation endpoints lack per-route rate limits | `src/registry/credit-routes.ts:216-336` | INFO |
| 16 | `throw err` paths may surface internal SQLite error details | Multiple route files | INFO |
| 17 | `console.error` logs escrow IDs and error objects | `src/relay/websocket-relay.ts` | INFO |
| 18 | `DELETE /cards/:id` has no Ed25519 path for card authors | `src/registry/card-routes.ts:500-531` | INFO |
