# Hermes Plugin v0.1.0 — Announcement Copy

> Audience: Cheng Wen, before posting. These are **templates** — review,
> adjust the link, and post manually. Each block is sized for the channel
> it targets.

The release URL after the tag push will be:
`https://github.com/Xiaoher-C/agentbnb/releases/tag/hermes-plugin-v0.1.0`

Substitute that URL where the templates show `<RELEASE_URL>`.

---

## Hermes Discord — `#community-plugins` (or wherever the operator crowd hangs out)

> Hey Hermes folks — I just released the first alpha of the **AgentBnB
> Hermes plugin**. It exposes your Hermes agent for short-term rental on
> the AgentBnB network — two commands and a `RENTAL.md`.
>
> ```
> hermes plugin install agentbnb
> hermes agentbnb publish
> ```
>
> What it actually does: each rental session spawns an **isolated subagent**
> loaded only with your `RENTAL.md` persona — never your `SOUL.md` /
> `SPIRIT.md`, never your conversation history. Tools execute on your
> machine; the renter only sees results. Memory writes during a rental
> session are suppressed and the AgentBnB Hub skips persistence so
> rentals never enter your audit trail. Three layers, all enforced by code
> (ADR-024 in the repo).
>
> Concretely: 90 tests green, three install paths (fork / pinned tarball /
> submodule), pinned tarball with SHA-256 attached to every release.
>
> Source + install: <RELEASE_URL>
> Privacy contract write-up: ADR-024 in the repo
>
> First dogfood is a Cheng Wen × Hannah BGM rental. If you tune a Hermes
> agent worth renting, I'd love a second dogfood — DM me.

---

## X / Twitter — single post

> Shipped: AgentBnB Hermes plugin v0.1.0.
>
> Two commands turn your 6-month-tuned Hermes agent into a rentable
> resource. Renters get the execution; your brain, keys, and memory stay
> yours — three-layer privacy contract, all enforced by code.
>
> 「租用執行能力，不租用 agent 的腦與鑰匙」
>
> <RELEASE_URL>

### Optional follow-up reply

> The novel piece: `CuratedRentalRunner` spawns a fresh subagent per
> rental loaded only with your owner-curated `RENTAL.md` (persona + tool
> whitelist), wraps the session in `isolated_memory(...)` so writes are
> no-op'd and audited, and the Hub skips `request_log` when
> `session_mode=true`. ADR-024 in the repo.

---

## Hannah (private DM, Mandarin)

> 嘿 Hannah，AgentBnB 的 Hermes plugin v0.1.0 出了，妳那邊可以試裝看看：
>
> 兩條指令：
>
> ```
> hermes plugin install agentbnb
> hermes agentbnb publish
> ```
>
> 妳會編一個 `RENTAL.md`（persona + 允許用的工具清單），我那邊就能租。
> 整個 session 是隔離的 subagent，不會碰到妳主 agent 的記憶或工具金鑰；
> 工具仍然在妳的機器上跑，我只看到結果。
>
> 如果方便，下週我們就跑一次 BGM 的真實 dogfood —— 模式切到「透過我的 agent」，
> 我把素材丟過去，妳的 agent 出 60 分鐘的成果，最後生一個 outcome page 給雙方。
>
> Release：<RELEASE_URL>
> 細節：repo 裡 `hermes-plugin/README.md` 跟 `INSTALL.md`

---

## IndieLab (post or DM)

> Phase 2A of the AgentBnB v10 pivot just shipped: the **Hermes plugin
> v0.1.0** — the canonical supply integration for Agent Maturity Rental.
>
> The thesis we're testing: an agent that's been tuned for six months
> (prompt cache, tool config, accumulated style) is worth more than the
> sum of its skills. People who don't have time to tune one can rent
> yours for an hour.
>
> The most novel piece is the privacy contract — three layers all
> enforced by code so the renter gets execution without ever touching
> your brain, keys, or memory. ADR-024 in the repo if you want the
> design.
>
> Looking for two things:
>
> 1. Hermes operators willing to publish their agent for a real rental
> 2. Anyone who's tried similar "rent the tuned agent" framings — I want
>    to compare notes on what shape the Capability Card / Outcome Page
>    ends up converging on
>
> Release: <RELEASE_URL>

---

## OpenClaw community (short, deferential)

> Quick update for the OpenClaw folks who tried the v9 `openclaw install
> agentbnb` skill: that path still works (backward-compat preserved), but
> from v10 onward the active push is the **Hermes plugin**. First release
> just shipped.
>
> Why the shift: the Curated Rental Runner needs an isolated subagent per
> session, and Hermes' platform-adapter pattern matched that shape better
> than retrofitting the OpenClaw skill loader. Everything else (DID,
> UCAN, escrow, credits) stays unchanged.
>
> If you want to stay on the OpenClaw skill, no migration needed; if you
> want the new privacy contract, install the Hermes plugin alongside.
>
> <RELEASE_URL>

---

## Internal note — for the AgentBnB founder log

> Phase 2 Track A milestone: Hermes plugin v0.1.0 cut. Tarball + SHA-256
> attached to the GitHub release; install paths A/B/C in `INSTALL.md`
> point at it. Privacy contract Layers 1+2 ship in this version (Layer 3
> is server-side, already live). Next: Hannah BGM dogfood, then second
> external dogfood from the Hermes Discord audience.
