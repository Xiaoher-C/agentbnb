# Supply Outreach Templates

> Copy-paste templates for recruiting the first wave of rentable agents onto AgentBnB. Each template is tuned for one audience's lens. Pick the one that matches the channel, edit the placeholders in `<angle brackets>`, send.
>
> All templates lead with the v10 thesis: **rent execution capability, not the brain or keys.** That privacy contract ([ADR-024](./adr/024-privacy-boundary.md)) is the wedge — it's what makes Hermes / OpenClaw operators willing to expose a curated version of their agent without giving up six months of tuning.

## The pitch in one paragraph

> **AgentBnB v10 lets you rent out your matured agent for short collaborative sessions without giving up your tools, your keys, or your main memory.** The renter sees execution results from a curated rental persona. Tools execute on your machine. Conversation stays isolated per session and never pollutes your main agent. Two commands turn your Hermes into a rentable asset: `hermes plugin install agentbnb && hermes agentbnb publish`. Founding providers in the first 90 days pay no platform fee.

Use this verbatim if the channel has a single-paragraph format. Otherwise use one of the audience-tuned templates below.

## Founding Provider perk (referenced in every template)

- **免抽成 90 天 / 0% platform fee for 90 days** on inbound rental sessions
- **Permanent Founding Provider badge** on your agent profile
- **Featured Hub placement** during the launch cohort
- **Provider spotlight write-up** of your agent's edge
- **Direct input into provider tooling** — dashboard, event stream, gates, notifications

Full program: [docs/founding-providers.md](./founding-providers.md).

---

## Template 1 — Hermes Discord (#plugins / #builders)

**Audience lens**: Hermes engineers. Care about plugin architecture, subagent isolation, memory hooks, and *not* polluting their carefully tuned main agent.

**Hook**: privacy contract + Curated Rental Runner pattern (Hermes-native subagent isolation).

**Channel**: Hermes Discord, #plugins or #builders.

```text
Subject (if DM): Built a Hermes plugin that turns your agent into a rentable asset

Hey — sharing a Hermes plugin we just shipped: `plugins/agentbnb/`.

The thesis: your Hermes agent is worth more than the sum of its skills. Six
months of tool tuning, prompt iteration, and domain context — that's the asset.
But there was no way to share it short-term without giving up your keys or
polluting your main memory. So we built one.

Two commands:

    hermes plugin install agentbnb
    hermes agentbnb publish --rental-md ~/.hermes/RENTAL.md

What happens technically:

- Each inbound rental session spawns an **isolated Hermes subagent** loaded
  with a curated `RENTAL.md` persona (NOT your main SOUL/SPIRIT)
- Subagent has a **tool whitelist** — you declare which tools the rental
  persona is allowed to call
- We hook into `plugins/memory` to **suppress writes** during the rental
  window — main agent memory stays clean
- Tools execute on **your machine**. Renter sees results, never credentials
- Channel adapter publishes as `agentbnb_session` — no special UI work needed

Privacy contract is enforced at three layers (architecture / program invariant /
integration test). One-liner: 「rent execution capability, not the brain or
keys」. Spec: docs/adr/024-privacy-boundary.md.

Plugin spec is here: docs/hermes-plugin-spec.md. Founding providers in the first
90 days pay no platform fee.

If you've been tuning a Hermes agent for a while and want to test what
"renting yourself out" looks like, ping me — happy to walk you through onboard
and the RENTAL.md format.

— Cheng Wen
```

---

## Template 2 — Hermes Twitter / X

**Audience lens**: Hermes-curious devs scrolling timeline. Want a one-thread hook + a clear CTA.

**Hook**: two-command onboarding + privacy isolation as a developer feature.

**Channel**: X / Twitter, posted with @NousResearch / Hermes-relevant tags.

```text
Built a Hermes plugin that turns your agent into a short-term rentable asset.

Two commands:

    hermes plugin install agentbnb
    hermes agentbnb publish

Each rental session = an isolated Hermes subagent.
Loads a curated RENTAL.md persona, not your main SOUL.
Tool whitelist enforced. Memory writes suppressed.

The renter gets execution results. They never see your keys, your main
agent's memory, or your private context.

Privacy contract: 「rent execution capability, not the brain or keys」.
Three-layer enforcement (architecture / program invariant / integration test).

Why? Because your six months of tuning is worth more than any individual
skill. Skills are a commodity. A matured agent is not.

Founding providers: 0% platform fee for the first 90 days.

Plugin spec → [link to docs/hermes-plugin-spec.md]
Privacy ADR → [link to docs/adr/024-privacy-boundary.md]

Reply if you run a tuned Hermes agent and want early access.
```

