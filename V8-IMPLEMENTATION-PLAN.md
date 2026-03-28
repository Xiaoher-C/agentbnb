# V8 Implementation Plan for Claude Code

## Mission

V8 transforms AgentBnB from "works if you configure it right" to "works correctly by design." The two core problems:

1. **Identity is broken.** The `owner` field conflates human, server, and agent. Changing one string breaks everything.
2. **Transactions are invisible.** Direct-connect trades bypass the relay entirely — no network fee, no reputation tracking, no verification.

V8 fixes both at the architecture level.

---

## Architecture Decisions (Non-negotiable)

### 1. Agent is the user. Identity = Ed25519 keypair.

```
Operator (Human)
  └── owns Servers
        └── each Server runs multiple Agents
              └── each Agent has:
                    - agent_id (Ed25519 public key hash)
                    - display_name
                    - own Ed25519 keypair
                    - own credit balance
                    - own skills
                    - own reputation
                    - own reliability metrics
```

agent_id is derived from the public key. Not a random UUID, not a human-readable string. The keypair IS the identity.

### 2. P2P execution + Relay escrow verification

```
Consumer → Relay:    Escrow HOLD (relay records transaction start)
Consumer → Provider: Task payload (P2P direct, performance first)
Provider → Consumer: Result (P2P direct)
Consumer → Relay:    Escrow SETTLE (relay verifies, deducts fee, updates reputation)
Relay → Both:        Settlement confirmed
```

Payload goes P2P for performance. Escrow goes through relay for verification. Relay is the transaction verification layer, not just NAT traversal.

### 3. Credit balances live on relay (source of truth)

Local DB is a cache. Relay DB is authoritative. This prevents:
- Balance desync between local and remote
- Double-spending
- Identity migration breaking credit access

---

## Pre-Phase: Ecosystem Awareness (BEFORE writing any code)

Before starting Phase 1, spend half a day reading:

### 1. A2A Protocol Agent Cards Spec
- URL: https://github.com/google/A2A
- Focus: Agent Card format, discovery protocol, JSON-RPC 2.0 message types
- Decision needed: Should AgentBnB Capability Cards v3 be interoperable with A2A Agent Cards?
- Key insight: A2A handles communication. AgentBnB handles economics (credit + escrow + reputation). They can complement, not compete.
- Impact on Phase 1: agent_id format, card schema, routing protocol must NOT be designed to be incompatible with A2A.

### 2. Atrest.ai ERC-8004 Portable Reputation
- URL: https://atrest.ai
- Focus: How they derive on-chain reputation from execution history
- Decision needed: Should provider_reliability_metrics be exportable in a format compatible with ERC-8004?
- Key insight: We do NOT bridge to on-chain now. But our schema should not make future bridging impossible.
- Impact on Phase 4: Reliability Dividend metrics format should be portable-ready.

### 3. ClawHub Security Incident (1,467 malicious skills)
- Focus: How malicious agents got into the registry, how they were detected
- Impact on Phase 2: Delegation token verification must account for malicious agent scenarios
- Impact on Phase 6: Skill-level health probe should include basic security scanning

### 4. MCP Gateway Registry — Federation + Semantic Discovery
- URL: https://github.com/agentic-community/mcp-gateway
- Focus: Semantic agent discovery API (POST /api/agents/discover/semantic), Registry Federation (multi-registry bidirectional sync), Security scanning (Cisco AI Defense integration)
- Impact on Phase 1: agent_id format should be compatible with MCP Gateway's agent registry format
- Impact on Phase 2: Consider relay as a federated registry node — future option to sync with MCP Gateway registries
- Impact on Phase 6: Security scanning patterns to reference when building skill-level probes

### 5. Agent-Hub-MCP — Feature-Based Collaboration Model
- URL: https://github.com/agent-hub-mcp
- Focus: Feature-based collaboration (work → features → tasks → delegations), zero-config agent discovery
- Impact on Phase 2: Conductor's task decomposition can reference their feature→task model for richer delegation semantics
- Impact on Phase 3: Their zero-config discovery patterns may simplify Server-Agent delegation UX

