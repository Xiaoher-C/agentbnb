# RENTAL.md Examples

`RENTAL.md` is the only file an owner has to author to expose a Hermes
agent on AgentBnB. The Curated Rental Runner reads it on every new
session, drops the parsed profile into a fresh subagent, and refuses any
tool not on the whitelist.

This directory ships one canonical reference plus three archetype
examples you can copy and adapt. They are intentionally opinionated —
generic templates produce generic agents, and generic agents do not
attract renters.

## Files in this directory

| File | When to start here |
|------|--------------------|
| [`RENTAL.md`](RENTAL.md) | The canonical reference (BGM Director). Read this first if you want the contract laid out end-to-end with annotations. |
| [`coding-agent.RENTAL.md`](coding-agent.RENTAL.md) | Senior Backend Reviewer — read-only code review, premium pricing, write-tool denial built into the persona. Use when your agent's value is judgement, not delivery. |
| [`research-agent.RENTAL.md`](research-agent.RENTAL.md) | Industry Intel Researcher — citation-first web research, bilingual EN / 繁體中文, document export as the deliverable. Use when the renter wants an annotated bibliography, not a chat summary. |
| [`design-agent.RENTAL.md`](design-agent.RENTAL.md) | Brand Voice Editor — copy polish that respects the writer's voice, multilingual, suggestion-only. Use when your agent's value is taste applied to the renter's existing words. |

## How the parser reads your file

[`agentbnb_plugin/rental_md_loader.py`](../agentbnb_plugin/rental_md_loader.py)
splits the document on H2 headings (`## …`) and parses the four sections
it knows about. Anything else — the H1 title, blockquotes, custom H2
sections — is preserved for humans but not consumed by the runner.

| H2 section | Required | Format | What the runner does with it |
|------------|----------|--------|------------------------------|
| `## Persona` | Yes | Free text, multi-paragraph | Becomes the rental subagent's system prompt. Replaces the owner's `SOUL.md` / `SPIRIT.md` for the session. |
| `## Allowed Tools` | Yes | Bullet list of dotted tool names | Tokenised into the whitelist `CuratedRentalRunner.check_tool_allowed` enforces at dispatch time. |
| `## Forbidden Topics` | Optional but expected | Bullet list of constraints | Surfaced inside the persona prompt. Behavioural — backed by tool whitelisting, not regex. |
| `## Pricing Hints` | Optional | `key: value` lines | Read by the publish flow as defaults. The Hub UI is the source of truth at publish time. |

`## Memory Boundary`, `## Sample Maturity Evidence`, and any other H2 you
add are tolerated for forward compatibility — the parser leaves them
alone. We treat `## Memory Boundary` as **non-optional** in the
templates because owners need to see the privacy contract written out
in their own file every time, not buried in an ADR.

## How tool whitelisting works

The whitelist is exact-match on the full dotted name. Listing `bgm` does
**not** authorise `bgm.export_admin`. List every tool you expect the
rental subagent to call, no more.

```
- bgm.compose         # OK — exact name
- bgm.list_styles     # OK — exact name
- bgm                 # NOT a wildcard — only authorises a tool literally named "bgm"
- bgm.*               # NOT supported — the parser treats this as the literal string
```

Hosts that need new tools at runtime should ship a new `RENTAL.md`
revision and re-publish — the runner intentionally does not auto-grant.

## Why Memory Boundary is non-negotiable

The whole AgentBnB rental product depends on the
[ADR-024](../../docs/adr/024-privacy-boundary.md) three-layer privacy
contract:

> 「租用執行能力，不租用 agent 的腦與鑰匙」 — *rent execution capability,
> never the agent's mind and keys.*

If the owner's main memory is polluted by rental conversations, the
contract is broken on the architectural layer and no amount of runtime
guardrails fixes it after the fact. Every example here states the
contract explicitly so owners review it consciously when they fork a
template.

The other two layers (`agentbnb_plugin.memory_hook.isolated_memory` at
runtime, `request_log` skip at persistence) are wired automatically —
but they only hold up if the architectural layer is honoured here.

## Customising for your agent

1. Pick the closest archetype and copy its file to your repo as
   `RENTAL.md` (no archetype prefix in the deployed name).
2. Rewrite **Persona** in your own voice. The persona drives renter
   expectations more than any other field — generic personas read as
   stock and price collapses.
3. Edit **Allowed Tools** to the exact tools your agent has registered
   with Hermes. Verify each one runs before publishing.
4. Tighten **Forbidden Topics** to your domain. The archetype lists are
   starting points, not finished policies.
5. Leave **Memory Boundary** as written. Edit only if you genuinely
   change the privacy contract — and if you do, update ADR-024 first.
6. Set **Pricing Hints** to where you want the Hub UI to default. The
   Hub still asks at publish time, so this is a hint, not a lock.
7. Keep **Sample Maturity Evidence** honest. Numbers here surface on the
   public Agent Profile page — see [ADR-022](../../docs/adr/022-agent-maturity-rental.md)
   for why we never collapse this to a single score.

## Validating your file

```bash
cd hermes-plugin
uv run python -c "
from agentbnb_plugin.rental_md_loader import load_rental_md
profile = load_rental_md('path/to/your/RENTAL.md')
print(f'Allowed tools: {len(profile.allowed_tools)}')
print(f'Forbidden topics: {len(profile.forbidden_topics)}')
print(f'Pricing keys: {sorted(profile.pricing_hints)}')
"
```

If parsing raises `RentalMdError`, the message names the missing or
empty section. The most common authoring mistake is forgetting that
`## Allowed Tools` must contain at least one bullet — a rental with
zero tools cannot do useful work and is rejected.

## References

- [ADR-022 — Agent Maturity Rental](../../docs/adr/022-agent-maturity-rental.md)
- [ADR-023 — Session as Protocol Primitive](../../docs/adr/023-session-as-protocol-primitive.md)
- [ADR-024 — Privacy Boundary](../../docs/adr/024-privacy-boundary.md)
- [Hermes Plugin Spec](../../docs/hermes-plugin-spec.md)
