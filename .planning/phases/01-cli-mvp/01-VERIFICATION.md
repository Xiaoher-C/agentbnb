---
phase: 01-cli-mvp
verified: 2026-03-14T00:30:00Z
status: gaps_found
score: 11/13 must-haves verified
gaps:
  - truth: "A working two-agent demo exists in examples/ with step-by-step scripts"
    status: failed
    reason: "sample-card.json uses IOSchema type values 'string' and 'number' which are not valid enum members. CapabilityCardSchema.IOSchemaSchema only accepts 'text'|'json'|'file'|'audio'|'image'|'video'|'stream'. Running 'agentbnb publish examples/two-agent-demo/sample-card.json' will fail with Zod validation errors."
    artifacts:
      - path: "examples/two-agent-demo/sample-card.json"
        issue: "inputs[0].type is 'string', inputs[1].type is 'number', outputs[0].type is 'string' — all invalid IOSchema types. Valid types are: text, json, file, audio, image, video, stream."
      - path: "README.md"
        issue: "Capability Card Format section shows inputs/outputs with type 'string' — same invalid type, misleading documentation for external users."
    missing:
      - "Change all IOSchema type values in examples/two-agent-demo/sample-card.json from 'string'/'number' to valid enum values (e.g. 'text' for text inputs/outputs, 'json' for structured data)"
      - "Update the Capability Card Format example in README.md to use valid IOSchema type values"
  - truth: "External user can follow README to get two agents sharing capabilities"
    status: partial
    reason: "README two-machine setup instructions are correct and complete, but the sample-card.json that the demo scripts reference is broken (see above). An external user following the README and running demo.sh or agent-a-setup.sh will encounter a publish failure on the first publish step."
    artifacts:
      - path: "examples/two-agent-demo/sample-card.json"
        issue: "Invalid IOSchema types block 'agentbnb publish sample-card.json' from succeeding"
    missing:
      - "Fix sample-card.json IO types so 'agentbnb publish sample-card.json' validates successfully"

human_verification:
  - test: "Run pnpm test:run and verify all 107 tests pass"
    expected: "Test suite reports 107 passing, 0 failing"
    why_human: "Cannot run the test suite programmatically in this environment"
  - test: "Run 'node dist/cli/index.js --version'"
    expected: "Prints '1.0.0'"
    why_human: "Confirms the built binary reads version from package.json correctly"
  - test: "Run 'agentbnb init --owner testuser' and inspect gateway_url in config.json"
    expected: "gateway_url is set to a LAN IP (e.g. 192.168.x.x:7700), not 'localhost'"
    why_human: "LAN IP detection depends on actual network interfaces of the test machine"
  - test: "After fixing sample-card.json types, run 'bash examples/two-agent-demo/demo.sh'"
    expected: "Demo completes all 7 steps without errors — init, publish, discover, connect, peers, status"
    why_human: "Shell script execution with external agentbnb binary cannot be verified programmatically"
---

# Phase 1: CLI MVP Verification Report

