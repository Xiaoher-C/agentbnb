# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- Kebab-case for TypeScript files (e.g., `capability-card.ts`, `index.ts`)
- CLI entry point: `src/cli/index.ts`
- Core exports: `src/index.ts`
- Test files: co-located with implementation as `*.test.ts` (e.g., `src/types/index.test.ts`)

**Functions:**
- camelCase for all function and method names
- Use verb-first naming for functions that perform actions (e.g., `safeParse`, `parse`)
- Private helper functions follow the same camelCase pattern

**Variables:**
- camelCase for all variables and parameters
- Snake_case for object properties that represent database/schema fields (e.g., `credits_per_call`, `avg_latency_ms`, `created_at`)
- Const declarations preferred over let/var where possible

**Types:**
- PascalCase for type names, interfaces, and type aliases
- Use `z.object()` patterns with Zod schemas (e.g., `CapabilityCardSchema`)
- Export both schema and inferred type: `export const CapabilityCardSchema = z.object(...)` and `export type CapabilityCard = z.infer<typeof CapabilityCardSchema>`
- Custom error classes: PascalCase extending `AgentBnBError` (e.g., `CapabilityNotFoundError`)

## Code Style

**Formatting:**
- Tool: Prettier 3.4.0 (configured in dependencies, no config file present — uses defaults)
- Default Prettier settings apply: 80 character line width, 2-space indentation, single quotes in TypeScript
- ESM modules: `"type": "module"` in `package.json`, use `import`/`export` syntax
- File imports: Include `.js` extension in relative imports (e.g., `from './types/index.js'`)

**Linting:**
- Tool: ESLint 9.0.0 (configured in dependencies, no config file present)
- TypeScript strict mode enabled via `tsconfig.json`: `"strict": true`
- Additional strict checks: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`
- Target: ES2022

## Import Organization

**Order:**
1. External packages (e.g., `import { z } from 'zod'`)
2. Node.js built-ins (e.g., `import { randomUUID } from 'crypto'`)
3. Local imports (e.g., `from './types/index.js'`)

**Path Aliases:**
- No path aliases configured in `tsconfig.json`
- Use relative imports or absolute paths from `src/`

## Error Handling

**Patterns:**
- All custom errors extend the base `AgentBnBError` class from `src/types/index.ts`
- `AgentBnBError` constructor takes `message: string` and `code: string` for categorization
- Use Zod schema `.safeParse()` for validation that should succeed (returns `{ success: boolean, data?, error? }`)
- Assertions with `.parse()` only in contexts where invalid data is a programming error
- Do not use `try/catch` for validation; use `.safeParse()` and check `.success`

**Example:**
```typescript
export class AgentBnBError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AgentBnBError';
  }
}
```

## Logging

**Framework:** Node.js `console` object (no external logging library)

**Patterns:**
- Use `console.log()` for standard output
- CLI output includes Unicode emojis for visual clarity (e.g., `🏠`, `📋`, `🔍`, `💰`, `🚀`)
- Emojis used as visual identifiers for command feedback in CLI (`src/cli/index.ts`)
- No structured logging or log levels implemented yet

## Comments

**When to Comment:**
- JSDoc comments on exported functions and types (required for public API)
- JSDoc format: `/** comment */` on the line(s) before declaration
- Type/interface JSDoc should explain business purpose, not just structure

**JSDoc/TSDoc:**
- Format: Standard TSDoc format with `/**` blocks
- Examples from codebase:
  ```typescript
  /**
   * Capability Card — the core unit of AgentBnB
   *
   * Level 1 (Atomic): Single API capability (e.g. ElevenLabs TTS)
   * Level 2 (Pipeline): Multiple Atomics chained (e.g. text → voice → video)
   * Level 3 (Environment): Full deployment with all dependencies
   */
  export const CapabilityCardSchema = z.object(...)
  ```
- Always include module-level comments in entry point files

## Function Design

**Size:** Keep functions focused and single-purpose. Zod schema validation functions are typically 5-30 lines.

**Parameters:**
- Use destructuring for object parameters
- Required parameters come before optional ones
- Use type annotations for all parameters

**Return Values:**
- All async functions use `async/await` syntax exclusively (no raw Promises)
- Zod validation functions return `z.ZodType` objects
- CLI commands return `void` (execute side effects via `console.log()`)

## Module Design

**Exports:**
- Named exports preferred for types, schemas, and classes
- Each module exports what it provides: schemas, types, error classes
- Example from `src/types/index.ts`: exports both schema and inferred type

**Barrel Files:**
- `src/index.ts` re-exports core public API: types and schemas
- Usage: `export { CapabilityCardSchema, type CapabilityCard } from './types/index.js'`

---

*Convention analysis: 2026-03-13*
