# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Runner:**
- Vitest 2.1.0
- Config: Not explicitly configured (uses Vitest defaults)

**Assertion Library:**
- Vitest built-in `expect()` API (compatible with Jest syntax)

**Run Commands:**
```bash
pnpm test              # Run all tests in watch mode
pnpm test:run          # Run tests once and exit
pnpm typecheck         # Type checking with TypeScript (tsc --noEmit)
pnpm lint              # Lint with ESLint
```

## Test File Organization

**Location:**
- Co-located with implementation files in same directory
- Test files are excluded from build output in `tsconfig.json` exclude array: `**/*.test.ts`

**Naming:**
- Pattern: `[moduleName].test.ts`
- Example: `src/types/index.test.ts` tests `src/types/index.ts`

**Structure:**
```
src/
├── types/
│   ├── index.ts           # Implementation
│   └── index.test.ts      # Tests
├── cli/
│   └── index.ts           # Implementation (no tests yet)
└── index.ts               # Barrel export (no tests yet)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { CapabilityCardSchema } from './index.js';

describe('CapabilityCardSchema', () => {
  const validCard = {
    // Shared test fixture data
  };

  it('validates a correct L1 Atomic card', () => {
    const result = CapabilityCardSchema.safeParse(validCard);
    expect(result.success).toBe(true);
  });

  it('rejects a card without owner', () => {
    const bad = { ...validCard, owner: '' };
    const result = CapabilityCardSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
```

**Patterns:**
- Use `describe()` blocks for grouping related tests by schema/module
- Each `it()` block tests a single validation rule or behavior
- Fixture data declared outside `it()` blocks and mutated with spread operators (`{ ...validCard, ... }`)
- No setup/teardown hooks used yet (`beforeEach`, `afterEach` not present)
- Test names are descriptive and start with action verb or assertion (e.g., "validates", "rejects", "accepts")

## Mocking

**Framework:** Not used yet in Phase 0

**When to Mock:**
- External APIs (Stripe, Eleven Labs, cloud services) — when implemented
- Database calls — when SQLite integration is tested
- Network requests — when JSON-RPC gateway is tested

**What NOT to Mock:**
- Zod schema validation (test the actual parsing behavior)
- Core business logic until you need isolation
- Pure utility functions

## Fixtures and Factories

**Test Data:**
```typescript
const validCard = {
  id: randomUUID(),
  owner: 'chengwen@leyang',
  name: 'ElevenLabs TTS',
  description: 'Text-to-speech via ElevenLabs API',
  level: 1 as const,
  inputs: [{ name: 'text', type: 'text' as const, required: true }],
  outputs: [{ name: 'audio', type: 'audio' as const, required: true }],
  pricing: { credits_per_call: 5 },
  availability: { online: true },
  metadata: {
    apis_used: ['elevenlabs'],
    avg_latency_ms: 2000,
    success_rate: 0.98,
  },
};
```

**Location:**
- Declared at top of `describe()` block in test file
- Reused across multiple test cases via object spread (`{ ...validCard, owner: '' }`)
- Use `randomUUID()` from Node.js `crypto` module for ID generation

## Coverage

**Requirements:** No coverage thresholds enforced yet (Phase 0)

**View Coverage:**
```bash
pnpm test -- --coverage  # Generate coverage report (if supported by Vitest config)
```

## Test Types

**Unit Tests:**
- Focus: Zod schema validation logic
- Scope: Individual `CapabilityCardSchema` rules (owner required, level enum, pricing constraints)
- Approach: Test valid and invalid variants of the Capability Card
- Example file: `src/types/index.test.ts`

**Integration Tests:**
- Not yet implemented (Phase 0 is dogfood only)
- Will test: Registry storage, credit ledger updates, JSON-RPC communication
- Planned location: `src/registry/*.test.ts`, `src/gateway/*.test.ts`, `src/credit/*.test.ts`

**E2E Tests:**
- Not used in Phase 0
- Future: Test full flow of publishing → discovering → requesting → crediting

## Common Patterns

**Schema Validation Testing:**
```typescript
it('validates a correct L1 Atomic card', () => {
  const result = CapabilityCardSchema.safeParse(validCard);
  expect(result.success).toBe(true);
});

it('rejects a card without owner', () => {
  const bad = { ...validCard, owner: '' };
  const result = CapabilityCardSchema.safeParse(bad);
  expect(result.success).toBe(false);
});
```

**Assertion Pattern:**
- Use `.safeParse()` on Zod schemas to capture validation result
- Assert `result.success` is `true` for valid data
- Assert `result.success` is `false` for invalid data
- Can destructure result for detailed errors: `const { data, error } = result`

**Type Casting in Tests:**
```typescript
level: 1 as const,          // Narrow string literal type for TypeScript
type: 'text' as const,      // Required for enum validation
```

---

*Testing analysis: 2026-03-13*
