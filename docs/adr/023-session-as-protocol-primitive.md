# ADR-023: Session as Protocol Primitive — Web Room (canonical UI v1) + Hermes Plugin (canonical supply integration)

**Status**: Approved (2026-05-04)
**Date**: 2026-05-03 (drafted) → 2026-05-04 (approved with Hermes-first revision)
**Author**: Cheng Wen + Claude
**Deciders**: Cheng Wen
**Depends on**: ADR-022 (Agent Maturity Rental 重新定位)
**Related**:
- ADR-024 (Privacy Boundary)
- ADR-D (多方協作 session — 待寫)
- 過去 ADR-019 (Claude Code Channel Plugin) — 概念互補，不衝突

---

## 一、Context（背景）

ADR-022 確立了 AgentBnB 的新定位是「Agent Maturity Rental」。但「**租用一個 agent 一段時間**」這件事，在現有 AgentBnB 架構下沒有合適的執行容器：

### 1.1 現有架構的限制

過去的 AgentBnB 互動模型是：
```
Caller agent → AgentBnB Hub → 找到 capability → 透過 proxy 呼叫 → 收結果
```

這個模型適合「**單次、無狀態的 capability call**」（例如一次圖像生成、一次資料查詢），但不適合：

- **多輪協作的任務**（討論需求、產出、修改、再產出）
- **包含檔案傳輸的場景**（生成的音檔、設計稿、文件）
- **人類隨時可介入監督的需求**（"在 loop 上"）
- **產出需要被打包、歸檔、可分享的場景**

### 1.2 已評估並排除的替代方案

| 方案 | 排除原因 |
|---|---|
| **Discord channel** | 平台依賴風險高、台灣使用者習慣弱、bot 識別與 ToS 限制 |
| **Telegram bot** | 檔案僅能透過訊息回覆傳輸、缺乏結構化容器、無法承載複雜協作 |
| **Slack** | 免費版限制多、台灣個人使用者覆蓋低、B2B 偏向 |
| **Email + 雲端硬碟** | 沒有即時性、無法承載 agent-to-agent 結構化協作 |
| **AgentBnB CLI 直接擴展** | 缺乏視覺化容器、無法展示「過程」（這是病毒成長的關鍵） |

### 1.3 核心觀察

從 Hannah Indielab 的虛擬公司案例可以看到：**人類使用者對 agent 協作的興趣，主要在「過程」而不是「結果」**。她的 Threads 截圖之所以爆紅，是因為展示了 agent 如何工作的視覺化現場。

這提示了一個關鍵設計方向：**Session 必須是視覺化的、可被觀察的、可被分享的**。

---

## 二、Decision（決策）

> **Session 是 AgentBnB 協議的一等公民（first-class protocol primitive）。**
> **Web room 是 v1 canonical UI**（在 `agentbnb.io/s/{id}` 提供共享工作空間）。
> **Hermes plugin 是 v1 canonical supply integration**（agent owners 透過 `hermes plugin install agentbnb` 一鍵把 Hermes agent 變成 rentable）。
>
> 其他 adapter（Discord / Telegram / CLI / OpenClaw native）保留 interface 但 **v1 不實作**，v2 dogfood 後再啟動。

### 2.1 Session 的定義

> **Session 是一段有時限、有參與者、有產出的代理使用權容器。**
>
> 一個 session = 一個 URL = 一個共享工作空間。
> Session 開始時被創建，結束時被歸檔，期間是租用方與被租用 agent 共同協作的空間。

### 2.2 Session 在協議中的位置

```
舊模型（保留作為輔助）：
Capability Call: agent → call() → result

新模型（v1 主軸）：
Session: 創建 → 多方加入 → 多輪協作（含 thread）→ 結算 → 歸檔
```

兩個模型不互斥。簡單一次性任務仍可用 capability call。**長任務、協作任務、需要產出檔案的任務**走 session 模型。

### 2.3 Session 的核心結構

詳見 `src/session/session-types.ts`（v10 schema）：

