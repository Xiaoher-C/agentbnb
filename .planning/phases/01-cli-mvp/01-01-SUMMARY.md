---
phase: 01-cli-mvp
plan: 01
subsystem: api
tags: [zod, tsup, npm, cli, typescript, schema]

# Dependency graph
requires:
  - phase: 00-dogfood
    provides: CapabilityCardSchema, package.json baseline, CLI entry point in src/cli/index.ts
provides:
  - CapabilityCard schema frozen at v1.0 with spec_version field (Zod literal + default)
  - package.json configured for npm publish (files, exports, prepublishOnly, version 1.0.0)
  - tsup.config.ts with separate library/CLI build entries
  - CLI binary reads version from package.json (no hardcoded string)
affects: [02-mdns, 03-api-keys, 04-interactive-cli, npm-publish]

# Tech tracking
tech-stack:
  added: [tsup.config.ts (separate entry config), publint (validation)]
  patterns:
    - Zod literal + default for schema version fields — backward compat without migrations
    - tsup array config for separate library/CLI build entries to isolate shebang
    - createRequire for reading package.json version in ESM CLI

key-files:
  created:
    - tsup.config.ts
  modified:
    - src/types/index.ts
    - src/types/index.test.ts
    - src/cli/index.ts
    - package.json

key-decisions:
  - "tsup array config (two entries) isolates shebang banner to CLI entry only — single entry config applies banner to all outputs including shared chunks"
  - "createRequire used to import package.json in ESM CLI — resolveJsonModule already enabled in tsconfig"
  - "exports types condition placed first per publint requirement — conditions are order-sensitive for TypeScript resolution"

patterns-established:
  - "Schema versioning pattern: z.literal('X.Y').default('X.Y') — reject future versions, auto-fill missing on legacy records"
  - "tsup array config pattern for monorepo-style entries within single package"

requirements-completed: [R-007, R-008]

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 1 Plan 01: npm Package Distribution Foundation Summary

**CapabilityCard schema frozen at v1.0 with Zod literal+default spec_version, package.json prepared for npm publish with tsup-based build pipeline producing clean CLI and library dist entries**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T23:45:00Z
- **Completed:** 2026-03-13T23:53:00Z
- **Tasks:** 2 (Task 1: TDD schema, Task 2: package config)
- **Files modified:** 5

## Accomplishments
- Added `spec_version: z.literal('1.0').default('1.0')` as first field in CapabilityCardSchema — legacy Phase 0 cards without the field parse correctly via Zod default
- Configured package.json for npm distribution: version 1.0.0, files whitelist, exports map, prepublishOnly guard script
- Created tsup.config.ts with array config to separate library and CLI build entries — CLI gets shebang, library does not
- Updated CLI to dynamically read version from package.json via createRequire
- All 99 tests pass (95 Phase 0 + 4 new spec_version behavior tests), publint reports "All good!"

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: spec_version failing tests** - `1c1e036` (test)
2. **Task 1 GREEN: freeze schema at v1.0** - `f54e14f` (feat)
3. **Task 2: package.json + build pipeline** - `2b0cb3d` (feat)

_Note: Task 1 was TDD — separate test (RED) and implementation (GREEN) commits._

## Files Created/Modified
- `src/types/index.ts` — Added spec_version field as first field in CapabilityCardSchema
- `src/types/index.test.ts` — Added 4 spec_version behavior tests
- `src/cli/index.ts` — Updated version to read from package.json via createRequire
- `package.json` — Bumped to 1.0.0, added files/exports/prepublishOnly, build script now uses tsup
- `tsup.config.ts` — Created: array config with library entry (no shebang) and CLI entry (no extra banner, source shebang preserved)

## Decisions Made
- **tsup array config**: Single entry with `banner: { js: '#!/usr/bin/env node' }` applied the shebang to all outputs including shared chunks, causing `SyntaxError: Invalid or unexpected token` at runtime. Split into two entries — library entry (no banner) and CLI entry (no banner needed as source has shebang). This avoids double-shebang issue.
- **createRequire for package.json**: ESM CLI can't use `import pkg from '../../package.json'` with dynamic resolution; `createRequire(import.meta.url)` is the idiomatic ESM approach.
- **exports types first**: publint requires `types` condition before `import` in exports map for correct TypeScript resolution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed double-shebang caused by tsup universal banner**
- **Found during:** Task 2 (build pipeline configuration)
- **Issue:** tsup's `banner: { js: '#!/usr/bin/env node' }` applied shebang to all entries including shared chunks. Source file already had `#!/usr/bin/env node`. Result: `dist/cli/index.js` had two shebangs, causing `SyntaxError: Invalid or unexpected token`
- **Fix:** Removed banner from tsup config entirely. Split into array config with separate library and CLI entries. Source file's own shebang is preserved by tsup, producing single clean shebang in CLI output.
- **Files modified:** tsup.config.ts
- **Verification:** `head -1 dist/cli/index.js` shows single `#!/usr/bin/env node`, `node dist/cli/index.js --version` prints `1.0.0`
- **Committed in:** 2b0cb3d (Task 2 commit)

**2. [Rule 1 - Bug] Fixed exports map condition order for publint**
- **Found during:** Task 2 (publint validation)
- **Issue:** publint reported: "pkg.exports['.'].types should be the first in the object as conditions are order-sensitive"
- **Fix:** Moved `types` condition before `import` in the exports map
- **Files modified:** package.json
- **Verification:** `npx publint` reports "All good!"
- **Committed in:** 2b0cb3d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs — both discovered during Task 2 build verification)
**Impact on plan:** Both fixes essential for correct CLI operation and package validity. No scope creep.

## Issues Encountered
- Initial `pnpm build` with inline tsup args produced stale `dist/` that showed `0.0.1` — fixed by doing a clean rebuild after tsup.config.ts was in place.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Package is ready for npm publish (`npx publint` passes, `prepublishOnly` guard in place)
- CapabilityCard schema is stable at v1.0 — all downstream code can rely on `spec_version` being present
- Build pipeline produces clean `dist/` with proper CLI shebang and library types

---
*Phase: 01-cli-mvp*
*Completed: 2026-03-13*