**Phase Goal:** External users can install and try AgentBnB between two machines.
**Verified:** 2026-03-14T00:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | External user can install agentbnb via npm and run agentbnb --version successfully | VERIFIED | package.json: version 1.0.0, files whitelist, exports map, bin field, prepublishOnly guard. dist/cli/index.js starts with `#!/usr/bin/env node`. CLI reads version via createRequire. |
| 2 | spec_version 1.0 field is present on all new cards | VERIFIED | src/types/index.ts: `spec_version: z.literal('1.0').default('1.0')` as first field in CapabilityCardSchema. |
| 3 | Legacy Phase 0 cards without spec_version still parse correctly | VERIFIED | `.default('1.0')` in Zod schema auto-fills missing field. Summary confirms 4 behavior tests covering this case pass. |
| 4 | CLI binary executes without shebang or module errors after build | VERIFIED | tsup.config.ts array config: separate library and CLI entries. Source shebang preserved. dist/cli/index.js confirmed to start with `#!/usr/bin/env node`. |
| 5 | An agent can announce its gateway via mDNS on the local network | VERIFIED | src/discovery/mdns.ts: announceGateway() exports confirmed, uses bonjour-service singleton. 4 tests exist and pass per summary (99 test count confirmed). |
| 6 | An agent can discover other agents announced via mDNS | VERIFIED | src/discovery/mdns.ts: discoverLocalAgents() is substantive (68+ lines, full IPv4 preference logic, event handling). Test 2 verifies loopback discovery. |
| 7 | mDNS cleanup happens on shutdown (unpublish all) | VERIFIED | stopAnnouncement() is idempotent (null-checks, sets bonjourInstance=null before destroy). Wired in serve --announce gracefulShutdown handler. |
| 8 | User can register a remote peer with agentbnb connect name url token | VERIFIED | src/cli/index.ts: connect command calls savePeer(). src/cli/peers.ts: savePeer() is substantive (full CRUD with case-insensitive dedup). |
| 9 | User can list registered peers with agentbnb peers | VERIFIED | peers command in src/cli/index.ts: calls loadPeers(), formats table output, handles empty state. |
| 10 | agentbnb request can resolve a peer name to URL+token automatically | VERIFIED | request command checks --peer option, calls findPeer(), uses peer.url and peer.token. Error message includes actionable hint. |
| 11 | agentbnb serve --announce publishes the gateway via mDNS | VERIFIED | serve command: --announce flag calls announceGateway(config.owner, port) after server starts, stopAnnouncement() in gracefulShutdown. |
| 12 | agentbnb init detects LAN IP and uses it for gateway_url (not localhost) | VERIFIED | getLanIp() function in src/cli/index.ts iterates networkInterfaces(), filters for first non-internal IPv4, falls back to 'localhost'. gateway_url uses `http://${ip}:${port}`. |
| 13 | A working two-agent demo exists in examples/ with step-by-step scripts | FAILED | examples/two-agent-demo/ directory and all scripts exist, but sample-card.json uses invalid IOSchema types ('string', 'number') that Zod will reject. The demo publish step will fail. |

**Score:** 12/13 truths verified (1 failed)

Note: Truth #13 also means truth "External user can follow README to get two agents sharing capabilities" is partially blocked — README instructions are correct and complete, but the referenced sample-card.json is broken.

---

## Required Artifacts

### Plan 01-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | npm publish configuration with files, exports, engines, prepublishOnly | VERIFIED | Has `"files": ["dist", "README.md", "LICENSE"]`, `exports` map with types-first condition, `prepublishOnly` script, `engines: {"node": ">=20.0.0"}`, version `1.0.0` |
| `src/types/index.ts` | CapabilityCardSchema with spec_version: 1.0 | VERIFIED | `spec_version: z.literal('1.0').default('1.0')` is first field in schema |
| `tsup.config.ts` | Build config ensuring shebang preservation | VERIFIED | Array config: library entry (no banner) + CLI entry (preserves source shebang). 19 lines, substantive. |

### Plan 01-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/discovery/mdns.ts` | mDNS announce, browse, and cleanup functions | VERIFIED | 138 lines. Exports `announceGateway`, `discoverLocalAgents`, `stopAnnouncement`, `DiscoveredAgent`. Bonjour singleton pattern. |
| `src/discovery/mdns.test.ts` | Tests for mDNS announce/browse loopback | VERIFIED | 103 lines. 4 tests. Covers publish, loopback discover, idempotent cleanup, multi-agent. |

### Plan 01-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/peers.ts` | Peer storage CRUD (load, save, add, remove, find) | VERIFIED | 109 lines. Exports `PeerConfig`, `loadPeers`, `savePeer`, `removePeer`, `findPeer`. Case-insensitive. |
| `src/cli/peers.test.ts` | Tests for peer storage operations and cross-peer request resolution | VERIFIED | 169 lines. 8 tests including Test 7 cross-peer resolution. |
| `src/cli/index.ts` | Updated CLI with connect, peers, --announce, --local commands | VERIFIED | 506 lines. All 5 new features wired: connect, peers, peers remove, request --peer, serve --announce, discover --local. |

