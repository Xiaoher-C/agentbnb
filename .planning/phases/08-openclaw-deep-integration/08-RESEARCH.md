# Phase 8: OpenClaw Deep Integration - Research

**Researched:** 2026-03-15
**Domain:** OpenClaw skill packaging, SOUL.md v2 sync, HEARTBEAT.md rule injection, CLI command extension
**Confidence:** HIGH (all integration points verified against existing source code; architectural decisions confirmed from phases 4-7 summaries)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OC-01 | `skills/agentbnb/SKILL.md` installable package with gateway.ts, auto-share.ts, auto-request.ts, credit-mgr.ts | SKILL.md spec verified (YAML frontmatter + markdown instructions); all four referenced TypeScript modules map to existing AgentRuntime, IdleMonitor, AutoRequestor, BudgetManager |
| OC-02 | HEARTBEAT.md rule injection — emit ready-to-paste autonomy rules block; auto-patch on `openclaw install agentbnb` | HEARTBEAT.md format verified from AGENT-NATIVE-PROTOCOL.md; generateHeartbeatSection() reads AutonomyConfig thresholds from config.ts |
| OC-03 | SOUL.md v2 sync — extend `parseSoulMd()` to emit `skills[]` from H2 sections for multi-skill cards | parseSoulMd() at src/skills/publish-capability.ts confirmed; extends ParsedCapability → Skill via SkillSchema from src/types/index.ts; publishFromSoul() needs v2.0 path |
| OC-04 | `agentbnb openclaw sync\|status\|rules` CLI commands for managing OpenClaw integration | Commander.js pattern established in src/cli/index.ts; three subcommands map to soul-sync, status query, heartbeat-writer |
</phase_requirements>

## Summary

Phase 8 is the integration layer that wires all prior v2.0 work (Phases 4-7) into the OpenClaw skill ecosystem. By the time this phase begins, the full autonomy loop is complete: AgentRuntime owns database handles and background jobs, IdleMonitor monitors per-skill idle rates, AutoRequestor executes capability requests with tier and budget gates, and BudgetManager enforces the credit reserve floor. Phase 8 does not build new autonomy logic — it surfaces the existing machinery as an installable OpenClaw skill and provides three CLI commands for owners to manage the OpenClaw integration.

The two primary deliverables are: (1) the `skills/agentbnb/` directory that makes AgentBnB installable via `openclaw install agentbnb`, and (2) the `src/openclaw/` module directory containing four TypeScript modules. The skill directory contains `SKILL.md` (YAML frontmatter + markdown instructions per OpenClaw spec) plus four stub adapter files that delegate to existing classes. The `src/openclaw/` modules implement SOUL.md v2 sync, HEARTBEAT.md generation, and status reporting. The three new CLI subcommands (`agentbnb openclaw sync|status|rules`) give owners a single entry point for all OpenClaw-specific operations.

The critical technical work is extending `parseSoulMd()` to produce a `CapabilityCardV2` (spec_version 2.0, skills[]) instead of a v1.0 flat card. Each H2 section in SOUL.md maps to one `Skill` entry in the `skills[]` array. The existing `publishFromSoul()` must be complemented by a `publishFromSoulV2()` that validates via `CapabilityCardV2Schema` and calls `insertCard()`. This is a contained, low-risk extension of already-tested code.

**Primary recommendation:** Build in three sequential plans — (1) `src/openclaw/` modules + parseSoulMd() extension + tests, (2) `skills/agentbnb/` skill directory + HEARTBEAT.md generation, (3) `agentbnb openclaw` CLI commands + human-verify checkpoint.

## Standard Stack

### Core (already installed — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | existing | CLI command parsing | Already used for all CLI commands in src/cli/index.ts |
| better-sqlite3 | existing | SQLite access | All DB operations use this; AgentRuntime owns handles |
| zod | existing | Schema validation | CapabilityCardV2Schema, SkillSchema already defined |
| node:fs | built-in | SOUL.md/HEARTBEAT.md file I/O | No external file library needed |
| node:path | built-in | Path resolution for skill files | Standard Node.js |

### No New Dependencies
Phase 8 adds zero new production dependencies. All required functionality (file I/O, CLI, schema validation, registry, credits) is already in place from prior phases.

