# Phase 23: Ship - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning
**Source:** PRD Express Path (v3.0-milestone.md + exploration)

<domain>
## Phase Boundary

Deploy AgentBnB to production (Fly.io) and prepare GitHub repo for public launch.
Success criteria #1 (My Agent route) is ALREADY DONE — route `/#/myagent` works with AuthGate + OwnerDashboard.

Remaining work: Deployment infrastructure + GitHub public checklist.

</domain>

<decisions>
## Implementation Decisions

### Deployment Infrastructure
- **Dockerfile**: Multi-stage build. Stage 1: `pnpm build:all` (builds CLI + Hub). Stage 2: Production image running `node dist/cli/index.js serve`
- **fly.toml**: App name `agentbnb`, region `nrt` (Tokyo), internal port 7701 (registry serves Hub at `/hub/`), health check `GET /health`
- **GitHub Actions CI**: Trigger on push/PR to main. Steps: checkout → pnpm install → typecheck → lint → test:run. Node 20.
- **`.env.example`**: Document optional API keys for SkillExecutor skills
- Registry server (`src/registry/server.ts`) already serves Hub static files and handles SPA routing fallback
- `pnpm build:all` already builds both packages correctly
- DNS (`agentbnb.dev` → Fly.io) and Cloudflare Tunnel are manual infrastructure tasks, not code

### GitHub Public Checklist
- LICENSE already correct: © 2026 Cheng Wen Chen, MIT
- .gitignore already excludes .env, *.db, node_modules
- README already overhauled in Phase 18
- AGENT-NATIVE-PROTOCOL.md already in repo root
- docs/brain/ already committed
- Need: marketplace.json, GitHub topics, social preview image

### Claude's Discretion
- Exact Dockerfile base image (node:20-slim recommended)
- Fly.io machine size (shared-cpu-1x is fine for MVP)
- CI timeout settings
- Whether to add a deploy workflow (fly deploy) or keep deployment manual

</decisions>

<specifics>
## Specific Ideas

### Existing Build Scripts (package.json)
```json
{
  "build": "tsup",
  "build:hub": "cd hub && pnpm install && pnpm build",
  "build:all": "pnpm build && pnpm build:hub",
  "test": "vitest",
  "test:run": "vitest run",
  "lint": "eslint src/",
  "typecheck": "tsc --noEmit"
}
```

### Registry Server (already serves Hub)
- `src/registry/server.ts` serves static files from `hub/dist/` at `/hub/`
- SPA fallback: any `/hub/*` returns `index.html`
- Health endpoint: `GET /health` returns `{ status: 'ok' }`
- Port: 7701 (registry-port option)

### Known Issues
- Hub React tests fail (jsdom not configured) — these are pre-existing and should be excluded from CI or fixed
- TypeScript errors in `src/conductor/task-decomposer.ts` — pre-existing from Phase 20

</specifics>

<deferred>
## Deferred Ideas

- Fly.io auto-scaling (post-launch)
- Custom domain SSL setup (Cloudflare handles this)
- CD pipeline (auto-deploy on merge to main) — keep manual for v3.0

</deferred>

---

*Phase: 23-ship*
*Context gathered: 2026-03-17 via PRD Express Path*