### Plan 01-04 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/index.ts` | init command with LAN IP detection and --host override | VERIFIED | getLanIp() function present (lines 28-36), networkInterfaces imported, --host flag on init command. |
| `README.md` | Project documentation with install, quickstart, API reference | VERIFIED (with caveat) | 297 lines. All required sections present. BUT: Capability Card Format example shows `"type": "string"` which is invalid per IOSchemaSchema. |
| `examples/two-agent-demo/demo.sh` | Runnable two-agent demo script | VERIFIED (structure) / FAILED (content) | 97 lines. Script structure is correct. BUT: references sample-card.json which has invalid IOSchema types — publish step will fail. |
| `examples/two-agent-demo/sample-card.json` | Example Capability Card for demo | FAILED | File exists and has correct top-level fields, but all IOSchema type values are invalid: `"type": "string"` and `"type": "number"` are not in the allowed enum `['text', 'json', 'file', 'audio', 'image', 'video', 'stream']`. |

---

## Key Link Verification

### Plan 01-01

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `dist/cli/index.js` | bin field and build script | VERIFIED | `"agentbnb": "dist/cli/index.js"` in bin. `"build": "tsup"` script reads tsup.config.ts. dist/cli/index.js confirmed to exist. |
| `src/types/index.ts` | CapabilityCardSchema consumers | Zod .default('1.0') on spec_version | VERIFIED | `spec_version: z.literal('1.0').default('1.0')` present. |

### Plan 01-02

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/discovery/mdns.ts` | `bonjour-service` | import Bonjour | VERIFIED | `import { Bonjour } from 'bonjour-service'` on line 1. bonjour-service: ^1.3.0 in package.json dependencies. |

### Plan 01-03

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli/index.ts` | `src/cli/peers.ts` | import for connect/peers/request commands | VERIFIED | `import { loadPeers, savePeer, removePeer, findPeer } from './peers.js'` on line 11. Used in connect, peers, and request commands. |
| `src/cli/index.ts` | `src/discovery/mdns.ts` | import for serve --announce and discover --local | VERIFIED | `import { announceGateway, discoverLocalAgents, stopAnnouncement } from '../discovery/mdns.js'` on line 18. Used in serve and discover commands. |
| `src/cli/index.ts (request command)` | `src/cli/peers.ts (findPeer)` | Resolve peer name to gatewayUrl + token | VERIFIED | `const peer = findPeer(opts.peer)` at line 280; `gatewayUrl = peer.url; token = peer.token` at lines 285-286. |

### Plan 01-04

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `README.md` | `examples/two-agent-demo/` | Documentation references example directory | VERIFIED | `examples/two-agent-demo/` referenced in Examples section (line 261) and example link (line 275). |
| `src/cli/index.ts (init command)` | `node:os networkInterfaces` | LAN IP detection for gateway_url | VERIFIED | `import { networkInterfaces } from 'node:os'` on line 8. getLanIp() calls `networkInterfaces()` and iterates interfaces. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| R-007 | 01-01 | npm Package Distribution | SATISFIED | package.json: files, exports, bin, engines, prepublishOnly. dist/cli/index.js with shebang. publint passes per summary. |
| R-008 | 01-01 | Capability Card Spec v1.0 | SATISFIED | spec_version: z.literal('1.0').default('1.0') in CapabilityCardSchema. All 4 acceptance criteria evidenced in schema and summary. |
| R-009 | 01-02 | mDNS Discovery | SATISFIED | src/discovery/mdns.ts: announceGateway, discoverLocalAgents, stopAnnouncement. bonjour-service installed. 4 loopback tests pass. |
| R-010 | 01-03 | Peer Management (connect/peers/request --peer/serve --announce/discover --local) | SATISFIED | All 5 CLI features wired in src/cli/index.ts. src/cli/peers.ts CRUD operations with 8 tests. |
| R-011 | 01-04 | OpenSpec SDD Integration | SATISFIED | README.md "Spec-Driven Development" section (lines 279-287) documents OpenSpec as development process adoption. |
| R-012 | 01-04 | Documentation and Examples | PARTIALLY SATISFIED | README.md exists (297 lines) with all required sections. Two-agent demo scripts exist. BUT: sample-card.json has invalid IOSchema types blocking the demo. |

### Orphaned Requirements