**Installation:** None required.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── openclaw/                   NEW — four modules
│   ├── soul-sync.ts            parseSoulMd v2 + publishFromSoulV2
│   ├── heartbeat-writer.ts     generateHeartbeatSection + injectHeartbeatSection
│   ├── skill.ts                OpenClawSkillLifecycle interface + status reporter
│   └── index.ts                re-export for clean imports
├── skills/                     EXISTING — add handle-request.ts, publish-capability.ts
│   ├── handle-request.ts       UNCHANGED
│   ├── integration.test.ts     UNCHANGED
│   └── publish-capability.ts   EXTEND: add parseSoulMdV2 + publishFromSoulV2
skills/
└── agentbnb/                   NEW — OpenClaw installable skill package
    ├── SKILL.md                YAML frontmatter + markdown instructions
    ├── gateway.ts              adapter: delegates to AgentRuntime + createGatewayServer
    ├── auto-share.ts           adapter: delegates to IdleMonitor
    ├── auto-request.ts         adapter: delegates to AutoRequestor
    └── credit-mgr.ts           adapter: delegates to BudgetManager + getBalance
```

### Pattern 1: parseSoulMd v2 Extension
**What:** Add `parseSoulMdV2()` that returns a `ParsedSoulV2` containing `skills: Skill[]` instead of `capabilities: ParsedCapability[]`. Each H2 section becomes a `Skill` with default pricing, inputs, outputs, and level 2 (Pipeline).
**When to use:** When syncing from SOUL.md to produce a v2.0 CapabilityCard for the registry.
**Example:**
```typescript
// src/openclaw/soul-sync.ts
import { randomUUID } from 'node:crypto';
import { CapabilityCardV2Schema, SkillSchema } from '../types/index.js';
import type { CapabilityCardV2, Skill } from '../types/index.js';
import { parseSoulMd } from '../skills/publish-capability.js';
import { insertCard } from '../registry/store.js';
import type Database from 'better-sqlite3';

export function parseSoulMdV2(content: string): { agentName: string; description: string; skills: Skill[] } {
  const parsed = parseSoulMd(content);
  const skills: Skill[] = parsed.capabilities.map((cap) => ({
    id: cap.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    name: cap.name,
    description: cap.description.slice(0, 500) || cap.name,
    level: 2 as const,
    inputs: [{ name: 'input', type: 'text' as const, description: 'Input for the skill', required: true }],
    outputs: [{ name: 'output', type: 'text' as const, description: 'Output from the skill', required: true }],
    pricing: { credits_per_call: 10 },
    availability: { online: true },
  }));
  return { agentName: parsed.name || 'Unknown Agent', description: parsed.description, skills };
}

export function publishFromSoulV2(db: Database.Database, soulContent: string, owner: string): CapabilityCardV2 {
  const { agentName, description, skills } = parseSoulMdV2(soulContent);
  const card: CapabilityCardV2 = {
    spec_version: '2.0',
    id: randomUUID(),
    owner,
    agent_name: agentName,
    skills,
    availability: { online: true },
  };
  // Throws VALIDATION_ERROR if schema is invalid
  CapabilityCardV2Schema.parse(card);
  insertCard(db, card);
  return card;
}
```

### Pattern 2: HEARTBEAT.md Rule Generation
**What:** `generateHeartbeatSection()` reads the current `AutonomyConfig` and `BudgetConfig` from config and emits a ready-to-paste markdown block matching the template in AGENT-NATIVE-PROTOCOL.md.
**When to use:** `agentbnb openclaw rules` command and auto-patch during install.
**Example:**
```typescript
// src/openclaw/heartbeat-writer.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { AutonomyConfig } from '../autonomy/tiers.js';
import type { BudgetConfig } from '../credit/budget.js';

const HEARTBEAT_MARKER_START = '<!-- agentbnb:start -->';
const HEARTBEAT_MARKER_END = '<!-- agentbnb:end -->';

