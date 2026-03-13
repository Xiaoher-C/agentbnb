# CLAUDE.md — AgentBnB

## Project Overview

AgentBnB is a P2P agent capability sharing protocol. Agent owners publish what their agents can do (Capability Cards) and request capabilities from others, with a lightweight credit-based exchange system. Think Airbnb for AI agent pipelines.

**Founder**: Cheng Wen (樂洋集團)
**Phase**: 0 — Dogfood (internal testing with OpenClaw agents)
**Primary Language**: TypeScript (Node.js)
**Package Manager**: pnpm

## Tech Stack

- Runtime: Node.js 20+
- Language: TypeScript (strict mode)
- Database: SQLite (via better-sqlite3) for local registry
- Protocol: JSON-RPC over HTTP for agent-to-agent communication
- Testing: Vitest
- Linting: ESLint + Prettier

## Architecture

```
src/
├── registry/        # Capability Card storage and search
│   ├── card.ts      # Capability Card schema and validation
│   ├── store.ts     # SQLite-backed card storage
│   └── matcher.ts   # Capability matching algorithm
├── gateway/         # Agent-to-agent communication
│   ├── server.ts    # HTTP server for incoming requests
│   ├── client.ts    # Outbound request client
│   └── auth.ts      # Simple token-based auth
├── credit/          # Credit tracking and escrow
│   ├── ledger.ts    # Credit balance management
│   └── escrow.ts    # Hold credits during capability execution
├── cli/             # CLI interface
│   └── index.ts     # Commander-based CLI
└── types/           # Shared TypeScript types
    └── index.ts     # Core type definitions
```

## Capability Card (Three-Level Model)

```typescript
interface CapabilityCard {
  id: string;
  owner: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;       // Atomic | Pipeline | Environment
  inputs: IOSchema[];
  outputs: IOSchema[];
  pricing: {
    credits_per_call: number;
    credits_per_minute?: number;
  };
  availability: {
    online: boolean;
    schedule?: string;     // cron expression
  };
  metadata: {
    apis_used?: string[];
    avg_latency_ms?: number;
    success_rate?: number;
  };
}
```

## Coding Conventions

- Use `async/await` everywhere, no raw Promises
- All public functions must have JSDoc comments
- Error handling: custom error classes extending `AgentBnBError`
- File naming: kebab-case (e.g., `capability-card.ts`)
- Test files: co-located as `*.test.ts`
- No `any` type — use `unknown` and narrow

## GSD Integration

This project uses GSD for spec-driven development:
- `.planning/ROADMAP.md` — Phase-based development plan
- `.planning/REQUIREMENTS.md` — Detailed requirements
- `.planning/config.json` — GSD configuration

## Phase 0 Goals (Dogfood)

1. Define Capability Card schema
2. Build local registry (SQLite)
3. Test with 2 OpenClaw agents sharing capabilities
4. Validate credit tracking works end-to-end
5. CLI for publishing, discovering, and requesting capabilities

## Important Context

- This is Phase 0. No external users. No production deployment. Focus on getting the dogfood loop working with OpenClaw agents.
- Founder (Cheng Wen) is the primary developer using vibe coding with Claude Code + GSD.
- The name "AgentBnB" reflects the Airbnb-like model: list your agent's idle capabilities, others book and use them.