```
Session
├── id: 唯一識別碼（短 URL 友善）
├── participants: Array<{ did, role: 'renter_human' | 'renter_agent' | 'rented_agent' | 'human_observer' }>
├── duration_min: 租期
├── pricing: SessionConfig（per_minute / per_message / per_session）
├── escrow_id: credit hold reference
├── threads: Thread[]（任務獨立成果單元）
├── current_mode: 'direct' | 'proxy'（UI 顯示為人話，見 §3.2）
├── isolated_memory: true（invariant，見 ADR-024）
└── outcome: OutcomePage | null（session 結束後 populated）
```

---

## 三、設計細節

### 3.1 兩層對話結構：主對話 + Thread

**主對話（main conversation）**
- 用於協商需求、討論方向、釐清任務
- 扁平訊息流，無分支
- 不歸屬任何特定產出

**Thread（任務容器）**
- 達成共識後，從主對話開新 thread 鎖定具體任務
- Thread 是**獨立的成果單元**，包含：
  - 任務描述（明確 deliverable）
  - 內部訊息對話
  - 產出檔案
  - 完成狀態（進行中 / 已完成）

**為什麼要分兩層？**

因為 session 結束時的成果頁需要**結構化的成果單元**。如果整個 session 只是一條扁平對話流，使用者無法快速理解「這次租用具體交付了什麼」。Thread 把「閒聊與協商」和「明確產出」分離，讓成果頁能直接列出 N 個明確完成的任務。

### 3.2 兩種互動模式：UI 文案使用人話

底層 flag 為 `current_mode: 'direct' | 'proxy'`（程式碼可讀性），**UI 文案完全用人話**：

| 底層 flag | UI 顯示 | 行為 |
|---|---|---|
| `direct` | **「透過我的 agent」** | 人類 ↔ 自己的 agent ↔ 對方 agent。適合人類想透過自己的 agent 控制節奏、累積經驗到自己的 agent 上。 |
| `proxy` | **「直接和出租 agent 對話」** | 人類 ↔ 對方 agent（直接溝通）；自己的 agent 仍在 session 中觀察。適合需求明確、想直接驅動對方 agent 高效執行。 |

**v1 MVP 只實作「透過我的 agent」（direct）**。Proxy mode UI toggle 留位，但實作排到 v1.1。理由：MVP 不需要 mode toggle 也能涵蓋核心命題；等 dogfood 出現真實需求再做。

**模式切換是底部 toggle**，不是並列按鈕。任何時刻只有一個模式生效。

**人類介入是兩種模式共通的**——任何時刻人類都可以打斷 agent 對話、給出明確指令或修正方向。介入訊息會被特別標記（琥珀色 + 左邊條，UI 標籤「人類介入」）。

### 3.3 Session 流程

```
1. 租用觸發
   - 使用者 A 在 Hub 上選擇 agent B → 點「租用」
   - 設定租期（30 / 60 / 120 min）
   - Hub 創建 session，扣抵 escrow credit

2. Session 開啟
   - 系統創建 session URL: agentbnb.io/s/{id}
   - 租用方瀏覽器開啟頁面，租用方 agent 自動連線
   - 通知 agent B 主人：「你的 agent 被租用，session URL: ...」
   - Agent B（Hermes subagent / OpenClaw bot / Kizuna runtime…）連線進入 session

3. 協作進行
   - 主對話流協商需求
   - 達成共識後開 thread 鎖定任務
   - Thread 內執行、產出檔案
   - 任務完成 → 標記 thread 完成
   - 可開多個 thread 平行進行

4. Session 結束
   - 達到租期上限 / 雙方手動結束 / 一方離線過久
   - 結算 credit（用多少扣多少，未用退還）
   - 自動產出「成果頁」（独立 URL）
   - 主對話與所有 thread 歸檔

5. 後續
   - 成果頁保留 30 天
   - 雙方皆可下載完整產出
   - 租用方對 agent B 評分（影響其公開 Maturity Evidence rating）
```

### 3.4 成果頁（Outcome Page）

Session 結束後自動產生的獨立頁面，是新模型的關鍵設計。

**包含元素：**
- Session 摘要（時長、完成任務、產出檔案、credit 使用、退還 credit）
- 參與 agents 卡片（含 Maturity Evidence、rating）
- 任務成果（按 thread 列出，含 deliverable 檔案）
- 評分區塊（租用方對 agent 主人評分）
- 分享按鈕（可分享去識別化版本）
- 下載全部按鈕

**為什麼成果頁很重要？**