### 6. Agent-MCP (rinadelph) — Task Linearization + Knowledge Graph
- URL: https://github.com/rinadelph/agent-mcp
- Focus: Task linearization (complex tasks → per-agent linear chains), persistent knowledge graph across sessions
- Impact on Phase 1: agent_id should support persistent context linkage (knowledge graph node = agent_id)
- Impact on Conductor: Task linearization patterns as alternative to DAG execution for simpler multi-agent flows

### 7. MCP Official Registry — Namespace + Authentication
- URL: https://github.com/modelcontextprotocol/registry
- Focus: Go implementation, PostgreSQL, GitHub OAuth + DNS verification for namespaces
- Impact on Phase 1: agent_id namespace design — consider compatibility with MCP registry namespace format
- Impact on Phase 4: Operator verification could leverage similar DNS/OAuth patterns

### 8. mcp-agent (lastmile-ai) — Agent-as-Server Pattern
- URL: https://github.com/lastmile-ai/mcp-agent
- Focus: Agent-as-Server (expose agent as MCP server), workflow patterns (map-reduce, orchestrator, evaluator-optimizer)
- Impact on Phase 3: Agents running on AgentBnB should be exposable as MCP servers — provider daemon already does this, but formalize the pattern
- Impact on Conductor: Evaluator-optimizer workflow pattern for quality verification in escrow settlement

### Deliverable from Pre-Phase:
- A one-page ECOSYSTEM-COMPAT.md documenting: which A2A concepts we adopt, which we don't, and why.
- Card schema v3 draft that is A2A-interoperable where possible.
- Integration opportunity matrix: which external projects offer supply (providers), demand (consumers), or infrastructure (registries) that AgentBnB can tap into.

---

## Phase 1: Agent Identity Separation

### 1A: New `agents` table + agent_id derivation

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,           -- hex(sha256(public_key))
  display_name TEXT NOT NULL,
  public_key BLOB NOT NULL,            -- Ed25519 public key (32 bytes)
  operator_id TEXT,                     -- human operator who claims this agent (nullable)
  server_id TEXT,                       -- server currently running this agent (nullable)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index for operator lookups (fleet console)
CREATE INDEX IF NOT EXISTS idx_agents_operator ON agents(operator_id);
```

**agent_id derivation:**
```typescript
import { createHash } from 'crypto';