export function generateHeartbeatSection(
  autonomy: AutonomyConfig,
  budget: BudgetConfig,
): string {
  const t1 = autonomy.tier1_max_credits;
  const t2 = autonomy.tier2_max_credits;
  const reserve = budget.reserve_credits;
  return [
    HEARTBEAT_MARKER_START,
    '## AgentBnB Protocol',
    '',
    'You are a participant in the AgentBnB capability sharing network.',
    '',
    '### Sharing Rules',
    '- When your idle_rate exceeds 70%, automatically share idle capabilities',
    '- Accept incoming requests that match your published Capability Card',
    '- Track credit earnings and report to owner weekly',
    '',
    '### Requesting Rules',
    '- When you encounter a task you cannot complete with local skills:',
    '  1. Query AgentBnB network for matching capabilities',
    '  2. If found and credit sufficient, automatically request',
    '  3. Integrate result into your current workflow',
    '- Budget limits:',
    `  - < ${t1} credits: auto-execute, no notification`,
    `  - ${t1}-${t2} credits: execute, notify owner after`,
    `  - > ${t2} credits: ask owner before executing`,
    '',
    '### Credit Management',
    `- Maintain minimum balance of ${reserve} credits (reserve for emergencies)`,
    `- If balance drops below ${reserve}, increase sharing priority`,
    '- If balance exceeds 500, notify owner of surplus',
    HEARTBEAT_MARKER_END,
  ].join('\n');
}

export function injectHeartbeatSection(heartbeatPath: string, section: string): void {
  if (!existsSync(heartbeatPath)) {
    writeFileSync(heartbeatPath, section + '\n', 'utf-8');
    return;
  }
  let content = readFileSync(heartbeatPath, 'utf-8');
  // Replace existing block if present
  const startIdx = content.indexOf(HEARTBEAT_MARKER_START);
  const endIdx = content.indexOf(HEARTBEAT_MARKER_END);
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + section + content.slice(endIdx + HEARTBEAT_MARKER_END.length);
  } else {
    content += '\n' + section + '\n';
  }
  writeFileSync(heartbeatPath, content, 'utf-8');
}
```

### Pattern 3: SKILL.md Format
**What:** OpenClaw skills require a `SKILL.md` file with YAML frontmatter and markdown instructions. Verified from FEATURES.md research (HIGH confidence from official OpenClaw docs).
**When to use:** All OpenClaw installable skill packages.
**Example:**
```markdown
---
name: agentbnb
version: 1.0.0
description: P2P capability sharing — earn credits by sharing idle APIs, spend credits to request capabilities from peers
author: AgentBnB
---

# AgentBnB Skill

You have access to the AgentBnB P2P capability sharing network.

## Sharing
When you detect idle resources (APIs you pay for but rarely use), share them:
- Run `agentbnb openclaw sync` to publish your SOUL.md as a multi-skill card
- The gateway auto-shares skills when idle_rate exceeds the configured threshold

## Requesting
When you encounter a task you cannot complete with local skills:
- Use `agentbnb request --query "<description>" --max-cost <credits>` to find and execute peer capabilities
- Auto-request fires autonomously within configured tier limits

## Status
Check integration health with `agentbnb openclaw status`
View current autonomy rules with `agentbnb openclaw rules`
```

### Pattern 4: openclaw CLI Subcommand Group
**What:** Commander.js subcommand group `agentbnb openclaw <command>` with three subcommands.
**When to use:** All OpenClaw management operations.
**Example:**
```typescript
// In src/cli/index.ts — extend existing Commander program
const openclaw = program.command('openclaw').description('OpenClaw integration commands');

openclaw
  .command('sync')
  .description('Read SOUL.md and publish multi-skill card to registry')
  .option('--soul-path <path>', 'Path to SOUL.md', './SOUL.md')
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) { console.error('Run agentbnb init first'); process.exit(1); }
    const db = openDatabase(config.db_path);
    const content = readFileSync(opts.soulPath, 'utf-8');
    const card = publishFromSoulV2(db, content, config.owner);
    console.log(`Published card ${card.id} with ${card.skills.length} skill(s)`);
  });

openclaw
  .command('status')
  .description('Show install state, tier, balance, and per-skill idle rate')
  .action(async () => {
    // Read config, open DBs, query AgentRuntime state
    // Display: owner, gateway_url, tier thresholds, balance, reserve, per-skill idle_rate
  });

openclaw
  .command('rules')
  .description('Emit ready-to-paste HEARTBEAT.md autonomy rules block')
  .option('--inject <path>', 'Auto-patch a HEARTBEAT.md file at this path')
  .action(async (opts) => {
    // Generate and either print or inject
  });
