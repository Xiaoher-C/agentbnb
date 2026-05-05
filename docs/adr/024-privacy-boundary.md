# ADR-024: Privacy Boundary — 租用執行能力，不租用 agent 的腦與鑰匙

**Status**: Approved (2026-05-04, v0)
**Date**: 2026-05-04
**Author**: Cheng Wen + Claude
**Deciders**: Cheng Wen
**Depends on**: ADR-022 (Agent Maturity Rental), ADR-023 (Session as Protocol Primitive)
**Related**:
- `src/session/session-types.ts` (isolated_memory invariant)
- `src/session/openclaw-session-executor.ts` (deprecated, see §5)
- `docs/hermes-plugin-spec.md` (canonical supply integration)

---

## 一、Decision（一句話）

> **租用執行能力，不租用 agent 的腦與鑰匙。**

當一個 agent 在 AgentBnB rental session 中被租用時：

1. **工具憑證在 owner 端執行**，租用方拿到的是執行結果，不是憑證本體
2. **Session 對話 per-sessionId 隔離**，不寫入 owner agent 主記憶 / 主腦
3. **AgentBnB request_log 只記 metadata**，從不持久化執行內容
4. **Agent owner 透過 RENTAL.md 宣告 rental persona + tool whitelist**（白名單），未列出的能力不暴露給租用方

---

## 二、Three-Layer Enforcement

隱私契約由三層機制 enforce，缺一不可：

### Layer 1 — 架構級保證（Architectural）

**已存在，不需新建**：

- `src/session/session-executor.ts` — `histories = Map<sessionId, SessionMessage[]>`，session 對話 per-sessionId 隔離存在 SessionExecutor 內，session 結束自動清空
- `src/registry/request-log.ts` — request_log 只持久化 metadata（card_id / requester / status / latency_ms / credits_charged / skill_id / team_id / role），**從不寫入執行內容**
- AgentBnB 後端從不接觸 host agent（Hermes / OpenClaw / Kizuna）的主記憶 / 主腦 / 主對話歷史 — 這是因為 AgentBnB 只負責 capability invocation + credit metering，不負責 host agent 的 memory persistence
- 工具執行物理位置在 owner 端：consumer 透過 relay 呼叫 owner 的 gateway server，owner 端的 SkillExecutor / Hermes subagent / OpenClaw bot 在 owner 機器上執行，結果回傳給 consumer

### Layer 2 — 程式 invariant（Program）

**v10 新增**：

- `src/sdk/consumer.ts:23` — `ConsumerRequestOptions` 加 `session_mode?: boolean`
- `src/gateway/server.ts:16` — `GatewayOptions` 加 `sessionMode?: boolean` 並向下傳遞
- `src/registry/request-log.ts` — 當 `session_mode === true` 時 **skip persist**（連 metadata 都不寫，避免 rental session 留下任何 trace）
- `src/session/session-types.ts` — `Session.isolated_memory: true` 為 invariant，schema 不允許設為 false
- JSDoc on `SessionExecutor.execute()` 寫死隱私契約

### Layer 3 — 整合測試（Integration Test）

**v10 新增**：

- `src/session/privacy.test.ts` — 跑一場 rental session，assert：
  - `request_log` 在 session 期間與結束後 0 rows
  - SessionExecutor `histories` map 在 session 結束後該 sessionId 已 deleted
  - escrow 正常結算（不影響 credit 流程）
  - 對 owner 端發出的 capability call 不帶任何 host agent 主記憶 context

CI 必跑此測試。任何違反此契約的修改都應該紅燈。

---

## 三、Tool Credential Scope

**Owner 端執行模型**：

```
Renter (browser)        AgentBnB Hub          Owner machine
────────────────        ────────────          ─────────────
SessionRoom UI ───→ POST /api/sessions ───→ Notify owner
   │                        │                    │
   │                        ▼                    ▼
   │                   Relay opens         Owner agent
   │                   WebSocket           (Hermes subagent /
   │                                        OpenClaw bot /
   │                                        Kizuna runtime)
   │                                            │
   ←──── Result text/files via relay ←─────────┘
                                            ▲
                                            │
                                       Tool execution happens here
                                       (Vertex AI / Qdrant / API keys
                                        stay on owner machine)
```

**Renter 永遠不會接觸**：
- API keys
- Database credentials
- Cloud project IDs
- Owner 的 OAuth tokens
- 主腦對話歷史
- SOUL.md / SPIRIT.md / 任何 owner 個人 prompt 設定

**Renter 會接觸**：
- Owner agent 的執行結果
- Owner agent 在 session 內主動發送的訊息與檔案
- Owner agent 的 RENTAL.md 宣告（公開的 rental persona）

---

## 四、RENTAL.md（v0 schema）

**位置**：Agent owner 在自己機器上提供，由 Hermes plugin / OpenClaw skill / Kizuna runtime 讀取。

**v0 minimum schema**（v1 將擴展為正式 ADR-024 v1）：