function deriveAgentId(publicKey: Buffer): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  // 16 hex chars = 64 bits = collision-resistant enough for our scale
}
```

**Files to create/modify:**
- src/identity/agent-identity.ts (NEW) — deriveAgentId(), createAgent(), lookupAgent()
- src/credit/ledger.ts — add agents table to openCreditDb()

### 1B: Migrate existing owner strings to agent records

**Migration logic:**

For each unique owner in credit_balances, credit_transactions, credit_escrow, capability_cards, provider_registry, provider_reliability_metrics:

1. If a keypair exists for this owner (in config or identity.json), derive agent_id from it
2. Create an agent record: { agent_id, display_name: owner, public_key }
3. Update all tables: owner → agent_id

**Files:**
- src/credit/migration-v8.ts (NEW) — runV8Migration()
- Must be idempotent (safe to run multiple times)
- Must handle both local DB and Fly registry DB

**Migration SQL template:**
```sql
-- For each old owner → new agent_id mapping:
UPDATE credit_balances SET owner = :agent_id WHERE owner = :old_owner;
UPDATE credit_transactions SET owner = :agent_id WHERE owner = :old_owner;
UPDATE credit_escrow SET owner = :agent_id WHERE owner = :old_owner;
UPDATE capability_cards SET owner = :agent_id WHERE owner = :old_owner;
UPDATE provider_registry SET owner = :agent_id WHERE owner = :old_owner;
UPDATE provider_reliability_metrics SET owner = :agent_id WHERE owner = :old_owner;
```

### 1C: Update all identity references across codebase

Every place that reads/writes `owner` must be updated to use `agent_id`.

**Critical files (ordered by dependency):**

1. src/types/index.ts — CapabilityCard.owner → agent_id, add AgentIdentity type
2. src/credit/ledger.ts — all credit operations use agent_id
3. src/credit/escrow.ts — hold/settle use agent_id
4. src/credit/settlement.ts — P2P settlement uses agent_id
5. src/registry/store.ts — card storage uses agent_id
6. src/registry/server.ts — all API endpoints accept/return agent_id
7. src/relay/websocket-relay.ts — connections keyed by agent_id, routing by agent_id
8. src/skills/executor.ts — execution results tagged with agent_id
9. src/runtime/service-coordinator.ts — serve registers with agent_id
10. src/cli/index.ts — CLI commands use agent_id
11. hub/ — display agent_id with display_name, fleet console uses agent_id

**Backward compatibility:**
- API continues accepting owner strings for 1 version (v8.0)
- Server internally resolves owner → agent_id via agents table lookup
- v9 removes owner string support

### 1D: Config format update

**Current (~/.agentbnb/config.json):**
```json
{
  "owner": "Cheng Wen Chen",
  "agent_id": "c2fa0f82b39a0c30"
}
```

**New (~/.agentbnb/config.json):**
```json
{
  "agent": {
    "agent_id": "a1b2c3d4e5f6g7h8",
    "display_name": "genius-bot",
    "keypair_path": "~/.agentbnb/keys/a1b2c3d4e5f6g7h8/"
  },
  "operator": {
    "display_name": "Cheng Wen Chen"
  },
  "server": {
    "id": "macmini-001"
  }
}
```

**Key directory structure:**
```
~/.agentbnb/
├── config.json              # main config
├── keys/
│   └── a1b2c3d4e5f6g7h8/   # per-agent keypair directory
│       ├── private.key
│       └── public.key
├── skills.yaml              # skills for THIS agent
└── credit.db                # local credit cache (source of truth is relay)
```

**For multi-agent setups:**
```
~/.agentbnb/
├── config.json              # default agent config
├── agents/
│   ├── genius-bot/
│   │   ├── config.json
│   │   ├── keys/
│   │   └── skills.yaml
│   └── stock-analyst/
│       ├── config.json
│       ├── keys/
│       └── skills.yaml
└── credit.db
```

---

## Phase 2: Escrow via Relay (Transaction Verification Layer)

### 2A: Relay escrow endpoints

**New relay message types:**

```typescript
// Consumer → Relay: Request escrow hold
{
  type: 'escrow_hold',
  consumer_agent_id: string,
  provider_agent_id: string,
  skill_id: string,
  amount: number,
  request_id: string,          // unique per transaction
  signature: string            // consumer's Ed25519 signature over the hold request
}

// Relay → Consumer: Hold confirmed
{
  type: 'escrow_hold_confirmed',
  request_id: string,
  escrow_id: string,           // relay-assigned escrow ID
  hold_amount: number
}

// Consumer → Relay: Request escrow settlement
{
  type: 'escrow_settle',
  escrow_id: string,
  request_id: string,
  success: boolean,
  failure_reason?: string,     // bad_execution | overload | timeout | auth_error | not_found
  result_hash?: string,        // sha256 of result payload (proof of delivery, not the payload itself)
  signature: string            // consumer's Ed25519 signature over the settle request
}

// Relay → Both: Settlement confirmed
{
  type: 'escrow_settled',
  escrow_id: string,
  request_id: string,
  provider_earned: number,     // amount - network_fee
  network_fee: number,
  consumer_remaining: number,  // updated balance
  provider_balance: number,    // updated balance
  reputation_updated: boolean
}
```

### 2B: Relay-side escrow processing

**On escrow_hold:**
1. Verify consumer signature
2. Check consumer has sufficient balance (relay DB is source of truth)
3. Deduct amount from consumer balance, create escrow record
4. Return escrow_hold_confirmed with escrow_id
5. If balance insufficient → return error, no hold

**On escrow_settle:**
1. Verify consumer signature
2. Look up escrow by escrow_id
3. If success:
   - Calculate network_fee (5%)
   - Credit provider: amount - network_fee
   - Credit platform_treasury: network_fee
   - Update reputation (using failure_reason if present)
   - Update reliability_metrics
   - Return escrow_settled to both parties
4. If failure:
   - Return credits to consumer
   - Update reputation based on failure_reason (Phase 54 rules apply)
   - Return escrow_settled with refund info

**Files to modify:**
- src/relay/websocket-relay.ts — new message handlers for escrow_hold, escrow_settle
- src/relay/types.ts — new message schemas
- src/credit/relay-escrow.ts (NEW) — relay-side escrow logic
- src/credit/escrow.ts — client-side now sends hold/settle to relay instead of local DB

### 2C: Credit balance on relay (source of truth)

**New tables on Fly registry DB:**

```sql
-- Credit balances (authoritative)
CREATE TABLE IF NOT EXISTS relay_credit_balances (
  agent_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Credit transactions (audit log)
CREATE TABLE IF NOT EXISTS relay_credit_transactions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL
);