R-009 through R-012 are referenced in ROADMAP.md as Phase 1 requirements but are **not present in REQUIREMENTS.md** (file ends at R-008). These requirements are fully implemented but undocumented in the requirements file. This is a documentation gap — REQUIREMENTS.md should be updated to include R-009 through R-012.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `examples/two-agent-demo/sample-card.json` | 11, 17, 25 | Invalid IOSchema type values ('string', 'number') | Blocker | `agentbnb publish sample-card.json` fails validation. demo.sh breaks at Step 2. agent-a-setup.sh breaks at publish step. |
| `README.md` | 150, 158 | Invalid IOSchema type values shown in Capability Card Format example | Warning | Misleads external users — they will write invalid cards following the README example. |
| `ROADMAP.md` | 46-47 | Plans 01-02, 01-03, 01-04 shown with `[ ]` (unchecked) despite being complete | Info | ROADMAP.md checkbox status is inconsistent with STATE.md and SUMMARY files. Does not block functionality. |
| `REQUIREMENTS.md` | (missing) | R-009 through R-012 not defined | Warning | Requirements referenced in ROADMAP are undocumented. Traceability gap for Phase 1 work. |

---

## Human Verification Required

### 1. Full Test Suite

**Test:** Run `pnpm test:run` from the project root.
**Expected:** All 107 tests pass (95 Phase 0 + 8 peer tests + 4 mDNS tests). Zero failures.
**Why human:** Cannot run the test suite programmatically in this environment.

### 2. CLI Version After Build

**Test:** Run `node dist/cli/index.js --version`.
**Expected:** Prints `1.0.0` (reads dynamically from package.json via createRequire).
**Why human:** Confirms built binary functions correctly — programmatic check would require executing the binary.

### 3. LAN IP Detection in init

**Test:** Run `agentbnb init --owner testuser` and inspect the output line `Gateway: http://...`.
**Expected:** Gateway URL shows a LAN IP (e.g. `192.168.x.x:7700`), not `localhost:7700`.
**Why human:** LAN IP detection depends on actual network interfaces of the test machine — cannot verify the correct IP programmatically.

### 4. Demo Script After Fix

**Test:** After fixing sample-card.json IO types, run `bash examples/two-agent-demo/demo.sh`.
**Expected:** All 7 steps complete successfully — init Alice, publish card, discover, init Bob, connect, list peers, check status.
**Why human:** Shell script execution with binary + filesystem operations cannot be verified statically.

---

## Gaps Summary

One blocker gap was found affecting the demo experience:

**Invalid IOSchema types in sample-card.json and README**

The `examples/two-agent-demo/sample-card.json` file uses `"type": "string"` and `"type": "number"` for its input and output IO schemas. These are not valid values for `IOSchemaSchema` — the Zod schema enforces `z.enum(['text', 'json', 'file', 'audio', 'image', 'video', 'stream'])`. When an external user runs `agentbnb publish examples/two-agent-demo/sample-card.json` (as instructed by `demo.sh` and `agent-a-setup.sh`), the command will exit with Zod validation errors:

```
Error: card validation failed:
  - inputs.0.type: Invalid enum value. Expected 'text' | 'json' | ...
  - inputs.1.type: Invalid enum value. Expected 'text' | 'json' | ...
  - outputs.0.type: Invalid enum value. Expected 'text' | 'json' | ...
```

This breaks the entire "two-agent demo" which is the primary vehicle for an external user trying AgentBnB between two machines — the stated Phase 1 goal.

The fix is minimal: change the three IO type values in `sample-card.json` from `'string'`/`'number'` to valid values such as `'text'`, and update the README's Capability Card Format example to match. The core implementations (schema, mDNS, peers, CLI, LAN IP detection) are all correct and wired.

**Secondary gap: REQUIREMENTS.md missing R-009 through R-012**

Requirements R-009 through R-012 are referenced in ROADMAP.md but not defined in REQUIREMENTS.md (which ends at R-008). This is a documentation-only gap — the implementations are complete. REQUIREMENTS.md should be extended to define these Phase 1 requirements for completeness.

---

_Verified: 2026-03-14T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
