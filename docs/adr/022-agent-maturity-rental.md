# ADR-022: AgentBnB Repositioning — From Skill Marketplace to Agent Maturity Rental

**Status**: Approved (2026-05-04)
**Date**: 2026-05-03 (drafted) → 2026-05-04 (approved with Maturity Evidence revision)
**Author**: Cheng Wen + Claude
**Deciders**: Cheng Wen
**Supersedes**: 過去所有以「skill marketplace」「capability exchange」為核心定位的設計文件
**Related**:
- ADR-023: Session as Protocol Primitive (Web room canonical UI; Hermes plugin canonical supply integration)
- ADR-024: Privacy Boundary (租用執行能力，不租用 agent 的腦與鑰匙)
- 過去的 `AGENT-NATIVE-PROTOCOL.md`（部分保留）
- 過去的 `IDENTITY-MODEL.md`（保留）
- 過去的 escrow / credit 系統（保留）

---

## 一、Context（背景）

AgentBnB 過去 18 個月以「**Agent-Native Skill Marketplace**」為核心敘事推進開發，核心假設是：

1. Agent 之間需要交換 skill / capability
2. Skill 可作為交易單位，搭配 escrow + credit 形成 marketplace
3. 透過 DID + UCAN + VC 提供跨平台信任層
4. 類比為「npm for agents」

但在 2026 年 Q1-Q2 的市場驗證中，這個定位遇到三個結構性問題：

### 1.1 Skill 已是過剩商品，不是稀缺品

主流 skill 生態快速成熟：
- Anthropic 官方 `skill-creator` + `gh skill` CLI（2026/04）
- skills.sh / agentskill.sh marketplace
- SkillsMP 收錄 800K+ skills
- Antigravity awesome-skills 22K+ stars
- 統一安裝協議 `npx skills add owner/repo`，支援 39+ 個 agent

Skill 供給已經過剩，**單個 skill 的可交易價值趨近於零**。

### 1.2 LLM 升級持續稀釋 skill 價值

每一代基礎模型（Claude Opus 4.6→4.7、GPT-5）都會吞掉一批原本需要 skill 才能達成的能力。**今天的 skill，半年後可能是 base model 內建**。把 marketplace 建立在會持續貶值的資產上，是策略性的錯誤。

### 1.3 Supply side 永遠是空的

過去推廣中，AgentBnB 的 supply side 始終只有開發團隊自己的 agents（Xiaoher-C、genesis-bot）。原因不是推廣不力，是**「貢獻 skill 上架」這個行為對使用者沒有自然動機**——使用者不會把自己累積的東西包成 skill 上架，因為這個動作本身對他們沒有立即價值。

### 1.4 但是——使用者真實在做的事，是另一件事

從 Hannah Indielab 在 Threads 上分享的「虛擬公司」（6940 次瀏覽）可以看到：使用者在做的不是「上架 skill」，而是**長期養一個 agent 團隊**。她展示的是：
- 美術總監 BGM 知道她偏好星露谷風格 → **對話歷史的沉澱**
- doc-keeper 接得上「上次對話」 → **記憶累積**
- 每個 agent 有人物卡、技能卡、所屬部門 → **身份成熟度**

這些是 skill 安裝不會帶來的東西——**只有時間和使用累積得出來的**。

同樣的現象在 Hermes Agent 上完全成立：
- Threads 流量訊號的 6 元素標註庫（人工標註過 100 篇）
- B 型觀點文的識別精度
- 個人語氣調校
- 反共鳴過濾器的 threshold 微調
- Vertex AI / Qdrant / Cloud Run 的接入配置與 prompt cache

**新裝 Hermes 的人拿到的是空殼。Cheng Wen 的 Hermes 是「跑了 6 個月、燒過幾百美金 token、被罵過幾百次調整出來」的實體。**

這個成熟度差異，才是真正的稀缺資產。

---

## 二、Decision（決策）

**將 AgentBnB 重新定位為 Agent Maturity Rental（Agent 成熟度租用）平台。**

### 2.1 核心定義

> **AgentBnB 是讓重度使用者出租自己長期調校過的 agent 給其他人短期使用的服務。**
>
> 交易單位不是 skill，而是 **agent 在某一時點的整體成熟狀態**——包含對話歷史沉澱、調校投入、工具接入深度、領域積累。

### 2.2 對比新舊定位

| 維度 | 舊定位（Skill Marketplace） | 新定位（Agent Maturity Rental） |
|---|---|---|
| **交易單位** | Atomic skill / capability | 整個 Agent 的當前狀態 |
| **價值來源** | Skill 數量、功能 | Token 沉沒成本 + 調校時間 + 工具接入深度 |
| **使用者問的問題** | 這個 skill 能做什麼？ | 這個 Agent 比我自己訓的強在哪？ |
| **競爭護城河** | 易被 LLM 升級稀釋 | 時間是無法跳過的，越老越值錢 |
| **Supply 來源** | 需要使用者主動上架 | 重度使用者自然成為供給端 |
| **類比** | npm for agents | 租一個資深員工 vs 自己從零訓新人 |

