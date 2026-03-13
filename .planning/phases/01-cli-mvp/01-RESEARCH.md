# Phase 1: CLI MVP — Research

**Researched:** 2026-03-13
**Domain:** npm CLI distribution, mDNS P2P discovery, API key auth, Capability Card spec stabilization, OpenSpec SDD workflow
**Confidence:** HIGH (core stack); MEDIUM (mDNS cross-platform); LOW (OpenSpec "integration" intent)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R-007 | npm package: `npx agentbnb init` — publishable to npm, installable by external users | tsup already builds `dist/cli/index.js`; need `files` field, `exports`, `prepublishOnly` script, and native binary strategy for better-sqlite3 |
| R-008 | Capability Card spec v1.0 — stable schema with version field and backwards-compat guarantee | Current schema in `src/types/index.ts` is nearly complete; add `spec_version: "1.0"` field and freeze with changelog |
| R-009 | P2P discovery — mDNS (local network) or simple relay server | bonjour-service (8.2M weekly downloads, TypeScript, pure JS) is the standard choice; fallback relay server pattern documented |
| R-010 | Authentication: API key exchange between agents | Current bearer token auth is already in `src/gateway/auth.ts`; Phase 1 needs a `connect` CLI command so Agent A can register Agent B's URL + token locally |
| R-011 | OpenSpec integration for stable API specs | OpenSpec is a spec-driven development workflow tool (not an API contract format); "integration" means adopting OpenSpec's SDD process for this phase's specs, not adding a runtime dependency |
| R-012 | Documentation and examples | README.md + `examples/` directory with working two-agent demo; no library dependency needed |
</phase_requirements>

---

## Summary

Phase 1 transforms AgentBnB from an internal dogfood tool into a publicly installable npm package. The Phase 0 codebase is fully working (91 tests passing, 6 CLI commands, Fastify gateway, credit ledger, OpenClaw integration). Phase 1 adds the external-user layer on top.

The biggest technical risk is **native module distribution**: `better-sqlite3` uses a native `.node` binary. When users run `npx agentbnb init`, npm must find a prebuilt binary for their platform or compile from source (requiring Python + a C++ compiler). The research confirms this is a well-known pain point. Two viable paths exist: (a) rely on better-sqlite3's prebuilt binaries for Node 20 LTS (which do exist for macOS/Linux/Windows x64) and document requirements clearly, or (b) switch to `node:sqlite` (built into Node 22.5+) and drop the native dep entirely. Since the project targets Node 20+ and ships to external users, path (a) with clear error messages is the Phase 1 recommendation; path (b) is a Phase 2 refactor candidate.

The **mDNS discovery** requirement is achievable with `bonjour-service` (8.2M weekly downloads, TypeScript, pure JS, no native deps). The critical caveat is that mDNS is LAN-only — agents on different networks cannot discover each other. A simple relay server (a single URL agents can announce to and query) is the cross-network fallback. Phase 1 should implement both: mDNS for LAN and a `--relay` flag for cross-network.

**OpenSpec** in the phase description means adopting the OpenSpec SDD workflow for this phase's specification artifacts — not adding it as a runtime dependency. OpenSpec's slash commands help structure the `npx agentbnb` API contract before coding it. It is purely a development process tool.

**Primary recommendation:** Build in this order: (1) npm publish pipeline + native binary strategy, (2) Capability Card v1.0 schema freeze + `spec_version` field, (3) `connect` CLI command for API key exchange, (4) bonjour-service mDNS discovery, (5) README + examples. OpenSpec integration = adopt the SDD process, not a code change.

---

## Standard Stack

### Core (existing — no new installs for most)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | 8.3.0 | Bundle CLI to `dist/` for npm publish | Already in devDependencies; builds ESM with shebang |
| better-sqlite3 | 12.6.2 (upgrade from 11.6.0) | SQLite storage | Keep for Phase 1; prebuilts exist for Node 20 LTS on x64 and arm64 |
| commander | 12.1.0 | CLI parsing | Already in use; no changes |
| fastify | 5.1.0 | Gateway server | Already in use; no changes |
| zod | 3.24.0 | Schema validation | Already in use; extend for v1.0 freeze |

### New Dependencies

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bonjour-service | ^1.3.0 | mDNS LAN discovery | 8.2M weekly downloads; TypeScript; pure JS (no native build); active maintenance (ON LX Ltd); fork of dormant `bonjour` package |

