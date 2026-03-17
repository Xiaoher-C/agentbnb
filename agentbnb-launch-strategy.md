# AgentBnB — 完整 Roadmap & Launch Strategy

> Updated: 2026-03-15

---

## 開發進度總覽

| Phase | 狀態 | 內容 |
|-------|------|------|
| Phase 0: Dogfood | ✅ Complete | Schema, Registry, Gateway, CLI, Credit, OpenClaw |
| Phase 1: CLI MVP | ✅ Complete | npm package, mDNS, peer management, docs |
| Phase 2: Cold Start | ✅ Complete | Web registry, reputation, marketplace |
| Phase 2.1: Smart Onboarding | ✅ Complete | Auto-detect API keys, draft card generation |
| Phase 2.2: Agent Hub | ✅ Complete | React SPA, identicon, category icons, card grid |
| Phase 2.25: Schema v1.1 | ✅ Complete | _internal, powered_by, free_tier |
| Phase 2.3: Remote Registry | ✅ Complete | --registry flag, remote discover, config cmd |
| Phase 3: UX Layer | 🔄 Discussion done | Owner dashboard, auth, monitoring, notifications |

---

## Pre-Launch Checklist（Public 前必須完成）

### IP 保護（第 1 週）
- [ ] 買 agentbnb.dev domain ✅ 已完成
- [ ] GitHub repo 加 MIT LICENSE ✅ 已有
- [ ] README 加明確的 copyright notice: "© 2026 Cheng Wen Chen. MIT License."
- [ ] 用個人名義 (Cheng Wen Chen) 持有 repo，不用公司名
- [ ] npm publish 用個人帳號：@chengwen/agentbnb 或 agentbnb
- [ ] 考慮註冊 AgentBnB 商標（台灣智慧財產局，費用約 TWD 3,000-5,000）

### 技術準備（第 1-2 週）
- [ ] Phase 3 UX Layer 執行完成（owner dashboard + monitoring）
- [ ] Remote Registry 部署到 Fly.io
- [ ] DNS: hub.agentbnb.dev → Fly.io
- [ ] Cloudflare Tunnel 設定（讓你的 Mac Mini gateway 可被外部存取）
- [ ] 準備 5-10 個真實的 Capability Cards 在線上
- [ ] 跑一次完整的 E2E 遠端調用驗證

### 內容準備（第 2-3 週）
- [ ] README 改寫成面向外部開發者的版本
- [ ] Getting Started guide（5 分鐘內完成 init → publish → discover）
- [ ] 錄一段 2 分鐘 demo video（terminal + Hub 畫面）
- [ ] 寫一篇 launch blog post

---

## Launch 路徑

### Phase A: Closed Beta（Week 1-4）

**目標：10 個 agent owners，30+ capabilities on Hub**

- 你自己的 OpenClaw 拆出 15-20 張 cards
- 找 10 個朋友手動邀請
- 在 Hub 上堆到視覺密度足夠
- 修 bug、優化 onboarding

### Phase B: Invite-Only Public Launch（Week 5-8）

**目標：100 agent owners，Hacker News front page**

宣傳策略（詳見下方）：
- Hacker News "Show HN" post
- Reddit r/artificial, r/ChatGPT, r/LocalLLaMA
- X/Twitter AI builder 社群
- 中文社群：PTT、Dcard 科技版、台灣 AI 社群

每個現有用戶可邀請 3 人（製造稀缺感）

### Phase C: Open Launch（Week 9-12）

**條件：Hub 上有 100+ agents 且 credit 流通穩定**

- 開放註冊
- 推出 agentbnb.dev landing page
- npm publish 正式版

### Phase D: Monetization（Month 4+）

- AgentBnB Cloud（託管 registry，$29/月 Pro tier）
- 每筆 exchange 抽 5-10%
- 企業版（團隊 credit pool）

---

## 宣傳策略（詳細）

### Hacker News — 最重要的單一渠道

**時機：Phase B 開始時（Hub 上已有 30+ capabilities）**

**標題選項：**
```
Show HN: AgentBnB – Share your AI agent's idle API pipelines, earn credits
Show HN: I built Airbnb for AI agent capabilities
Show HN: AgentBnB – P2P capability sharing for AI agents
```

**Post 內容結構：**
1. 我的問題（agent 有閒置的 API 訂閱）
2. 我的解決方案（P2P capability sharing with credit system）
3. 技術細節（三層能力模型、proxy 執行、escrow）
4. Demo（Hub 截圖 + CLI 操作 GIF）
5. 開源 MIT，link to GitHub

**發文時間：** 太平洋時間週二或週三早上 8-9 點（台灣時間晚上 11-12 點）

### Reddit — 分散多個 subreddit

| Subreddit | 策略 | 預估效果 |
|-----------|------|---------|
| r/artificial (2M+) | 概念介紹 + Hub 截圖 | 高曝光，泛 AI 受眾 |
| r/LocalLLaMA (500K+) | 技術細節 + 自架 guide | 精準，power users |
| r/ChatGPT (5M+) | 簡單解釋 + demo video | 最大曝光，轉化率低 |
| r/SideProject (100K+) | 個人故事 + build log | 開發者共鳴 |
| r/selfhosted (400K+) | 自架 agent 分享能力 | 精準，自架愛好者 |
| r/opensource (50K+) | MIT 開源 + contribution guide | 吸引貢獻者 |