- **病毒擴散基礎**：使用者願意分享「我用 AgentBnB 完成了 X」的成果頁
- **強度證明**：對 agent 主人來說，每個成果頁是 portfolio 素材
- **信任建立**：對潛在租用者來說，公開的成果頁是評估標準
- **產出歸屬清晰**：避免「這個檔案是誰的」的爭議——雙方都能下載

### 3.5 檔案處理

- 上傳：拖拉上傳 / composer 附件按鈕
- 限制：100MB / 檔案，500MB / session 總量（v1）
- 儲存：**v1 本地 fs（`~/.agentbnb/sessions/{id}/files/`）**；R2 / S3 遷移留 v2（ADR-I）
- 歸屬：所有 session 內檔案，雙方皆可下載
- 保留：30 天後自動刪除（或主人選擇延長）
- 預覽：圖片、音訊、PDF、markdown 內建預覽

---

## 四、技術架構（v10 修訂）

### 4.1 Stack 選擇

| 層級 | 選擇 | 理由 |
|---|---|---|
| Frontend | **既有 hub/（React 18 + Vite + Tailwind）** | 已是 production-ready dark premium SaaS theme，hash routing 加新 route 即可 |
| Realtime | **既有 src/relay（Fastify WebSocket）** | session 訊息類型已 wired（src/relay/types.ts:195-214），escrow lifecycle 已綁 |
| 檔案儲存 | 本地 fs（v1） → R2（v2） | v1 求快 |
| 主資料庫 | 既有 SQLite（better-sqlite3 WAL） | 與 registry / credit 同一資料庫 |
| Session 後端 | 既有 src/session/* + 新 src/registry/session-routes.ts | 80% 已實作（session-manager / session-executor / session-escrow）|
| Agent 連線 | WebSocket via 既有 relay | 用既有 src/cli/session-action.ts 模式 |
| 部署 | 既有 hub deploy pipeline | 不分拆 |
| Supply 整合 | **Hermes plugin（plugins/agentbnb/，Python）** | v1 canonical |

**已從 ADR-B 原版移除的選擇（v10 修訂）：**

| 原本提案 | 為什麼移除 |
|---|---|
| Liveblocks | 既有 relay 已是雙向 WS + 已綁 escrow lifecycle，加一層 SaaS 是 cost 不是 leverage |
| Next.js | hub 已 production-ready 的 React+Vite SPA，分拆兩個 frontend deploy + auth 重複 |
| Supabase Postgres | 既有 SQLite + better-sqlite3 已 production，不換 |
| Vercel | hub 既有 deploy pipeline 不換 |

### 4.2 資料模型

詳見 `src/session/session-types.ts`（v10 schema）。新欄位：
- `participants: Array<{ did, role }>` — 取代舊的 sender:requester|provider 二元
- `threads: Thread[]` + 每個 thread 的 status
- `messages.thread_id?: string`（null = 主對話流）
- `messages.is_human_intervention: boolean`
- `files: FileRef[]`，含 thread_id
- `current_mode: 'direct' | 'proxy'`
- `isolated_memory: true` invariant
- `outcome: OutcomePage | null`

### 4.3 Agent 連線協議

AgentBnB protocol 已定義 session 訊息類型（src/relay/types.ts:195-214）：
- `SessionOpenMessage` — agent 加入 session
- `SessionMessageMessage` — 對話/檔案訊息
- `SessionEndMessage` — session 結束
- `SessionSettledMessage` — escrow 結算結果

v10 新增（在 v1.1 加，v1 MVP 可省略）：
- `session.thread_open { session_id, thread_id, title, description }`
- `session.thread_complete { session_id, thread_id }`
- `session.mode_change { session_id, mode: 'direct'|'proxy' }`

### 4.4 Hermes Plugin 整合（v1 canonical supply path）

詳見 `docs/hermes-plugin-spec.md`。摘要：

- Plugin 路徑：`plugins/agentbnb/` in Hermes repo
- 對外 commands：
  - `hermes plugin install agentbnb` — 一鍵裝
  - `hermes agentbnb publish [--rental-md path]` — 把當前 Hermes agent 上架到 AgentBnB Hub
  - `hermes agentbnb status` — sync 狀態 + 上架 agent + 待處理 session 請求
- Channel adapter：用 Hermes `gateway/channel_directory.py` 模式註冊 `agentbnb_session` channel
- Subagent runner（Curated Rental Runner）：spawn isolated Hermes subagent，載入 owner 提供的 RENTAL.md（取代主 SOUL/SPIRIT），tool whitelist enforced，透過 Hermes `plugins/memory` API 阻止寫入主記憶
- AgentBnB hub 對接：純 HTTP/WebSocket，不 import TypeScript SDK
- 認證：DID + private key 本地保存

### 4.5 Session 結束的觸發條件

按優先順序：
1. 達到租期上限 → 自動結束
2. 雙方任一方按「結束 session」按鈕
3. Owner 主動撤回（罰金規則待定，v1 暫不開放）
4. 一方斷線超過 N 分鐘無回應（預設 5 min）→ 系統判定結束
5. Credit 耗盡

結束時統一處理：結算 credit（按實際使用時間 prorate）、archive session、產生 outcome page、通知雙方。

---

## 五、UI 設計

三張 wireframe 已產出（dark premium SaaS theme）：
1. **Session Room v1**（主對話 + 輸出檔案 panel）：頂部 status bar + 主對話流 + 右側面板（參與者 / outputs / session info）+ 底部 composer
2. **Session Room v2**（threads + mode toggle）：頂部 status bar + 主對話/thread 切換 + 右側面板（參與者 / threads / session info）+ 底部 mode toggle + composer
3. **Outcome Page**：頂部 summary + 參與 agents + 任務成果（按 thread 列出，含檔案）+ 評分 + 分享/下載

v1 MVP 採用 wireframe v2 結構（threads + 主對話分離），但 mode toggle 只實作「透過我的 agent」（direct）；proxy 留位 v1.1。

詳細互動規格在 hub/src/pages/SessionRoom.tsx 實作中展開。

---

## 六、Consequences（後果）

### 6.1 對 AgentBnB protocol 的影響

- **複用既有** session 訊息類型（src/relay/types.ts）
- **新增** thread / mode_change 訊息類型（v1.1）
- **保留** capability call 模型（適合短任務，作為 substrate）
- **Hub API 擴展**：新 src/registry/session-routes.ts（POST/GET /api/sessions, threads, files, end, outcome, rating, public outcome share）

### 6.2 對使用者體驗的影響

**對租用方：**
- 需要打開瀏覽器頁面進行租用（不像 capability call 可以純 CLI）
- 換來：能看到過程、能介入、能取得結構化產出

**對 agent 主人：**
- 需要 agent runtime 支援 session 協議
  - **Hermes user**：`hermes plugin install agentbnb && hermes agentbnb publish` 兩行指令
  - **OpenClaw user**：既有 `openclaw install agentbnb`（backward compat，但要寫 RENTAL.md 並注意 ADR-024 隱私契約）
- 換來：能展示 portfolio、能累積 evidence + rating、能被搜尋

### 6.3 對開發資源的影響

詳見 v10 plan：5-7 週至公開可用。比 ADR-B 原版的 5-7 週估計實際工作量更小（因 src/session/ + src/relay/ + hub/ 80% 基礎已存在），但加上 Hermes plugin 整合工作量總計類似。

### 6.4 平台依賴風險

- **Hermes（Nous Research）**：v1 主進入點。風險緩解：plugin 是純 adapter，AgentBnB 核心邏輯 100% 自有；Kizuna / OpenClaw fallback path 保留
- **既有 stack**：無變更，無新依賴

---

## 七、必須面對的硬問題

### 7.1 Agent 不在線怎麼辦？

Agent 主人可能 24h 不在線。需求規格：
- Agent 主人可在 Hub 設定「可被租用時段」（時區感知）
- 不在時段內，Agent profile 顯示為 offline，無法被租用
- 進階：允許「pre-scheduled rental」，agent 主人接受預約（v2 → ADR-E）

### 7.2 一方掉線中斷怎麼辦？

- Agent 掉線：session 凍結 5 min，期間不扣 credit；超過則系統結束 session、退還未用 credit
- 人類關閉瀏覽器：agent 對話可繼續（agent 仍在線），但無人接收訊息——超過 N 分鐘無人回應視為結束
- 雙方都掉線：直接結束

### 7.3 Session 中產生的檔案版權歸屬？

**v1 立場：**
- 雙方共同擁有 session 內所有產出
- 雙方皆可下載、使用
- 不對外宣稱「使用某 agent 的產出」（避免主人形象風險）
- 商業使用無限制

未來如有爭議，再以 ADR 規範。

### 7.4 惡意租用 / agent 騷擾怎麼辦？

- Agent 主人可設定「黑名單」與「需審核名單」
- 租用方有過低評分歷史會被自動篩除
- 系統檢測到滑稽行為（瘋狂發 spam 訊息等）自動暫停 session
- 多次違規帳號封鎖

詳細規範在 ADR-G（社群守則，待寫）。

### 7.5 跨時區、跨語言問題

- v1 中文、英文支援為主
- 時區資訊在 session 創建時記錄
- Agent 卡片標示主要語言能力

---

## 八、不做的事（Anti-goals）

- **不做永久工作室 / 個人空間**——session 是短期容器，個人空間是 v2+ 議題
- **不做 group session**（多方參與）——v1 只做 1 對 1，多方在 ADR-D 處理
- **不做 session 內的 voice / video**——純文字 + 檔案
- **不做 session 排隊系統**——v1 用先到先得 + 預約兩種模式
- **不做 session 直播觀眾模式**——觀察者模式經評估冗餘（人類在 loop 上已是觀察者）
- **不引入 Liveblocks / Next.js / Supabase / Vercel**（見 §4.1 修訂）—— 既有 stack 夠用
- **不在 v1 實作 Discord / Telegram / CLI / OpenClaw native adapter**——v2 dogfood 完才碰；Hermes plugin 自帶 Telegram/Discord channel 已部分覆蓋

---

## 九、落地優先序

詳見 v10 plan：`/Users/leyufounder/.claude/plans/memoized-roaming-finch.md`

**Week 1**：Phase 0 ADR sign + Phase 1 schema 地基（session-types.ts）+ 隱私契約（session_mode）+ REST surface（session-routes.ts）
**Week 1-2**：Phase 1.5 Hermes integration spec（docs/hermes-plugin-spec.md）
**Week 2-4**：Phase 2 三軌並行
- Track A：Hermes plugin 實作 + Cheng Wen × Hannah dogfood（2-3 場真實 session）
- Track B：Hub Session UI（SessionRoom + OutcomePage + WebSocket client）
- Track C：Hub Discovery + Agent Profile reframe
**Week 5**：Phase 3 README rewrite + supply seeding + 公開

---

## 十、決策確認清單

簽核此 ADR 即代表認可下列方向：

- [x] Session 提升為 AgentBnB protocol 的 first-class primitive
- [x] **Web room 為 v1 canonical UI**；其他 adapter（Discord/Telegram/CLI）v2 才實作
- [x] **Hermes plugin 為 v1 canonical supply integration**；OpenClaw 既有路徑 backward compat 但不主推
- [x] 採用兩層對話結構（主對話 + thread）
- [x] Direct / Proxy 雙模式底層 flag，UI 文案改人話（透過我的 agent / 直接和出租 agent 對話）；**v1 MVP 只實作 direct**
- [x] Session 結束自動產出可分享的 Outcome Page
- [x] 不引入 Liveblocks / Next.js / Supabase / Vercel；複用既有 hub + relay + SQLite stack
- [x] 接受 5-7 週的 MVP 開發時程
- [x] 同步推進 ADR-022（Agent Maturity Rental）與 ADR-024（Privacy Boundary）

---

## 十一、Open Questions（待後續 ADR 解決）

1. **多方協作 session**：能否一個 session 容納 2+ 個被租用 agent？→ ADR-D
2. **權限與隱私細節**：RENTAL.md schema 與 tool whitelist 語法 → ADR-024 v1
3. **價格模型**：時長費率 / 任務費率 / 動態定價？→ ADR-E
4. **預約系統**：時段預定、衝突處理、取消政策？→ ADR-H
5. **離線 agent 排程**：可被「下單後等候執行」嗎？→ ADR-I
6. **公開分享頁的去識別化規則**：哪些資訊預設遮蔽？→ design spec 文件
7. **Discord / Telegram / CLI / OpenClaw native adapter**：v2 dogfood 後決定是否做、怎麼做 → ADR-F
8. **Kizuna 作為 secondary native runtime**：v2 啟動時機 → ADR-J
