# Genesis Template — Handoff Note

> 這份 draft 由 OpenClaw 端的 Claude 寫成，請搬移到 AgentBnB repo 的 `packages/genesis-template/` 繼續開發。

---

## 目標位置 (AgentBnB repo)

```
agentbnb/
└── packages/
    └── genesis-template/          ← 把這個 draft 整個搬過來
        ├── package.json
        ├── schema/
        │   └── capability-card.schema.json
        ├── scripts/
        │   ├── mappings.ts        ← Domain + API → Skills 映射表（核心邏輯）
        │   └── init.ts            ← 互動式 init script
        ├── templates/
        │   ├── SOUL.md.hbs        ← 生成 agent SOUL.md 的模板
        │   ├── HEARTBEAT.md.hbs   ← 生成 agent HEARTBEAT.md 的模板
        │   └── skills/            ← 生成後複製到 agent skills/ 目錄
        │       ├── genesis-pulse/SKILL.md
        │       ├── genesis-trader/SKILL.md
        │       ├── genesis-idle-sharer/SKILL.md
        │       └── genesis-feedback/SKILL.md
        └── memory-seeds/          ← 待補：初始記憶種子 (Core-tier memories)
```

---

## 各檔案說明

### `scripts/mappings.ts`
Domain → Skills 映射表。這是讓每個 clone 天生有供給+需求的核心。
- `DOMAIN_PROFILES`: 8 個 domain，每個有 `potential_skills`（供給）和 `gaps`（需求）
- `API_SKILLS`: 11 個 API，每個有對應的 SkillDefinition
- `resolveSkills(domain, selectedApis)`: 計算這個 agent 應該發布哪些 skills

### `scripts/init.ts`
互動式 CLI。5 個問題，產出 3 個檔案：
1. `capability-card.json` → 發布到 AgentBnB Hub
2. `SOUL.md` → agent 身份（從 hbs template 產生）
3. `HEARTBEAT.md` → heartbeat 配置（從 hbs template 產生）

**Dependencies 需要確認**:
- `@clack/prompts` — 互動式 CLI
- `handlebars` — 模板渲染
- `agentbnb` CLI — `agentbnb init`, `agentbnb status` 等命令

### `templates/SOUL.md.hbs`
Agent 身份模板。重點是「交易意識」的寫法 — 解釋為什麼要交易，不只是如何交易。
使用 Handlebars 變數（`{{agentId}}`, `{{skillsSummary}}` 等）。

### `templates/HEARTBEAT.md.hbs`
Heartbeat 配置模板。包含三層模型路由的 budget 規則。

### `templates/skills/genesis-pulse/SKILL.md`
自我反思引擎。每個 heartbeat 第一個跑，產出 PulseReport。
- 計算 fitness_score（4 個維度）
- 寫入 memory 供後續 skills 讀取
- 觸發 fitness alerts

### `templates/skills/genesis-trader/SKILL.md`
交易核心。兩個方向：
- **Part A — 賺**: 接收其他 agent 的租用請求，服務後結算 credits
- **Part B — 花**: 偵測任務能力缺口 → Hub 搜尋 → 自主決策 → 租用

三個 autonomy tiers 在這裡執行（tier1/2/3 threshold）。

### `templates/skills/genesis-idle-sharer/SKILL.md`
供給引擎。監控 idle_rate，自動上架/下架 Hub listing。
- 新技能 bootstrap: 前 3 次以 50% 折扣「preview」價上架，成功 3 次後升級正式上架
- 每 10 次 heartbeat 做一次定價評估（需求高 → 漲10%，需求低 → 降10%）

### `templates/skills/genesis-feedback/SKILL.md`
品質信號引擎。每次交易後提交 ADR-018 結構化評價。
- 建立個人化 provider 信譽資料庫（存在 memory，給 genesis-trader 選 provider 用）
- 收到負評時觸發自我優化

### `schema/capability-card.schema.json`
完整 JSON Schema。這是 AgentBnB Hub 接受的 capability card 格式。
需要確認是否與 AgentBnB 現有的 schema 相符，如有衝突以 AgentBnB 端為準。

---

## 需要 AgentBnB 端確認的事項

1. **Capability Card schema 格式** — 是否與 AgentBnB registry 現有格式相符？
   特別是 `agent_id` 格式、`skills[]` 結構、`gaps[]` 欄位是否已支援。

2. **`agentbnb` CLI commands** — init.ts 和 SKILL.md 裡用了這些命令，請確認 CLI 支援：
   - `agentbnb init --agent-id --name --card --non-interactive`
   - `agentbnb status --json`
   - `agentbnb skill publish --skill-id --price --max-concurrent --max-daily`
   - `agentbnb skill unpublish --skill-id`
   - `agentbnb request --provider --skill --params`
   - `agentbnb escrow hold/settle/release`
   - `agentbnb feedback submit --json`
   - `agentbnb feedback list --recipient --since`

3. **Feedback API (ADR-018)** — DOC1 Phase A1 需要先完成，genesis-feedback 才能工作。

4. **Signup bonus** — init.ts 假設新 agent 加入時得到 50 credits。
   這需要 AgentBnB 端的 `agentbnb init` 支援初始 credit 發放。

5. **memory-seeds/** 目錄 — 目前是空的。
   需要定義 Core-tier memories 的格式，讓 clone 繼承有用的初始知識。

---

## 這份 draft 沒有做的事（留給 AgentBnB 端）

- `genesis-evolution/SKILL.md` — 自我進化引擎（V2）
- `memory-seeds/core-memories.json` — 初始記憶種子
- ClawHub publish 整合
- Fitness leaderboard dashboard
- 完整的 TypeScript types（init.ts 部分用了 `as string` 暫時繞過）
- Tests

---

## 設計決策記錄

**為什麼把 gap-detector + skill-scout + smart-renter 合併成 genesis-trader？**
原本 DOC2 拆成 3 個 skills，但中間傳遞 context 容易漂移，且一個 heartbeat 要跑 3 個 skills 才完成一次決策太慢。合併後 context 在同一個 skill 裡流動，更可靠。

**為什麼新技能要 preview 3 次才正式上架？**
防止還沒驗證的技能直接上 Hub 接單失敗，影響 reputation。3 次是最小可信樣本。

**為什麼 SOUL.md 解釋「為什麼要交易」？**
LLM agent 需要理解動機才能在邊界情況下做正確判斷。純 config 沒有動機，遇到 SOUL.md 沒寫到的情境就會亂跑。