**Installation:**
```bash
pnpm add bonjour-service
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bonjour-service | multicast-dns | Lower-level; requires manual DNS record construction; bonjour-service wraps it cleanly |
| bonjour-service | mdns (npm) | Requires native build (libavahi on Linux, Bonjour SDK on Windows) — NOT suitable for easy npm distribution |
| better-sqlite3 | node:sqlite (Node 22+) | Eliminates native dep entirely but requires Node 22.5+; project targets Node 20+ |
| better-sqlite3 | @electric-sql/pglite | PostgreSQL in WASM — overkill; loses FTS5; no migration path for Phase 0 data |

---

## Architecture Patterns

### Recommended Project Structure Additions

```
src/
├── discovery/           # NEW — mDNS and relay
│   ├── mdns.ts          # bonjour-service publish/browse
│   └── relay.ts         # Optional HTTP relay client
├── registry/            # Existing
├── gateway/             # Existing
├── credit/              # Existing
├── cli/
│   ├── index.ts         # Extend with: connect, discover --remote
│   └── config.ts        # Extend AgentBnBConfig with: peers, relay_url
└── types/
    └── index.ts         # Add spec_version to CapabilityCard
examples/
├── agent-a/             # alice agent init + publish
│   └── card.json
└── agent-b/             # bob agent init + request
    └── demo.sh
```

### Pattern 1: npm Package Distribution with Native Module

**What:** Configure package.json correctly so `npx agentbnb` works for end users with better-sqlite3.
**When to use:** Publishing to npm for external consumption.

```jsonc
// package.json changes needed
{
  "version": "1.0.0",
  "files": ["dist", "README.md"],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts src/cli/index.ts --format esm --dts",
    "prepublishOnly": "pnpm run build && pnpm run test:run && pnpm run typecheck"
  },
  "engines": { "node": ">=20.0.0" }
}
```

**Key insight:** `better-sqlite3` uses `prebuild-install` to fetch prebuilt `.node` binaries at install time. For Node 20 LTS on macOS (arm64/x64), Linux (x64), and Windows (x64), prebuilt binaries exist and will be downloaded automatically. No compilation required for these platforms. If the prebuilt fetch fails, npm falls back to `node-gyp rebuild` which needs Python + compiler. Document this clearly in README.

### Pattern 2: Capability Card v1.0 Schema Freeze

**What:** Add `spec_version` field and mark the schema as stable for external users.
**When to use:** Before npm publish — external users need schema stability guarantees.

```typescript
// src/types/index.ts addition
export const CapabilityCardSchema = z.object({
  spec_version: z.literal('1.0').default('1.0'),  // ADD THIS
  id: z.string().uuid(),
  // ... rest unchanged ...
});
```

The `spec_version: '1.0'` field makes schema evolution traceable. Use `z.literal('1.0').default('1.0')` so existing Phase 0 cards without the field remain valid after migration.

### Pattern 3: mDNS LAN Discovery with bonjour-service

**What:** Agents announce themselves on the LAN and discover peers.
**When to use:** Two machines on the same network.

```typescript
// Source: bonjour-service npm docs
import { Bonjour } from 'bonjour-service';

const bonjour = new Bonjour();

// Announce this agent
bonjour.publish({
  name: config.owner,
  type: 'agentbnb',
  port: config.gateway_port,
  txt: { owner: config.owner, version: '1.0' },
});

// Discover peers
const browser = bonjour.find({ type: 'agentbnb' });
browser.on('up', (service) => {
  console.log(`Found agent: ${service.name} at ${service.host}:${service.port}`);
});

// Cleanup
process.on('SIGINT', () => {
  bonjour.unpublishAll(() => bonjour.destroy());
});
```

### Pattern 4: API Key Exchange (Peer Registration)

**What:** Agent A tells AgentBnB "I trust Agent B at this URL with this token."
**When to use:** Connecting two agents before they can request capabilities from each other.

```typescript
// New CLI command: agentbnb connect <name> <url> <token>
// Stores peer config in ~/.agentbnb/peers.json
interface PeerConfig {
  name: string;
  url: string;
  token: string;
  added_at: string;
}
```

The existing `requestCapability()` in `src/gateway/client.ts` already accepts `gatewayUrl` + `token` params. Phase 1 just needs persistent peer storage so the user doesn't pass URL+token on every `request` call.

### Pattern 5: CLI Integration Testing

**What:** Test CLI commands end-to-end using `node:child_process` + `execa`.
**When to use:** For `init`, `connect`, `discover --local` integration tests.

```typescript
// Source: https://www.lekoarts.de/how-to-test-cli-output-in-jest-vitest/
import { execaSync } from 'execa';
import { stripVTControlCharacters } from 'node:util';