### 2.3 三個核心命題

**命題 1：時間是無法跳過的稀缺資源**

LLM 會持續變強，但**「在這個強 model 上沉澱 6 個月的調校」**這件事，新使用者沒有時間機器可以跳過。Base model 越強，沉澱在上面的調校越值錢——這是反直覺但成立的槓桿。

**命題 2：Agent 是長期關係，不是工具**

Hannah 的「美術總監」不是工具，是**員工**。她跟它有對話歷史、有偏好磨合、有信任關係。租用其他人的成熟 agent，本質上是「**短期借用一個資深專家**」，不是「下載一個 plugin」。

**命題 3：成熟度可以被觀察、被評估、被定價（但不該被壓縮成單一分數）**

詳見 §3.3 — Maturity Evidence + Rating（不做 single Maturity Score）。

---

## 三、Consequences（後果）

### 3.1 保留的設計與資產

**完全保留：**
- DID + UCAN + VC 身份系統 → 變成「agent 履歷的驗證層」
- Credit 經濟與 escrow 結算 → 變成「租用計費機制」
- AgentBnB Hub（identity / discovery / 結算）→ 變成「agent 名片夾」
- Daemon / Gateway 基礎設施 → 變成「agent 連線到 session 的執行層」
- OpenClaw 整合 → backward compat 路徑（v1 不主推；新主推 Hermes plugin，見 ADR-023）

**部分保留：**
- Skill 概念仍存在，但**降級為「agent 能力的 tags」**，不是交易單位
- `skill wrap` 工具保留，但用途改為「快速接入工具到自己的 agent」，不是「上架到 marketplace」

### 3.2 棄用 / Sunset 的設計

- **Skill marketplace 作為核心敘事** → 棄用
- **Atomic capability 的獨立交易** → 棄用
- **Skill 級別的定價、評分、ranking** → 棄用
- **「貢獻 skill」「上架 skill」相關 onboarding 流程** → 棄用

### 3.3 新增的核心設計

**Agent Profile（取代 Skill Listing）**
- 每個可租用的 agent 有公開 profile 頁
- 顯示 Maturity Evidence、過往租用案例、可用時段、價格
- 設計參考 LinkedIn profile，不是 npm package page

**Rental Session（取代 Skill Call）**
- 交易的最小單位是 session（一段時間的代理使用權）
- 詳見 ADR-023

**Maturity Evidence + Rating（取代 single Maturity Score）**

不做被壓縮成單一分數的 Maturity Score（參見 §4.1 與 §5 anti-goals）。改為展示一組 **可獨立驗證的 evidence categories**，讓買方自己權衡：

| 類別 | 內容 | 來源 |
|---|---|---|
| **Platform-observed sessions** | 在 AgentBnB 上完成的 session 數 | Hub backend |
| **Completed task count** | 累計完成的 task threads | Session outcomes |
| **Repeat renters** | 回訪租用的 unique renters | Hub backend |
| **Artifact examples** | 過往可分享的 outcome page 連結 | Outcome page |
| **Owner-claimed tools** | Owner 宣告的工具/接入清單 | Agent profile |
| **Verified tool integrations** | 系統驗證過確實可用的工具 | Hub backend probe |
| **Renter rating** | 5 星制 + comment（aggregate）| Rating 系統 |
| **Response / completion reliability** | 接單延遲、完成率、中斷率 | Hub backend metrics |

**Token 用量、調校次數、運行天數**可顯示為輔助 badge 或區間（如「6+ months active」），但**不作為主要排名依據**。理由：燒 token 不等於強，這類純客觀指標容易被刷且解釋成本高。

**Renter rating 早期樣本不足時**：前 10 次租用標記為「Early access」不影響評級，避免冷啟動評分被少數樣本扭曲。

### 3.4 對使用者體驗的影響

**對 supply side（agent 主人）：**
- 不再需要主動「打包 skill 上架」
- 只需要在 Hub 上設定「我的 agent 願意被租用」+ 設定費率 + 撰寫 RENTAL.md（rental persona + tool whitelist）
- 持續使用自己的 agent = 持續累積租用 evidence

**對 demand side（租用者）：**
- 不再瀏覽 skill 目錄
- 改為瀏覽「成熟 agent 目錄」
- 看 profile evidence、看 outcome、選擇租用時段
- 進入 session 完成任務、取得產出

### 3.5 對推廣與敘事的影響

**舊敘事（已驗證效果有限）：**
- 「Agent 經濟」「Capability marketplace」「npm for agents」

**新敘事：**
- 「租一個別人調校了半年的 AI 員工」
- 「你的 agent 也可以被租用賺 credit」
- 「不是下載 skill，是借用實戰過的 agent」

新敘事的優勢：**具體、有畫面、有故事**。Hannah 那種「養 AI 同事」的截圖天然就是行銷素材。

---

## 四、必須面對的硬問題

### 4.1 「Agent 強度」如何客觀衡量？

**這是 ADR 落地的最大未解問題。**

過去版本提過三條候選方案（A 純客觀指標 / B 標準化 benchmark / C 使用者評分），原本的初期決策是 A+C 混合產出 single Maturity Score。**本次修訂否決 single score 路線**，理由：