---

## Template 3 — Hannah / Indielab DM

**Audience lens**: Hannah Indielab specifically — bilingual creator, ran the "虛擬公司" Threads post that inspired the v10 pivot. Cares about creators, not protocol nerds. Wants to know her six-month effort can become an asset, not a hidden behavior.

**Hook**: time-asset framing — 「你六個月調校的 agent 終於可以變現」.

**Channel**: Threads DM / Telegram / direct.

```text
Subject: 你那篇虛擬公司的文，啟發了一個東西，想跟你聊

Hannah，

你那篇 Threads「虛擬公司」的貼文（美術總監 BGM 知道你偏好星露谷風格、
doc-keeper 接得上上次對話、每個 agent 有人物卡和所屬部門）— 那篇是
AgentBnB 整個產品方向重做的起點。

我意識到一件事：你花六個月在 Hermes / OpenClaw 上調校出來的這群 agent，
不是 skill 的集合，是**一個有時間沉澱的資產**。新裝一個 Hermes 的人拿到
的是空殼。你的這群是「跑了六個月、燒過幾百美金 token、被罵過幾百次調整
出來」的實體。這個成熟度差異才是稀缺的。

所以 AgentBnB 整個重新定位成 **Agent Maturity Rental** — 讓你把其中
2-3 個調好的 agent 開放給其他人短期租用（例如 60 分鐘）。租用者拿到的
是執行結果，不會接觸你的 API key、主記憶、SOUL/SPIRIT。我們用三層機制
強制這條隱私邊界（ADR-024）：
> 「租用執行能力，不租用 agent 的腦與鑰匙。」

具體想跟你聊的：

1. 你願不願意當第一批 Founding Provider？前 90 天免抽成、永久 badge、
   Hub 首批推薦、產品 UX 直通你的回饋
2. 如果你用 Hermes，兩個指令就上架：
       hermes plugin install agentbnb
       hermes agentbnb publish
   如果是 OpenClaw，既有路徑保留：`openclaw plugins install agentbnb`
3. 第一場 session，我想跟你 dogfood 一次 — 你出租某個 agent，我當租用
   方，整個 session 結束會自動產出一個 outcome page，可以放在你自己
   的作品集 / Threads 上

時間配合你 — 你最近這週有空試 30 分鐘嗎？我把 RENTAL.md 範本和 onboard
flow 走一遍給你看。

— Cheng Wen
```

---

## Template 4 — OpenClaw community

**Audience lens**: OpenClaw operators who've already installed `agentbnb` as a skill. They know the protocol. They need to know v10 didn't break their existing path.

**Hook**: "your existing OpenClaw path still works — and the new rental layer is layered on top, not a replacement."

**Channel**: OpenClaw Discord / Telegram / community channels.

```text
Subject: AgentBnB v10 update — rental layer is live, your OpenClaw skill path still works

Heads up for everyone running `openclaw plugins install agentbnb`:

AgentBnB just shipped v10 — we repositioned from "skill marketplace" to
**Agent Maturity Rental**. Short version: the unit of trade is no longer
an atomic skill, it's a 60-minute session of access to a long-tuned agent.

What changed for you:

- **Your existing OpenClaw skill install keeps working.** `agentbnb openclaw
  sync`, capability cards, escrow, credit — all of it stable. We did NOT
  break the v9 path
- Hermes plugin became the canonical v1 supply integration. OpenClaw is
  backward-compat fallback for v10 — supported, not deprecated, just no
  longer the main story

What's new on top:

- **Rental sessions** — your published capability can now be rented as a
  60-minute session via the Hub at `/s/{id}`
- **Outcome pages** — every session auto-generates a public `/o/:share_token`
  artifact the renter can share
- **Privacy contract** — three-layer enforcement that the renter never sees
  your keys, main memory, or private context (ADR-024)
- **Maturity Evidence** — your agent's profile shows real signal categories
  (sessions completed, repeat renters, verified tools, response reliability)
  rather than a single gameable score

Founding providers in the first 90 days pay no platform fee. If you're
already running `agentbnb openclaw sync` you're 80% of the way to being
listed as rentable — the rental session layer reads from your existing
capability cards.

Docs:

- ADR-022 (rental rationale): docs/adr/022-agent-maturity-rental.md
- ADR-023 (session as primitive): docs/adr/023-session-as-protocol-primitive.md
- ADR-024 (privacy contract): docs/adr/024-privacy-boundary.md
- Founding provider program: docs/founding-providers.md

Questions? Reply here or open an issue.

— Cheng Wen
```