-- Escrow records
CREATE TABLE IF NOT EXISTS relay_credit_escrow (
  id TEXT PRIMARY KEY,
  consumer_agent_id TEXT NOT NULL,
  provider_agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',  -- held | settled | refunded | expired
  network_fee INTEGER DEFAULT 0,
  failure_reason TEXT,
  consumer_signature TEXT NOT NULL,
  settle_signature TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
```

**Local credit DB becomes a cache:**
- Local DB mirrors relay state for offline reads
- All writes go through relay
- On startup, agent syncs local balance from relay
- If relay is unreachable, local cache is read-only (can't initiate new transactions)

### 2D: Client-side escrow flow update

**Current flow (local only):**
```
holdEscrow(localDb, ...) → local credit deducted
execute skill
settleEscrow(localDb, ...) → local credit transferred
```

**New flow (relay-verified):**
```
// 1. Send hold to relay
ws.send({ type: 'escrow_hold', consumer_agent_id, provider_agent_id, amount, signature })

// 2. Wait for confirmation
await receiveMessage({ type: 'escrow_hold_confirmed' })

// 3. Execute skill (P2P direct — unchanged)
const result = await executeSkill(provider_gateway_url, task)

// 4. Send settle to relay
ws.send({ type: 'escrow_settle', escrow_id, success: true, result_hash, signature })

// 5. Wait for settlement confirmation
await receiveMessage({ type: 'escrow_settled' })

// 6. Update local cache
updateLocalBalance(relay_response.consumer_remaining)
```

**Files to modify:**
- src/credit/escrow.ts — holdEscrow/settleEscrow now communicate with relay
- src/cli/index.ts — request command uses new escrow flow
- src/gateway/execute.ts — execution flow uses new escrow flow
- src/conductor/pipeline-orchestrator.ts — conductor uses new escrow flow

---

## Phase 3: Server-Agent Delegation

### 3A: Delegation token format

```typescript
interface DelegationToken {
  server_id: string;
  agent_id: string;
  granted_at: string;     // ISO timestamp
  expires_at: string;     // ISO timestamp
  permissions: string[];  // ['serve', 'publish', 'settle'] — what the server can do on behalf of agent
  signature: string;      // agent's Ed25519 signature over the above fields
}
```

### 3B: Multi-agent WebSocket registration

**Current:** One WebSocket connection = one owner.

**New:** One WebSocket connection = one server, serving multiple agents.

```typescript
// Server → Relay: Register with delegations
{
  type: 'register',
  server_id: string,
  agents: [
    {
      agent_id: string,
      display_name: string,
      cards: CardData[],
      delegation_token: DelegationToken
    }
  ]
}
```

**Relay validates each delegation token before accepting.**

**Files to modify:**
- src/relay/websocket-relay.ts — handleRegister accepts agents[] array
- src/relay/types.ts — RegisterMessage schema update
- src/runtime/service-coordinator.ts — registers multiple agents with their tokens

### 3C: Routing by agent_id

**Current:** connections.get(target_owner)
**New:** agentConnections.get(target_agent_id) → returns { ws, server_id }

Multiple agents can share one WebSocket connection (same server). The relay knows which server handles which agent.

---

## Phase 4: Operator Claims + Fleet Management

### 4A: Operator-agent binding

```sql
-- Operators table
CREATE TABLE IF NOT EXISTS operators (
  operator_id TEXT PRIMARY KEY,       -- hex(sha256(operator_public_key))
  display_name TEXT NOT NULL,
  public_key BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- Already in agents table: operator_id column
```

**Claim flow:**
1. Operator signs: { action: 'claim', agent_id, operator_id, timestamp }
2. Submit to relay: POST /api/operators/claim
3. Relay verifies operator signature, records binding
4. Fleet Console now shows this agent under operator's fleet

### 4B: Fleet Console upgrade

**GET /api/fleet/:operator_id** — returns all agents claimed by this operator

Update hub/src/pages/FleetConsolePage.tsx:
- Query by operator_id instead of owner string
- Show agent_id + display_name for each agent
- Show delegation status (which server is running each agent)

---

## Phase 5: Reliability Dividend Activation

### 5A: Define settlement cycle

- Cycle triggers every 100 successful transactions on the relay
- Or weekly, whichever comes first
- Configurable via relay config

### 5B: Dividend calculation + distribution

```typescript
function calculateDividends(cycle: CycleData): DividendDistribution[] {
  const pool = cycle.total_network_fees * DIVIDEND_POOL_RATIO; // e.g., 50% of fees
  
  const qualifying = providers.filter(p => 
    p.total_hires >= 10 && 
    p.success_rate >= 0.85 && 
    !p.has_dispute
  );
  
  const scores = qualifying.map(p => ({
    agent_id: p.agent_id,
    score: p.streak_weight * p.repeat_hire_weight * p.feedback_weight * p.availability_weight
  }));
  
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  
  return scores.map(s => ({
    agent_id: s.agent_id,
    amount: Math.floor(pool * (s.score / totalScore))
  }));
}
```

### 5C: Transparent distribution

- GET /api/dividends/:cycle_id — shows calculation for any cycle
- GET /api/dividends/agent/:agent_id — shows agent's dividend history

---

## Phase 6: Skill-Level Health Probe

### 6A: Lightweight test requests

```typescript
// HealthChecker sends to each online agent's each skill:
{
  type: 'health_probe',
  skill_id: string,
  test_payload: { prompt: '__health_check__' },
  timeout_ms: 5000
}

// Expected response:
{
  type: 'health_probe_result',
  skill_id: string,
  status: 'ok' | 'error',
  latency_ms: number
}
```

### 6B: Skill-level availability

```sql
-- Add to capability_cards or separate table
ALTER TABLE skill_health ADD COLUMN (
  card_id TEXT,
  skill_id TEXT,
  status TEXT DEFAULT 'unknown',  -- ok | degraded | offline
  last_check TEXT,
  avg_latency_ms INTEGER,
  consecutive_failures INTEGER DEFAULT 0
);
```

Hub shows per-skill health indicators (green/yellow/red) on cards.

### 6C: Security scanning basics (inspired by ClawHub incident)

When a new agent registers or publishes skills:
1. Validate skill config against known malicious patterns
2. Check for suspicious command patterns in CommandExecutor skills (e.g., curl to external IPs, base64 encoded payloads)
3. Flag newly registered agents as "unverified" for first 10 transactions
4. After 10 successful transactions with no disputes → auto-upgrade to "verified"

This does NOT block registration — it adds a trust signal layer. Hub shows "Verified" vs "New" badge.

---

## Phase 7: Ecosystem Integration Layer

### 7A: A2A Protocol Bridge (if Pre-Phase confirms compatibility)

**Goal:** A2A-native agents can discover AgentBnB providers, and AgentBnB agents can be discovered via A2A.

**Design:**
- Implement A2A Agent Card ↔ AgentBnB Capability Card v3 bidirectional converter
- AgentBnB registry exposes an A2A-compatible discovery endpoint: `GET /api/a2a/agents`
- A2A agents can query AgentBnB providers without learning AgentBnB protocol
- Economic layer (credit + escrow) remains AgentBnB-native — A2A agents get a "guest credit" wrapper

**Files:**
- src/registry/a2a-bridge.ts (NEW) — card format converter + A2A discovery endpoint
- src/registry/server.ts — mount A2A discovery route

**Why:** A2A has Google/Linux Foundation backing and multi-language SDKs. Being A2A-discoverable means every A2A agent in the ecosystem is a potential AgentBnB consumer. We provide what A2A lacks: the economic layer.

### 7B: MCP Registry Cross-Listing

**Goal:** AgentBnB providers are discoverable via MCP Official Registry.

**Design:**
- When a provider publishes a skill on AgentBnB, optionally cross-list as an MCP server entry
- Use MCP Registry's namespace format: `agentbnb/<agent_display_name>/<skill_id>`
- MCP consumers discover the skill via MCP Registry, but execution + payment goes through AgentBnB relay

**Files:**
- src/registry/mcp-registry-sync.ts (NEW) — cross-listing logic
- Optional: runs as background job, syncs every hour

### 7C: Agent-as-MCP-Server Formalization

**Goal:** Every AgentBnB provider agent is also a valid MCP server.

**Current state:** `agentbnb mcp-server` already exposes 6 MCP tools. But individual provider agents don't expose their skills as MCP tools.

**Design:**
- When `agentbnb serve --announce` runs, also start an MCP server that exposes each skill as an MCP tool
- External MCP consumers (Claude Code, Cursor, etc.) can directly call provider skills
- Payment still goes through AgentBnB escrow (MCP tool wrapper handles credit deduction)

**Files:**
- src/mcp/provider-mcp-server.ts (NEW) — generates MCP tool definitions from skills.yaml
- src/runtime/service-coordinator.ts — start provider MCP server alongside HTTP gateway

**Why:** This massively increases the addressable market. Any MCP-capable tool becomes a potential AgentBnB consumer without explicit integration.

### 7D: Semantic Discovery (inspired by MCP Gateway)

**Goal:** Hub search upgrades from keyword matching to semantic matching.

**Current state:** Hub uses FTS5 (full-text search). Good for exact matches, bad for "find me an agent that can analyze stock sentiment."

**Design:**
- Add vector embeddings for skill descriptions (using a lightweight model or API)
- New endpoint: `POST /api/discover/semantic` with natural language query
- Returns ranked results by semantic similarity + trust score + load factor

**Files:**
- src/registry/semantic-search.ts (NEW) — embedding generation + vector similarity
- src/registry/server.ts — mount semantic discovery endpoint

**Note:** This can use a simple approach (e.g., OpenAI embeddings API or local sentence-transformers) — doesn't need to be complex.

### 7E: Knowledge Graph for Agent Context (inspired by Agent-MCP)

**Goal:** Agents maintain persistent context across sessions and transactions.

**Design:**
- Each agent has a knowledge graph node linked to its agent_id
- Transaction history, skill execution context, and learned preferences persist
- When a Conductor decomposes a task, it queries the knowledge graph to inform provider selection
- "This agent performed well on similar tasks last week" becomes a routing signal

**Files:**
- src/identity/agent-knowledge.ts (NEW) — CRUD for agent knowledge entries
- src/conductor/knowledge-aware-routing.ts (NEW) — query knowledge graph during task matching

**Note:** Start simple — structured JSON entries per agent, not a full graph DB. Can evolve to Neo4j/LanceDB later.

---

## Execution Order

```
Pre-Phase: Ecosystem research (A2A + Atrest.ai + ClawHub + MCP Gateway + Agent-MCP)
           Output: ECOSYSTEM-COMPAT.md + card schema v3 draft + integration opportunity matrix
           Duration: 1 day

Week 1:  Phase 1A (agents table + agent_id derivation)
         Phase 1D (config format update)
         Phase 1B (migration script — local DBs first)

Week 2:  Phase 1C (update all identity references — the big one)
         Tests for all identity changes

Week 3:  Phase 2A + 2B (relay escrow endpoints + processing)
         Phase 2C (relay credit tables)

Week 4:  Phase 2D (client-side escrow flow)
         Phase 1B (migration on Fly registry DB)
         End-to-end test: P2P payload + relay escrow

Week 5:  Phase 3A + 3B (delegation tokens + multi-agent registration)
         Phase 3C (routing by agent_id)

Week 6:  Phase 4 (operator claims + fleet upgrade)
         Phase 5 (reliability dividend activation)

Week 7:  Phase 6 (skill-level health probe + security scanning)
         Phase 7A (A2A bridge — if Pre-Phase confirms compatibility)

Week 8:  Phase 7B + 7C (MCP Registry cross-listing + Agent-as-MCP-Server)
         Phase 7D (semantic discovery)

Week 9:  Phase 7E (knowledge graph basics)
         Full regression test
         Deploy + migration on production
```

---

## Migration Strategy

### Step 1: Local migration (safe, reversible)
- Run v8 migration on Mac mini and laptop
- Test locally: both bots work with new identity system
- If anything breaks, revert local DB from backup

### Step 2: Fly registry migration
- Backup Fly SQLite DB first: `fly ssh console -C "cp /data/registry.db /data/registry.db.v7-backup"`
- Run migration on Fly
- Verify: all cards, credits, reputation data intact with new agent_ids

### Step 3: Cutover
- Deploy v8 code to Fly
- All local agents restart with v8 config
- Monitor for 48 hours before declaring stable

### Rollback plan
- Keep v7 backup of all DBs
- v8 code maintains backward compatibility for owner strings (Phase 1C)
- If critical failure: revert Fly deploy, restore DB backup

---

## Testing Requirements

### Identity tests
- Agent creation with Ed25519 keypair → correct agent_id derivation
- Migration converts all owner strings to agent records
- API accepts both agent_id and legacy owner strings (backward compat)
- Fleet console shows agents by operator_id

### Escrow via relay tests
- Hold → relay deducts from consumer balance
- Settle success → provider credited, network fee deducted, reputation updated
- Settle failure → consumer refunded, reputation updated per failure_reason
- P2P payload does NOT go through relay (performance)
- Escrow DOES go through relay (verification)
- Consumer signature verified on hold and settle
- Insufficient balance → hold rejected

### Delegation tests
- Valid delegation token → server can serve agent's cards
- Expired delegation token → rejected
- Missing delegation → rejected
- One server, multiple agents → correct routing

### Dividend tests
- Qualifying providers receive proportional dividend
- Non-qualifying providers excluded
- Distribution visible via API
- Pool comes from network fees, not new credits

---

## Non-goals for V8

- Agent → Human credit withdrawal (requires Credit Policy conditions to be met first)
- Multi-operator per agent
- Tensor Exchange Protocol / Latent Communication
- Metabolism-driven activation (research track, not product)
- Full A2A protocol implementation (only bridge/discovery, not replacing our protocol)
- Full graph database for knowledge graph (start with structured JSON, evolve later)
- OpenClaw sessions_send as primary transport (evaluate after identity is stable)

---

## V7 Closure Checklist (MUST complete before V8 starts)

- [ ] genius-bot credit top-up + Telegram E2E test success
- [ ] Xiaoher-C card upgraded to v2 with skills array
- [ ] Both Telegram bots stable on v7
- [ ] Local OpenClaw plugin version synced (both machines)
- [ ] SkillExecutor agent version synced
- [ ] Hub deploy verified (hero, how-it-works, FAQ all updated)
- [ ] GitHub repo description updated
- [ ] FB community Credit Policy announcement posted
- [ ] IDENTITY-MODEL.md committed to repo
- [ ] At least 5 real agent-to-agent transactions through v7 economic system

---

## Success Criteria

V8 is complete when:

1. Any agent on any server can join the network using its own Ed25519 identity
2. All escrow transactions go through relay — network fee collected, reputation updated
3. One server can run multiple independent agents with separate credits and reputation
4. An operator can see and manage their fleet of agents
5. Reliability dividend distributes automatically based on collected signals
6. No transaction is invisible to the platform
7. A2A-native agents can discover AgentBnB providers without learning AgentBnB protocol
8. AgentBnB provider skills are cross-listed on MCP Registry
9. Every provider agent is also a valid MCP server (consumable by Claude Code, Cursor, etc.)
10. Hub supports semantic discovery ("find me an agent that can analyze stock sentiment")

**Agent is the user. The relay is the settlement layer. Credits belong to agents. The ecosystem is open.**

---

**Start with Phase 1A. Show me the implementation plan before writing code. Read the existing identity system (src/identity/, src/credit/signing.ts, config files) thoroughly first.**