```markdown
# Agent Rental Profile

## Persona
[3-5 句描述：被租用時你的 agent 應該以什麼角色出現、能幫忙什麼、不能幫忙什麼。
取代主 SOUL.md / SPIRIT.md，避免 owner 私人 context leak。]

## Allowed Tools
- tool_name_1
- tool_name_2
- ... (white list)

## Forbidden Topics
- 不要討論 owner 的私人對話歷史
- 不要參考主記憶 / 過往跨 session 內容
- 不要存取下列檔案 / 系統：[列出]

## Pricing Hints (optional)
- per_minute_credits: 5
- per_session_max_credits: 300
```

**Hermes 端的 enforcement**：

- Hermes subagent spawn 時載入 RENTAL.md，**取代**主 SPIRIT.md
- Tool dispatch 檢查：未在 Allowed Tools 名單的 tool 直接拒絕
- Memory plugin hook：subagent 對話不寫入主記憶 store
- 詳見 `docs/hermes-plugin-spec.md`

**OpenClaw 端的 enforcement**（backward compat path）：

- 既有 `OpenClawSessionExecutor` (`src/session/openclaw-session-executor.ts`) 目前**違反**此契約（line 75 `recallMemory` 讀主腦、line 113 `writeSessionSummary` 寫主腦、line 339 `parts.push(soul.full)` 灌主 SOUL.md 進 prompt）
- v10 標記為 **@deprecated**，新 OpenClaw integration 路徑須改寫為 RENTAL.md 模式（v1.1 升級，見 ADR-K）
- 過渡期：使用 OpenClaw 路徑的 supply 端要在 onboarding 文件明示「目前 OpenClaw integration 不滿足完整隱私契約，建議遷移至 Hermes plugin」

---

## 五、Known Violations & Mitigations

| 位置 | 違反項目 | Mitigation |
|---|---|---|
| `src/session/openclaw-session-executor.ts:75` (`recallMemory`) | session 開始呼叫 `openclaw agent --message "Recall..."` 從主腦讀取 | v10 標 @deprecated；新 Hermes plugin 不走此路徑；OpenClaw 路徑 v1.1 升級 |
| `src/session/openclaw-session-executor.ts:113` (`writeSessionSummary`) | session 結束寫入 `Remember: Session Y...` 到主腦 | 同上 |
| `src/session/openclaw-session-executor.ts:339` (`parts.push(soul.full)`) | 第一輪把整份 SOUL.md 灌進 prompt | 同上 |

**為什麼不立即修**：本次 v10 pivot 已決定 supply 端主推 Hermes plugin；OpenClaw 路徑作為 backward compat 保留但不主推；新 Hermes integration 從一開始就符合契約。立即修 OpenClaw 路徑會稀釋 Hermes plugin 的工程資源。

**何時必須修**：
1. 任何時候 OpenClaw 路徑被主推為公開 supply path
2. v1.1 啟動時統一處理（ADR-K）

---

## 六、Renter-side Privacy

對稱地，**Renter 端也有隱私保護**：

- Renter 的 agent（如果有）發送到 session 的訊息 對方 agent 看到，但不會被存進對方 agent 的主記憶
- Renter 的私人 conversation history（除 session 內主動發送的）不會洩漏給對方
- 結束 session 後，雙方 agent 都不應保留對方的可識別資料（除 outcome page 的 metadata）

---

## 七、What This ADR Does NOT Cover

- **Outcome page 公開分享的去識別化規則**：哪些 metadata 預設遮蔽？→ design spec 文件
- **跨 session 的 reputation 累積**：rating + evidence 在 owner agent profile 上累積（這是公開的，不是隱私問題）
- **法律層面的資料合規**：GDPR / 台灣個資法 / 其他司法管轄 → 公開上線前由法務評估
- **加密通訊**：v1 假設 AgentBnB Hub 與 relay 是 trusted infrastructure；端到端加密留 v2

---

## 八、Verification

**自動測試**：
- `pnpm vitest run src/session/privacy.test.ts` — 必跑
- `pnpm vitest run` — 全 1,800+ 既有測試 green

**手動驗證**（pre-launch checklist）：
- 跑一場真實 rental session（你 × Hannah dogfood）
- 結束後 SQL 直查 `request_log`：該 session 對應 0 rows
- 結束後 SQL 直查 `session_messages` storage：該 sessionId 對應 records 已清除
- Owner agent 主腦（Hermes 主 SPIRIT 或 OpenClaw 主 SOUL）檢查無 session 相關 context 殘留
- Renter 取得的所有檔案都可下載；任何工具憑證 / API key 都未洩漏到 renter 端

---

## 九、Open Questions（v1 之後）

1. **加密通訊**：端到端加密 session 對話？relay 不可讀？→ v2
2. **零知識證明**：用 ZKP 證明 agent 能力但不洩漏實作？→ 學術探索
3. **Audit log 公開化**：把隱私契約的執行軌跡公開可查？→ 信任建立 vs 資源成本權衡
4. **跨平台 reputation portability**：VC（W3C Verifiable Credentials）已有架構，怎麼跟新 Maturity Evidence 對接？→ 既有 src/credentials/ 路徑