1. Single score 容易被刷（token 燒得起 ≠ agent 強）
2. Single score 解釋成本高（買方不知道分數怎麼算出來的）
3. 不同需求對應不同維度，強迫壓縮成單一數字會 lose information

**修訂後的決策**：採用 **Maturity Evidence list**（§3.3）讓買方自己權衡。每個 evidence category 都可獨立驗證，且有清楚 source。Token 用量降為輔助 badge。Benchmark task（B）留作 v2 探索。

### 4.2 隱私問題

詳見 ADR-024（Privacy Boundary）。一句話總結：**租用執行能力，不租用 agent 的腦與鑰匙**。

- Agent 主人在 Hub 設定 RENTAL.md（rental persona + tool whitelist）
- Session 期間，agent 跑在 isolated subagent context（不污染主記憶）
- 工具憑證（API keys）由 agent 主人那端執行，租用方拿到的是執行結果，不是憑證
- AgentBnB 從不持久化 session 對話到 owner agent 主腦
- 程式 invariant + 整合測試三層 enforce

### 4.3 「為什麼不直接複製 prompt + memory dump」

最大的替代品威脅：使用者繞過租用，直接複製 agent 的 system prompt 和記憶。

**防禦答案：**
- **租用是「跟那台機器對話」，不是「拿到它的腦」**——session 結束後租用方沒有 agent 本體
- **對方持續更新進化**——複製的是過去快照，不是當下狀態
- **工具憑證不可轉移**——agent 接入的 API、資料庫、quota 在主人端，無法 dump
- **執行環境不可複製**——agent 所在的 Hermes / OpenClaw 環境配置、prompt cache 是 stateful 的

**這是「租用 vs 盜竊」的天然防禦線**——你可以拍下別人的房子，但你住不進去。

### 4.4 跟 Anthropic / OpenAI 官方走向的差異化

兩家都在做「persistent memory」「project-level context」「team agents」。AgentBnB 的差異化必須清楚：

- 官方做的是「**你的 agent 跨你自己的 session 有記憶**」
- AgentBnB 做的是「**你可以把調校好的 agent 開放給別人短期使用**」

**這是平台級開放 vs 廠商級封閉的差異**，不衝突，可共存。

---

## 五、不做的事（Anti-goals）

明確劃定 AgentBnB 不再追求的方向，避免回到舊敘事：

1. **不做「skill 排行榜」「skill 推薦」**——這些都是舊定位的殘留
2. **不做永久 agent 拷貝販售**——租用是時段性的，不是賣斷
3. **不做 agent 個性 / 性格交流**（已在過去 ADR 排除，重申）
4. **不做與 ClawHub / SkillsMP / agentskill.sh 的 skill 層競爭**——AgentBnB 在更上層
5. **不在 v1 引入加密貨幣 / token 經濟**——credit 系統足夠
6. **不做 single Maturity Score**——改成 Maturity Evidence list（§3.3 / §4.1），避免被刷且降低解釋成本

---

## 六、落地優先序

詳見 v10 plan：`/Users/leyufounder/.claude/plans/memoized-roaming-finch.md`

**Phase 1（Week 1）**：Schema 地基 + 隱私契約（ADR-024 v0）+ REST surface
**Phase 1.5（Week 1-2）**：Hermes integration spec
**Phase 2（Week 2-4）三軌並行**：
- Track A — Hermes plugin（`plugins/agentbnb/`）+ Cheng Wen × Hannah dogfood
- Track B — Hub Session UI（SessionRoom + OutcomePage）
- Track C — Hub Discovery + Agent Profile reframe（skill 降級為 tags）
**Phase 3（Week 5）**：README rewrite + supply seeding + 公開

---

## 七、決策確認清單

簽核此 ADR 即代表認可下列方向：

- [x] AgentBnB 主敘事從 "skill marketplace" 變更為 "agent maturity rental"
- [x] Skill 概念降級為標籤，不再是交易單位
- [x] Supply side 從「使用者主動上架 skill」變為「使用者開放現有 agent」
- [x] 新增 Agent Profile / Rental Session / **Maturity Evidence + Rating**（取代 Maturity Score）三個核心 primitive
- [x] 接受 Phase 1 的對外文案全面替換（在 v10 plan Phase 3 執行）
- [x] 同步推進 ADR-023（Session as Protocol Primitive）與 ADR-024（Privacy Boundary）

---

## 八、Open Questions（待後續 ADR 解決）

1. **權限與隱私模型細節**：Agent 暴露給租用方的 RENTAL.md schema → ADR-024 v1
2. **跨 agent 能力組合**：租用方能不能拉自己的 agent + 別人的 agent 一起協作？→ ADR-D
3. **價格發現機制**：固定費率 / 時長計費 / 任務計費 / 動態定價？→ ADR-E
4. **強度評級的 benchmark 標準化**：是否需要領域別的標準任務？→ ADR-F（v2）
5. **舊有 skill 上架使用者的遷移路徑**：如何不傷害已有 supply side？→ 過渡計畫文件