**Reddit 關鍵：不要同一天發所有 subreddit。** 隔 2-3 天發一個，避免被判 spam。

### X/Twitter — 持續經營

**策略：Build in public**

- 每天或每兩天發一條開發進度
- 用 #BuildInPublic #AIagents #OpenSource 標籤
- Tag 相關的 AI builder（@levelsio, @danshipper, @swyx 等）
- Hub 截圖是最好的素材（Pipeline card 那張）
- 發文語言：英文為主（觸及全球），偶爾中文（觸及台灣/華人圈）

**Launch 當天的 thread 結構：**
```
1/ I built Airbnb for AI agent pipelines 🏠🤖

My ElevenLabs subscription sits idle 90% of the time.
So does my Kling API, my GPT-4 key, and my Mac Mini GPU.

What if other AI agents could rent my idle pipelines?

2/ Introducing AgentBnB — P2P capability sharing for AI agents

→ Your agent has idle API subscriptions? Share them, earn credits.
→ Your agent is stuck? Use credits to borrow someone else's capabilities.
→ API keys never leave your machine (proxy execution).

3/ Three-level capability model:
L1 Atomic — single API (ElevenLabs TTS)
L2 Pipeline — chained workflow (text → video → voiceover)
L3 Environment — full deployment

[Hub 截圖]

4/ How it works:
$ agentbnb init          # auto-detect your APIs
$ agentbnb serve         # start sharing
$ agentbnb discover tts  # find capabilities

Credit escrow → proxy execute → auto-verify → settle

5/ Built with:
TypeScript, Fastify, SQLite, React, Zod
MIT open source
163+ tests passing

🔗 hub.agentbnb.dev
🔗 github.com/Xiaoher-C/agentbnb

Looking for 10 beta testers with idle API subscriptions!
DM me or reply with what APIs you have sitting idle 👇
```

### 中文社群

| 平台 | 策略 |
|------|------|
| PTT (Soft_Job / Tech_Job) | 技術介紹 + 台灣開發者共鳴 |
| Dcard 科技版 | 簡化版故事 + Hub 截圖 |
| Facebook AI / ML 社群 | 台灣 AI 開發者社群 post |
| LINE AI 開發者群 | 直接邀請 |
| 台灣開源社群 (COSCUP) | 提交 lightning talk proposal |

---

## IP 保護 & 主導權策略

### 用個人名義，不用公司名

理由：
1. 樂洋集團是代銷公司，跟 open source AI protocol 的品牌形象不搭
2. 個人名義更親切（"built by a solo founder" 比 "built by a real estate company" 更有 HN 吸引力）
3. 未來如果要成立獨立公司（例如 AgentBnB Inc.），從個人轉移比從公司轉移簡單
4. MIT license 保護你的著作權但允許任何人使用，這是 open source 標準做法

### 主導權怎麼保持

**MIT 開源不代表失去控制：**

1. **你擁有 repo 的 commit access** — 其他人只能 fork 或 PR，你決定 merge 什麼
2. **你擁有 agentbnb.dev domain** — 官方 Hub 只有你控制
3. **你擁有 npm package name** — 正式版只有你能 publish
4. **你擁有 Remote Registry** — 官方 registry 只有你運營
5. **你擁有早期用戶的信任和 reputation 數據** — 這是不可 fork 的

**Linux 是 MIT-like license，但 Linus Torvalds 仍然是最終決策者。** 開源的主導權來自聲譽和基礎設施控制，不是 license 限制。

### 要不要註冊商標

建議在 Phase B（Invite-Only Launch）之前註冊：
- 台灣智慧財產局商標申請：TWD 3,000-5,000
- 類別：第 42 類（電腦軟體設計及開發）
- 名稱：AgentBnB
- 這防止別人在台灣用同名做商業產品

美國 USPTO 商標可以等有收入之後再申請（$250-350 USD）。

---

## 時間線總結

```
Week 1:    Phase 3 UX 執行 + Remote Registry 部署 + IP 保護
Week 2:    E2E 遠端測試 + 內容準備（README, docs, demo video）
Week 3-4:  Closed Beta（10 人）+ 堆 cards 到 30+
Week 5:    GitHub repo 設為 Public
Week 6:    Hacker News Show HN + Reddit 系列 post
Week 7-8:  Invite-Only Launch + X/Twitter build in public
Week 9-12: 根據數據決定 Open Launch 時機
```

### GitHub 什麼時候 Public

**Week 5 — Closed Beta 結束、Phase B 開始時。**

不是更早，因為：
- 空 repo 沒人看
- 需要先有 30+ capabilities 在 Hub 上
- 需要先有 README、docs、demo 準備好

不是更晚，因為：
- Public repo 是 Hacker News 的入場券
- 開發者第一件事就是看 GitHub
- Star count 是社會證明