const CLI_PATH = new URL('../../dist/cli/index.js', import.meta.url).pathname;

function runCLI(args: string[], env?: Record<string, string>) {
  const result = execaSync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, ...env },
    reject: false,
  });
  return {
    exitCode: result.exitCode,
    stdout: stripVTControlCharacters(result.stdout),
    stderr: stripVTControlCharacters(result.stderr),
  };
}
```

**Note:** Requires `pnpm build` before tests. Add `vitest.globalSetup` to build if not present.

### Anti-Patterns to Avoid

- **Publishing without `files` field:** Without `files: ["dist"]`, the entire source tree is included in the npm tarball (including `.planning/`, test fixtures, etc.). Always specify `files`.
- **Using `mdns` npm package for distribution:** `mdns` requires native libavahi on Linux and Bonjour SDK on Windows — unacceptable install friction for external users. Use `bonjour-service` (pure JS) instead.
- **Blocking on mDNS for cross-network use:** mDNS is multicast UDP; it does not cross network segments or the internet. Don't design the `request` flow assuming mDNS always works. The `connect` command (manual peer registration) must always be the reliable path.
- **Schema changes without `spec_version`:** Adding/removing fields on published schemas without versioning breaks external users. Every schema change after v1.0 must bump `spec_version`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| mDNS service announcement | Custom UDP multicast packets | `bonjour-service` | mDNS has edge cases around conflict resolution, cache flush, TTL, and DNS-SD service types |
| CLI integration test runner | Custom `child_process` wrapper | `execa` (already a vitest peer dep) | Handles encoding, cross-platform PATH, exit codes correctly |
| npm publish validation | Manual checklist | `publint` (`npx publint`) | Catches exports misconfig, missing types, broken bin entries before publish |
| TypeScript bundling | Custom rollup config | `tsup` (already configured) | Handles shebang preservation, ESM, multiple entry points |

**Key insight:** The mDNS protocol has many subtle correctness requirements. Any custom implementation will fail in edge cases (link-local address selection, probe/announce cycles, Goodbye packets on shutdown). Use bonjour-service.

---

## Common Pitfalls

### Pitfall 1: better-sqlite3 native binary fails on install
**What goes wrong:** User runs `npx agentbnb init`, npm tries to fetch prebuilt binary, falls back to compiling, fails with Python/gyp error.
**Why it happens:** better-sqlite3 uses a native `.node` addon. Prebuilt binaries are only published for specific Node + OS + arch combinations.
**How to avoid:**
- Document in README: "Requires Node 20+ (LTS). Prebuilt binaries available for macOS (arm64/x64), Linux (x64), Windows (x64). For other platforms, Python and a C++ compiler are required."
- Provide a clear error message in the CLI: if database open fails, print platform/Node version info.
- Consider upgrading to better-sqlite3 v12 (latest) before publish to get latest prebuilt matrix.
**Warning signs:** Install output contains `node-gyp rebuild`, `npm warn install`.

### Pitfall 2: mDNS broken on VPN or Docker networks
**What goes wrong:** Agent runs `agentbnb serve --announce` but peer running `agentbnb discover --local` finds nothing.
**Why it happens:** mDNS uses UDP multicast on 224.0.0.251:5353. VPNs, Docker bridge networks, and corporate firewalls commonly block multicast.
**How to avoid:** Make mDNS optional/additive. The `connect` command (manual URL+token entry) must always work. Communicate mDNS as "convenience feature, not required."
**Warning signs:** Discovery returns nothing even on same LAN.

### Pitfall 3: ESM shebang not preserved in CLI dist
**What goes wrong:** `npx agentbnb` runs but fails with `SyntaxError: Cannot use import statement`.
**Why it happens:** tsup may strip or misplace the `#!/usr/bin/env node` shebang when bundling ESM.
**How to avoid:** The existing tsup build already works locally. Verify with `head -1 dist/cli/index.js` — it must be `#!/usr/bin/env node`. If missing, add `banner: { js: '#!/usr/bin/env node' }` to tsup config.
**Warning signs:** `Permission denied` or `SyntaxError` when running installed package.

### Pitfall 4: `gateway_url` defaults to `localhost` in config
**What goes wrong:** Agent A discovers Agent B via mDNS, but the stored `gateway_url` is `http://localhost:7700` — Agent A cannot reach localhost on Agent B's machine.
**Why it happens:** `agentbnb init` currently defaults `gateway_url` to `http://localhost:<port>`. For multi-machine use, this must be the machine's LAN IP or hostname.
**How to avoid:** During `init`, detect the machine's non-loopback IP and use it for `gateway_url`. Provide `--host` flag to override.
**Warning signs:** `agentbnb request` from remote machine gets connection refused.

