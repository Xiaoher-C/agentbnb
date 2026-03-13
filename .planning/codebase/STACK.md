# Technology Stack

**Analysis Date:** 2026-03-13

## Languages

**Primary:**
- TypeScript 5.7.0 - All application code, CLI, type definitions, and tests

**Secondary:**
- JavaScript - Generated output from TypeScript compilation (ESM modules)

## Runtime

**Environment:**
- Node.js 20+ (as per `engines.node` in `package.json`)

**Package Manager:**
- pnpm (referenced in CLAUDE.md as primary package manager)
- Lockfile: Not yet created (early stage project)

## Frameworks

**Core:**
- Fastify 5.1.0 - HTTP server for agent-to-agent gateway communication (dependency in `package.json`)
- Commander 12.1.0 - CLI argument parsing and command structure (`src/cli/index.ts`)

**Validation:**
- Zod 3.24.0 - Runtime schema validation for Capability Cards (`src/types/index.ts`)

**Database:**
- better-sqlite3 11.6.0 - Local SQLite registry for Capability Card storage (planned architecture)

**Testing:**
- Vitest 2.1.0 - Test runner and assertion framework
- Run commands: `pnpm test` (watch mode), `pnpm test:run` (single run)

**Build/Dev:**
- tsup 8.3.0 - TypeScript bundler for building ESM output (`pnpm build` compiles to `dist/`)
- tsx 4.19.0 - TypeScript execution with watch mode (`pnpm dev` for CLI development)
- ESLint 9.0.0 - Code linting (configured but not yet with explicit rules)
- Prettier 3.4.0 - Code formatting (3.4.0 version)

## Key Dependencies

**Critical:**
- `zod` 3.24.0 - Validates all Capability Card structures; core to registry validation
- `better-sqlite3` 11.6.0 - Local database for storing and querying Capability Cards
- `fastify` 5.1.0 - Powers the gateway server for agent-to-agent communication

**Infrastructure:**
- `commander` 12.1.0 - CLI interface for publish, discover, request, status, serve commands

## Configuration

**Environment:**
- `.env` and `.env.local` files supported (listed in `.gitignore`)
- No required environment variables detected yet in codebase
- Configuration pattern: planned but not yet implemented

**Build:**
- `tsconfig.json` - Strict TypeScript compilation targeting ES2022, ESNext modules
  - Output directory: `dist/`
  - Source directory: `src/`
  - Strict mode enabled with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
  - Source maps and declaration files generated
- `tsup` bundled to ES modules with declaration files

**Package Entry Points:**
- Main: `dist/index.js` (from `package.json`)
- Types: `dist/index.d.ts`
- CLI bin: `dist/cli/index.js` (executable as `agentbnb` command)

## Platform Requirements

**Development:**
- Node.js 20 or higher
- pnpm package manager
- TypeScript strict mode compliance (no `any` types, narrow via `unknown`)

**Production:**
- Node.js 20+
- Deployment target: Not yet specified (Phase 0 is local dogfood only)
- Database: SQLite file (local or persisted volume)
- Port: Gateway listens on port 7700 (hardcoded in CLI stub, `src/cli/index.ts`)

## Module System

**Type:** ES Modules (`"type": "module"` in `package.json`)

**Exports:**
- Main export: `CapabilityCardSchema` and `CapabilityCard` type from `src/types/index.ts`
- CLI: Standalone executable via `agentbnb` bin command

---

*Stack analysis: 2026-03-13*