```

### Anti-Patterns to Avoid
- **Rebuilding parseSoulMd():** The v1.0 function is well-tested (it's in src/skills/publish-capability.ts). Call it and map its output rather than writing a new parser.
- **Opening new DB connections in openclaw modules:** All DB access must go through the AgentRuntime's `registryDb` and `creditDb` handles. Do not call `openDatabase()` in openclaw/* modules when inside the serve lifecycle — only the CLI standalone commands open their own connections.
- **Modifying the skills/ adapter files to contain business logic:** The four files in `skills/agentbnb/` are thin adapters that import from `src/`. They must not contain autonomy logic.
- **Hardcoding autonomy thresholds in HEARTBEAT.md output:** Always read from `config.autonomy` so the generated rules match actual owner configuration.
- **Timer/heartbeat conflict:** Standalone process mode is locked — AgentRuntime owns timers. Do not add croner jobs inside `skills/agentbnb/` adapter files; the adapters just call `start()` on already-constructed objects.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOUL.md parsing | New markdown parser | `parseSoulMd()` in src/skills/publish-capability.ts | Already tested, handles H1/H2/H3 edge cases |
| Skill schema validation | Manual field checks | `CapabilityCardV2Schema.parse()` + `SkillSchema` | Zod gives typed error messages; schemas are source of truth |
| Credit balance query | Raw SQL | `getBalance(creditDb, owner)` from src/credit/ledger.ts | Already handles all balance edge cases |
| Idle rate read | DB query | `IdleMonitor.poll()` + `getSkillRequestCount()` | Already implemented in Phase 6 |
| Auto-request trigger | New flow | `AutoRequestor.requestWithAutonomy()` | Full Tier/Budget/Escrow flow; don't duplicate |
| Config I/O | Custom file read/write | `loadConfig()` + `saveConfig()` from src/cli/config.ts | Centralizes config path resolution |
| Card insertion | Raw SQL | `insertCard(db, card)` from src/registry/store.ts | Handles FTS5 trigger update + JSON serialization |

**Key insight:** Phase 8 is a pure integration phase. Every piece of logic it needs was built in Phases 4-7. The openclaw modules are thin wrappers — their value is the connection and the CLI surface, not new algorithms.

## Common Pitfalls

### Pitfall 1: parseSoulMd() Maps to v1.0 Schema — publishFromSoulV2 Must Use v2.0 Schema
**What goes wrong:** The existing `publishFromSoul()` creates a `CapabilityCard` (spec_version 1.0). Calling it from the sync command and wrapping in CapabilityCardV2 will fail Zod validation because the discriminated union distinguishes on `spec_version`.
**Why it happens:** `parseSoulMd()` returns `ParsedSoul.capabilities[]` (not `skills[]`); the mapping to `Skill[]` is Phase 8's job.
**How to avoid:** Implement `publishFromSoulV2()` in `src/openclaw/soul-sync.ts` that calls `parseSoulMd()` (unchanged), maps each `ParsedCapability` to a `Skill`, constructs a `CapabilityCardV2`, validates with `CapabilityCardV2Schema.parse()`, then calls `insertCard()`.
**Warning signs:** Zod parse errors mentioning `spec_version` or `skills` field.

### Pitfall 2: Skill ID Collision on Re-Sync
**What goes wrong:** Running `agentbnb openclaw sync` twice creates two cards in the registry for the same agent.
**Why it happens:** `publishFromSoulV2()` uses `randomUUID()` for the card `id` field on every call, so each sync produces a new row.
**How to avoid:** Before inserting, check if a card with the same owner already exists. If yes, `updateCard()` instead of `insertCard()`. Alternatively, derive the card ID deterministically from the owner name (e.g., `uuidv5(owner, NAMESPACE)`). The simpler path: `updateOrInsert` — search for cards by owner, update if found, insert if not.
**Warning signs:** Duplicate cards appearing in `agentbnb discover`.

### Pitfall 3: HEARTBEAT.md Injection Destroys Existing Content
**What goes wrong:** Naive file write overwrites an agent's existing HEARTBEAT.md rules.
**Why it happens:** `writeFileSync(path, section)` replaces the entire file.
**How to avoid:** Use HTML comment markers (`<!-- agentbnb:start -->` / `<!-- agentbnb:end -->`) to bracket the AgentBnB block. On re-inject, replace only between those markers; append if no markers found.
**Warning signs:** Agent reports losing existing HEARTBEAT.md content after `agentbnb openclaw rules --inject`.

### Pitfall 4: skills/agentbnb/ TypeScript Files are Not Compiled
**What goes wrong:** The `skills/agentbnb/gateway.ts` etc. are TypeScript source files in the project root's `skills/` directory, outside the `src/` compilation path.
**Why it happens:** `tsconfig.json` typically compiles `src/**/*.ts`; the `skills/` directory at the project root is not in scope.
**How to avoid:** Two options: (a) put the adapter files inside `src/openclaw/adapters/` and export them (simpler, keeps compilation clean), or (b) add `skills/` to tsconfig `include`. Per the AGENT-NATIVE-PROTOCOL.md intent, the `skills/agentbnb/` directory should be the installable package — for TypeScript projects it is idiomatic to have `skills/agentbnb/` contain `.ts` source files that the owner's TypeScript project compiles. Document this in SKILL.md.
**Warning signs:** `tsc --noEmit` shows no errors but `skills/agentbnb/gateway.ts` is not type-checked.

### Pitfall 5: agentbnb openclaw status Opens Its Own DB Connections
**What goes wrong:** `openclaw status` opens `openDatabase()` and `openCreditDb()` independently while `agentbnb serve` is running — producing `SQLITE_BUSY` errors.
**Why it happens:** SQLite WAL mode allows concurrent readers but only one writer at a time.
**How to avoid:** `openclaw status` reads from SQLite in read-only mode (only SELECT queries). All registry queries (`listCards`, `getBalance`) are reads and safe in WAL mode. The status command must NOT write to the DB. Confirm by reviewing that no INSERT/UPDATE/DELETE is issued.
**Warning signs:** `SQLITE_BUSY` errors when running `agentbnb openclaw status` while `agentbnb serve` is active.

### Pitfall 6: Skill IDs Derived from H2 Headings May Contain Invalid Characters
**What goes wrong:** `parseSoulMd()` extracts raw H2 headings as skill names. Converting to skill IDs by lowercasing and replacing spaces may produce strings with special characters (slashes, parentheses, Unicode) that fail `SkillSchema.id.min(1)`.
**Why it happens:** SOUL.md H2 headings are freeform markdown.
**How to avoid:** Sanitize the derived `id` with a regex: `name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`. If the result is empty after sanitization, fall back to a UUID. Add a test case for special characters in H2 headings.
**Warning signs:** `SkillSchema` Zod parse error on the `id` field.

## Code Examples

Verified patterns from existing source:

### Reading current config (for status command)
```typescript
// Pattern from src/cli/index.ts (all existing commands use this)
import { loadConfig } from './config.js';
const config = loadConfig();
if (!config) {
  console.error('AgentBnB not initialized. Run: agentbnb init');
  process.exit(1);
}
```

### Opening DB for standalone CLI commands (not serve lifecycle)
```typescript
// Pattern from src/cli/index.ts serve command
import { openDatabase } from '../registry/store.js';
import { openCreditDb } from '../credit/ledger.js';
const db = openDatabase(config.db_path);
const creditDb = openCreditDb(config.credit_db_path);
```

### Inserting a v2.0 card (from Phase 4 migration code)
```typescript
// insertCard in src/registry/store.ts handles both v1.0 and v2.0 shapes
// It JSON.stringifies the card.data blob and updates FTS5 triggers
insertCard(db, card); // card: CapabilityCardV2
```

### Listing cards for status display
```typescript
// From src/registry/store.ts — listCards returns AnyCard[]
import { listCards } from '../registry/store.js';
const cards = listCards(db, config.owner);
// Filter for v2.0 cards to show per-skill idle rates
const v2Cards = cards.filter((c) => c.spec_version === '2.0');
```

### getBalance for status display
```typescript
// From src/credit/ledger.ts
import { getBalance } from '../credit/ledger.js';
const balance = getBalance(creditDb, config.owner);
```

### Accessing _internal.idle_rate for per-skill status display
```typescript
// Skills store idle_rate in _internal per Phase 6 decisions
// updateSkillIdleRate writes to card.skills[i]._internal.idle_rate in store.ts
// Reading: parse the card from DB, access skill._internal?.idle_rate
const skill = card.skills.find((s) => s.id === skillId);
const idleRate = (skill?._internal as { idle_rate?: number } | undefined)?.idle_rate ?? null;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single flat CapabilityCard per skill | Multi-skill CapabilityCardV2 with skills[] | Phase 4 (04-02) | parseSoulMdV2 must produce spec_version 2.0 |
| parseSoulMd() returns ParsedCapability[] | Extension needed to map to Skill[] | Phase 8 (this phase) | New publishFromSoulV2() in soul-sync.ts |
| No openclaw CLI commands | agentbnb openclaw sync/status/rules | Phase 8 (this phase) | Commander subcommand group |
| No skills/ package directory | skills/agentbnb/ installable skill | Phase 8 (this phase) | SKILL.md + 4 adapter files |
| OpenClaw message bus transport | Explicitly deferred (out of scope) | v2.0 init | No message-bus.ts in this phase |

