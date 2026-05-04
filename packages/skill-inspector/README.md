# @agentbnb/skill-inspector

> ## ⚠️ Deprecated as of v10 (2026-05-04)
>
> This package was scoped for the pre-v10 product narrative where SKILL.md
> introspection was a Hub feature. **v10 pivots to Agent Maturity Rental** —
> the unit of trade is now a time-boxed session of access to a mature agent,
> not an inspectable atomic skill. Maturity Evidence (past sessions, completed
> tasks, repeat renters, verified tools, renter ratings — see
> [ADR-022](../../docs/adr/022-agent-maturity-rental.md)) is the trust surface,
> not a skill graph.
>
> **What this means**:
> - No new features. Bug fixes only on a best-effort basis.
> - The Hub `/skills-inspector` route remains mounted but renders a deprecation banner.
> - The package is not part of the v10 supply or rental flow.
> - Existing consumers (CI tooling, ad-hoc SKILL.md inspection) keep working.
> - Removal scheduled for a future cleanup milestone after v10 ships.
>
> If you want SKILL.md introspection going forward, fork this package or wait for a community-driven successor.

---

Read-only Skill Inspector for AgentBnB. Parses SKILL.md files into a node graph and exposes risk and provenance signals to the AgentBnB Hub UI.

> **Terminology note.** "skill" in this package always means Anthropic's SKILL.md file format (the Claude Code construct). This is NOT the deprecated AgentBnB marketplace-skill concept — that legacy term was swept into "agent capability" / "provider agent" / "work network" by the T-A-3 terminology pass.

## Status — v0.1 (read-only)

v0.1 is a read-only inspector. Scope:

- SKILL.md → `SkillGraph` parser (7 node types: Trigger, Decision, Instruction, ToolCall, Example, Reference, OutputShape)
- Heuristic risk scorer (default-on conservative rules; opt-in noisier rules gated behind toggle)
- Provenance detection (`tracked` / `untracked` / `pinned`, gitSha, version, installSource, loadedBy)
- Public API: `parseSkill(markdown)` and `scoreRisks(graph)`

Out of scope for v0.1:

- Any edit/write operations to SKILL.md
- Claude API calls
- Cross-skill conflict detection
- Visual-as-source-of-truth flow

See `/Users/leyufounder/.claude/plans/skill-stateless-seahorse.md` for the full plan and rollout.

## Scripts

```bash
pnpm -F @agentbnb/skill-inspector build      # tsup bundle to dist/
pnpm -F @agentbnb/skill-inspector test       # vitest with 80% coverage gate
pnpm -F @agentbnb/skill-inspector typecheck  # tsc --noEmit
```