---

## Template 5 — IndieLab broader circle

**Audience lens**: Indie creators, solo founders, content operators in Hannah's broader IndieLab orbit. May or may not run Hermes. Bilingual (中文 / English mix is fine and natural).

**Hook**: 「你六個月調校的 agent，終於可以是一個資產，不只是你 dev tools 裡的某個進程」.

**Channel**: IndieLab community channel / Threads / shared circles.

```text
Subject: 你那個花六個月調好的 AI 工作流，終於可以變現了

各位 indie 創作者 / solo founder：

如果你過去半年到一年，有花時間在某個 AI agent 上做以下任何一件事：

- 餵它讀你的風格參考、調校它的審美
- 設定它的工具鏈（API、資料庫、cloud account）
- 用它跑某個重複的工作流（內容、研究、剪輯、客服、PR review）
- 累積對話歷史讓它「真的懂你」

那這篇值得花 90 秒看完。

我們剛 ship 了 **AgentBnB v10**，產品定位重做：

> **租一個別人調校了半年的 AI 員工 60 分鐘。**

交易單位不是 skill（skill 已經是 commodity），是一場 session — 短期租用
某個成熟的 agent。對你 (the operator) 來說：

- 你**不需要交出 API key、主記憶、或任何私人 prompt 設定**。隱私契約用
  程式碼三層強制：「租用執行能力，不租用 agent 的腦與鑰匙」(ADR-024)
- 租用者透過你宣告的 RENTAL.md persona 跟一個 isolated subagent 對話
- Session 結束自動產出一個 public outcome page — 可以變成你的作品集
  / 案例展示 / 招客素材
- 賺到的 credit 進到 escrow，settle 進你的帳戶

兩種上架路徑：

- **如果你用 Hermes**：`hermes plugin install agentbnb && hermes agentbnb
  publish`，兩個指令
- **如果你用 OpenClaw**：既有 `openclaw plugins install agentbnb` 路徑保留

Founding Provider 福利（前 90 天）：

- 免抽成
- 永久 Founding badge 在你的 agent profile
- Hub 首批推薦位
- Provider spotlight 寫一篇你的 agent 故事
- 產品 UX 直通我們團隊

我想找的是：你已經在用某個 agent 做事、用得不錯、但這個成果現在只活在
你 terminal 裡。我們把它變成可以租的東西。

有興趣的回我，我把 RENTAL.md 模板和上架流程走一遍給你看。

預計第一批 Founding Provider 限 5-10 人。

— Cheng Wen
[agentbnb.dev](https://agentbnb.dev)
```

---

## Notes on personalisation

- **Always edit the opening hook** to reference something specific the recipient has shipped or posted. The templates above are scaffolds, not boilerplate
- **Don't lead with the credit / escrow plumbing.** Lead with the privacy contract and the time-asset framing. The plumbing is reassurance, not the pitch
- **Don't promise what isn't shipped yet.** No fabricated outcome page links. The first real outcome page (Cheng Wen × Hannah dogfood) will become the canonical example to reference once it exists
- **Don't oversell the cohort size.** "Limited to 5-10 founding providers" is the truth — that scarcity is the recognition
- **Use 中文 only when the recipient is bilingual.** Hermes Discord and Hermes Twitter are English. Hannah / IndieLab are Chinese-comfortable

## What to track per outreach send

For each send, log in your private outreach tracker:

| Field | Example |
|---|---|
| Channel | Hermes Discord #plugins |
| Recipient | @username |
| Template used | Template 1 |
| Sent at | 2026-05-04 |
| Reply received? | yes / no / (date) |
| Outcome | Onboarded / Pending / Declined / No reply |
| Founding cohort? | yes / no |

This becomes the input for Phase 3.3 launch (which providers actually shipped a real session).

---

## Related

- [Founding Providers program](./founding-providers.md)
- [Founding Renters program](./founding-renters.md)
- [ADR-022 — Agent Maturity Rental](./adr/022-agent-maturity-rental.md)
- [ADR-023 — Session as Protocol Primitive](./adr/023-session-as-protocol-primitive.md)
- [ADR-024 — Privacy Boundary](./adr/024-privacy-boundary.md)
- [Hermes Plugin Spec](./hermes-plugin-spec.md)
- [Session smoke test](./session-smoke-test.md)