**Explicitly out of scope (per REQUIREMENTS.md):**
- `message-bus.ts` — OpenClaw message bus API is LOW confidence; not implemented in Phase 8
- Dynamic pricing — out of scope for all v2.0 phases

## Open Questions

1. **Should `agentbnb openclaw sync` upsert or always insert?**
   - What we know: `insertCard()` always inserts; no upsert function exists in store.ts
   - What's unclear: Whether the planner should add an `upsertCard()` helper or derive card ID deterministically
   - Recommendation: Add `upsertCardByOwner(db, card)` in store.ts that does INSERT OR REPLACE keyed on the card ID. Derive the card ID from `uuidv5(owner, AGENTBNB_NAMESPACE)` or simply search for existing owner card and UPDATE it. The simpler approach: query `listCards(db, owner)`, if v2.0 card found call `updateCard()` (if it exists) or delete-then-insert. Flag this for the planner to decide.

2. **Should the `skills/agentbnb/*.ts` adapters be TypeScript source or pre-compiled JavaScript?**
   - What we know: The project uses TypeScript strict mode and compiles `src/`; `skills/` is a new directory
   - What's unclear: Whether OpenClaw expects `.ts` or `.js` in skill packages
   - Recommendation: Provide `.ts` source files (consistent with the project's TypeScript-first approach). Add a note in SKILL.md that owners must compile if their project doesn't include `skills/` in tsconfig. This is the pragmatic choice for a Phase 0 dogfood deployment with OpenClaw agents that also use TypeScript.

3. **Does `agentbnb openclaw status` need to query the IdleMonitor's live state or read from DB?**
   - What we know: `IdleMonitor.poll()` writes idle_rate to card `_internal` in SQLite; status command reads SQLite
   - What's unclear: Whether the DB `_internal.idle_rate` is always current (only updated every 60s)
   - Recommendation: Read from SQLite. The 60-second staleness is acceptable for a status display. Document that the value shown is "last computed idle_rate" (may be up to 60s old). This avoids the complexity of IPC between a CLI command and a running serve process.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing project standard) |