### Pitfall 5: `spec_version` field breaks existing Phase 0 cards
**What goes wrong:** After adding `spec_version: z.literal('1.0')` to the schema, existing cards stored in SQLite fail Zod validation on read.
**Why it happens:** Phase 0 cards were stored without `spec_version`.
**How to avoid:** Use `.default('1.0')` so the field is optional on input and always present on output. Run a one-time migration in `agentbnb init` / `agentbnb publish` that adds `spec_version` to legacy cards.
**Warning signs:** `discover` command returns 0 results after schema update.

---

## Code Examples

### bonjour-service: Publish + Browse

```typescript
// Source: https://www.npmjs.com/package/bonjour-service
import { Bonjour } from 'bonjour-service';

const bonjour = new Bonjour();

// Publish — call this in `agentbnb serve`
export function announceGateway(owner: string, port: number): void {
  bonjour.publish({ name: owner, type: 'agentbnb', port });
}

// Browse — call this in `agentbnb discover --local`
export function discoverLocalAgents(
  onFound: (name: string, url: string) => void
): void {
  bonjour.find({ type: 'agentbnb' }, (service) => {
    const host = service.addresses?.[0] ?? service.host;
    onFound(service.name, `http://${host}:${service.port}`);
  });
}

// Cleanup — always call on process exit
export function stopAnnouncement(): Promise<void> {
  return new Promise((resolve) => {
    bonjour.unpublishAll(() => { bonjour.destroy(); resolve(); });
  });
}
```

### package.json: npm publish configuration

```jsonc
{
  "name": "agentbnb",
  "version": "1.0.0",
  "description": "P2P Agent Capability Sharing Protocol",
  "type": "module",
  "bin": { "agentbnb": "dist/cli/index.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup src/index.ts src/cli/index.ts --format esm --dts",
    "prepublishOnly": "pnpm run build && pnpm run typecheck && pnpm run test:run"
  },
  "engines": { "node": ">=20.0.0" }
}
```

### Capability Card v1.0 schema addition

```typescript
// src/types/index.ts — add spec_version as first field
export const CapabilityCardSchema = z.object({
  spec_version: z.literal('1.0').default('1.0'),
  id: z.string().uuid(),
  owner: z.string().min(1),
  // ... all existing fields unchanged ...
});
```

### `connect` command stub

```typescript
// In src/cli/index.ts — new command
program
  .command('connect <name> <url> <token>')
  .description('Register a remote agent peer for capability requests')
  .option('--json', 'Output as JSON')
  .action(async (name: string, url: string, token: string, opts) => {
    const config = loadConfig();
    if (!config) { console.error('Run `agentbnb init` first.'); process.exit(1); }
    savePeer({ name, url, token, added_at: new Date().toISOString() });
    // ...
  });
```

### `init` with LAN IP detection

```typescript
import { networkInterfaces } from 'node:os';

