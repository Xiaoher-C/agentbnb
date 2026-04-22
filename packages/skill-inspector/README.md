# @agentbnb/skill-inspector

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