| Config file | vitest.config.ts (existing) |
| Quick run command | `pnpm vitest run src/openclaw/` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OC-01 | SKILL.md exists with correct YAML frontmatter | unit (file system check) | `pnpm vitest run src/openclaw/soul-sync.test.ts` | Wave 0 |
| OC-01 | parseSoulMdV2() maps H2 sections to skills[] | unit | `pnpm vitest run src/openclaw/soul-sync.test.ts` | Wave 0 |
| OC-01 | publishFromSoulV2() inserts valid v2.0 card in registry | unit | `pnpm vitest run src/openclaw/soul-sync.test.ts` | Wave 0 |
| OC-02 | generateHeartbeatSection() emits correct rules block | unit | `pnpm vitest run src/openclaw/heartbeat-writer.test.ts` | Wave 0 |
| OC-02 | injectHeartbeatSection() appends to empty file | unit | `pnpm vitest run src/openclaw/heartbeat-writer.test.ts` | Wave 0 |
| OC-02 | injectHeartbeatSection() replaces existing block | unit | `pnpm vitest run src/openclaw/heartbeat-writer.test.ts` | Wave 0 |
| OC-03 | parseSoulMdV2() with special-char H2 headings sanitizes skill IDs | unit | `pnpm vitest run src/openclaw/soul-sync.test.ts` | Wave 0 |
| OC-03 | parseSoulMdV2() with zero H2 sections returns skills[] of length 0 (edge case) | unit | `pnpm vitest run src/openclaw/soul-sync.test.ts` | Wave 0 |
| OC-04 | agentbnb openclaw sync reads SOUL.md and publishes card | integration (CLI smoke) | manual — human-verify checkpoint | manual |
| OC-04 | agentbnb openclaw status shows tier, balance, idle rates | integration (CLI smoke) | manual — human-verify checkpoint | manual |
| OC-04 | agentbnb openclaw rules emits HEARTBEAT.md block | integration (CLI smoke) | manual — human-verify checkpoint | manual |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/openclaw/`
- **Per wave merge:** `pnpm vitest run` (full suite, backend only — hub/ React failures are pre-existing)
- **Phase gate:** Full suite green before human-verify checkpoint

### Wave 0 Gaps
- [ ] `src/openclaw/soul-sync.test.ts` — covers OC-01, OC-03 (parseSoulMdV2, publishFromSoulV2, edge cases)
- [ ] `src/openclaw/heartbeat-writer.test.ts` — covers OC-02 (generateHeartbeatSection, injectHeartbeatSection)
- [ ] `src/openclaw/soul-sync.ts` — implementation file
- [ ] `src/openclaw/heartbeat-writer.ts` — implementation file
- [ ] `src/openclaw/skill.ts` — OpenClawSkillLifecycle interface + status query helpers
- [ ] `skills/agentbnb/SKILL.md` — OpenClaw installable skill manifest
- [ ] `skills/agentbnb/gateway.ts` — adapter delegating to AgentRuntime + createGatewayServer
- [ ] `skills/agentbnb/auto-share.ts` — adapter delegating to IdleMonitor
- [ ] `skills/agentbnb/auto-request.ts` — adapter delegating to AutoRequestor
- [ ] `skills/agentbnb/credit-mgr.ts` — adapter delegating to BudgetManager + getBalance

## Sources

### Primary (HIGH confidence)
- `src/skills/publish-capability.ts` — parseSoulMd() implementation verified directly; extension path confirmed
- `src/types/index.ts` — SkillSchema, CapabilityCardV2Schema, AnyCardSchema verified; Skill type shape confirmed
- `src/autonomy/tiers.ts` — AutonomyConfig, getAutonomyTier(), insertAuditEvent() confirmed; DEFAULT_AUTONOMY_CONFIG = {0,0}
- `src/credit/budget.ts` — BudgetManager.canSpend(), DEFAULT_BUDGET_CONFIG.reserve_credits = 20 confirmed
- `src/autonomy/idle-monitor.ts` — IdleMonitor class, poll() pattern, Cron lifecycle confirmed
- `src/autonomy/auto-request.ts` — AutoRequestor.requestWithAutonomy() confirmed; scorePeers(), minMaxNormalize() exported
- `src/runtime/agent-runtime.ts` — AgentRuntime, registerJob(), shutdown() confirmed; owns registryDb + creditDb
- `src/cli/index.ts` — Commander command structure confirmed; loadConfig() + openDatabase() patterns verified
- `src/cli/config.ts` — AgentBnBConfig shape confirmed; autonomy + budget fields present
- `AGENT-NATIVE-PROTOCOL.md` — HEARTBEAT.md template, skills/agentbnb/ directory intent, SOUL.md → card mapping
- `.planning/phases/07-auto-request/07-02-SUMMARY.md` — AutoRequestor confirmed Phase 7 complete
- `.planning/phases/06-idle-rate-monitoring-auto-share/06-02-SUMMARY.md` — IdleMonitor confirmed Phase 6 complete
- `.planning/research/FEATURES.md` — SKILL.md format HIGH confidence (verified from OpenClaw official docs)
- `.planning/REQUIREMENTS.md` — OC-01 through OC-04 verbatim requirements confirmed

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — src/openclaw/ module map, soul-sync.ts/heartbeat-writer.ts/skill.ts interfaces (architectural intent, verified against Phase 4-7 actuals)
- `.planning/research/SUMMARY.md` — standalone process mode decision locked (not OpenClaw heartbeat-driven)

### Tertiary (LOW confidence)
- OpenClaw message bus API — explicitly out of scope; message-bus.ts not built in this phase per REQUIREMENTS.md Out of Scope table

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing libraries confirmed in source
- Architecture: HIGH — all integration points verified against actual Phase 4-7 implementations
- parseSoulMd() extension: HIGH — source code read directly; mapping path is straightforward
- HEARTBEAT.md generation: HIGH — template confirmed in AGENT-NATIVE-PROTOCOL.md; HTML comment markers are standard pattern
- CLI commands: HIGH — Commander.js pattern established in src/cli/index.ts; three subcommands map cleanly
- skills/agentbnb/ TypeScript compilation scope: MEDIUM — whether skills/ needs tsconfig inclusion is a project-specific decision not yet validated

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain — no external dependencies changing)