function getLanIp(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Use in init: gateway_url: `http://${getLanIp()}:${port}`
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `bonjour` (npm) | `bonjour-service` | ~2022 | bonjour went unmaintained; bonjour-service is its TypeScript rewrite with 8.2M weekly downloads |
| `mdns` (native) | `bonjour-service` (pure JS) | Ongoing | Eliminates native build requirement on Linux/Windows |
| Manual npm publish checklist | `npx publint` validation | 2023+ | Catches exports config errors before publish |
| `"type": "module"` + CJS compat shims | Pure ESM for Node 20+ | 2024 | Project already ESM; Node 20+ makes CJS compat unnecessary for a CLI |
| node:sqlite (Node 22.5+) | better-sqlite3 | Future (Phase 2) | When project bumps minimum to Node 22, can drop native dep entirely |

**Deprecated/outdated:**
- `bonjour` (npm): last published 2021, use `bonjour-service` instead.
- `mdns` (npm): requires native build tools (libavahi on Linux, Bonjour SDK on Windows) — not suitable for frictionless `npx` distribution.
- OpenSpec as "runtime API contract format": the phase description references OpenSpec but research confirms it is a development workflow tool (SDD process), not an API specification format like OpenAPI/Swagger.

---

## Open Questions

1. **OpenSpec "integration" interpretation**
   - What we know: OpenSpec is a spec-driven development (SDD) CLI workflow tool, not a runtime API contract format. v1.2.0 released Feb 2026.
   - What's unclear: The ROADMAP says "OpenSpec integration for stable API specs" — this likely means adopting the OpenSpec SDD process to author Phase 1's spec artifacts (using `/opsx:propose` and `/opsx:apply` commands), not adding a code dependency.
   - Recommendation: Treat as "author Phase 1 specs using OpenSpec format" — pure process change, zero code impact. Confirm with Cheng Wen before planning.

2. **Relay server scope**
   - What we know: mDNS is LAN-only. Cross-network agent communication requires a known URL or relay.
   - What's unclear: Is a relay server in scope for Phase 1, or is `agentbnb connect <url> <token>` (manual registration) sufficient?
   - Recommendation: The `connect` command covers the cross-network case with zero server infrastructure. A relay server is Phase 2 scope. Plan only `connect` for Phase 1.

3. **better-sqlite3 version**
   - What we know: Project currently uses v11.6.0; latest is v12.6.2. Prebuilt binaries for Node 24 had issues in mid-2025 but Node 20 LTS is stable.
   - What's unclear: Whether v12 has any breaking changes vs v11 for the existing codebase.
   - Recommendation: Upgrade to v12 (latest) before npm publish for the broadest prebuilt binary coverage. Add as a task in the first plan.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.0 |
| Config file | None — configured via `package.json` (vitest defaults) |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R-007 | `npx agentbnb init` works on clean install; `pnpm build` produces valid dist | smoke | `pnpm build && node dist/cli/index.js --version` | ❌ Wave 0 |
| R-008 | `spec_version: '1.0'` field validates correctly; legacy cards without field still parse | unit | `pnpm test:run -- src/types/index.test.ts` | Partial (extend existing) |
| R-009 | mDNS announces service; browser finds it on same process (loopback) | unit | `pnpm test:run -- src/discovery/mdns.test.ts` | ❌ Wave 0 |
| R-010 | `agentbnb connect` stores peer; `agentbnb request` uses stored peer URL+token | integration | `pnpm test:run -- src/cli/index.test.ts` | ❌ Wave 0 |
| R-011 | OpenSpec process adoption | manual-only | N/A — process change, no automated test | N/A |
| R-012 | `examples/agent-a` + `examples/agent-b` scripts run without error | smoke | `bash examples/agent-b/demo.sh` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run && pnpm typecheck`
- **Phase gate:** Full suite green + `pnpm build` succeeds before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/discovery/mdns.test.ts` — covers R-009 mDNS announce/browse
- [ ] `src/discovery/mdns.ts` — implementation file (new module)
- [ ] `src/cli/index.test.ts` — extend existing or create for R-010 connect command
- [ ] `examples/agent-a/card.json` — example capability card
- [ ] `examples/agent-b/demo.sh` — two-agent demo script
- [ ] `README.md` — covers R-012 documentation

---

## Sources

### Primary (HIGH confidence)
- Current codebase: `src/types/index.ts`, `src/gateway/auth.ts`, `src/cli/config.ts`, `src/cli/index.ts`, `package.json` — architecture baseline
- bonjour-service npm registry — 8.2M weekly downloads, TypeScript, pure JS confirmed
- better-sqlite3 GitHub #1367 — native binary distribution challenges, confirmed prebuilt strategy
- [OpenSpec GitHub](https://github.com/Fission-AI/OpenSpec) — confirmed SDD workflow tool, not API contract format; v1.2.0

### Secondary (MEDIUM confidence)
- [tsup ESM CLI distribution 2025](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing) — ESM/CJS packaging guidance
- [lekoarts.de CLI testing pattern](https://www.lekoarts.de/how-to-test-cli-output-in-jest-vitest/) — Vitest + execa CLI test pattern
- [A2A Protocol Agent Card spec](https://a2a-protocol.org/latest/specification/) — context for where AgentBnB's Capability Card fits in the broader ecosystem
- [npm publish best practices 2025](https://snyk.io/blog/best-practices-create-modern-npm-package/) — `files` field, `prepublishOnly`, `publint`

### Tertiary (LOW confidence)
- mDNS cross-platform pitfalls (VPN, Docker) — from multiple WebSearch results; verify with actual testing on target platforms

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing codebase confirmed; bonjour-service download count verified
- Architecture: HIGH — patterns build directly on Phase 0 foundation
- Native binary pitfall: HIGH — confirmed by GitHub issue + Anthropic Claude Code's own experience
- mDNS cross-platform: MEDIUM — general knowledge confirmed by multiple sources, not platform-tested
- OpenSpec intent: LOW — interpretation based on research; needs Cheng Wen confirmation

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days — stable domain, but verify bonjour-service version before install)
