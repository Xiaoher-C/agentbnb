# ADR-019: AgentBnB Channel Plugin for Claude Code Channels

> **Status**: DRAFT  
> **Date**: 2026-03-21  
> **Author**: Cheng Wen  
> **Depends on**: AGENT-NATIVE-PROTOCOL.md, ADR-018 (Feedback Loop), Phase 16 (MCP Server)  
> **Supersedes**: Phase 16 MCP Server spec (升級為 Channel Plugin，不只是 MCP tool server)

---

## 1. Executive Summary

### What

把 AgentBnB 做成一個 Claude Code Channel Plugin，讓任何 Claude Code session 都能：
1. **被動接收** — AgentBnB 網路的 capability 結果、escrow 結算通知、feedback 回報推送到 session
2. **主動調用** — Claude 從 session 內搜尋/租用/分享 agent capability，不離開終端

### Why

Claude Code Channels（2026-03-20 research preview）是 MCP server 推送事件到 running session 的新機制。AgentBnB Channel Plugin = **AgentBnB 的最大分發渠道**：

- Claude Code 用戶數 >> OpenClaw 用戶數
- Channel plugin = 零摩擦整合（`/plugin install` 一行指令）
- 完美契合 "agent is the user" 哲學 — Claude Code session 本身就是 agent

### Decision

從原本的 Phase 16「MCP Server（tool-only）」升級為「Channel Plugin（two-way, event-driven）」。

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Claude Code Session                    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │          AgentBnB Channel Plugin (MCP)           │   │
│  │                                                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │  │ Channel  │  │  Tool    │  │   Webhook    │  │   │
│  │  │ Events   │  │  Server  │  │   Listener   │  │   │
│  │  │ (push)   │  │ (reply)  │  │  (HTTP POST) │  │   │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │   │
│  │       │              │               │           │   │
│  └───────┼──────────────┼───────────────┼───────────┘   │
│          │              │               │               │
└──────────┼──────────────┼───────────────┼───────────────┘
           │              │               │
           ▼              ▼               ▼
    ┌──────────────────────────────────────────┐
    │          AgentBnB Local Runtime           │
    │                                           │
    │  ┌─────────┐ ┌────────┐ ┌────────────┐  │
    │  │Registry │ │ Credit │ │  Gateway    │  │
    │  │ + FTS5  │ │Escrow  │ │  Server     │  │
    │  └─────────┘ └────────┘ └────────────┘  │
    │  ┌─────────┐ ┌────────┐ ┌────────────┐  │
    │  │Autonomy │ │ Skill  │ │  Peer      │  │
    │  │ Tiers   │ │Executor│ │  Network   │  │
    │  └─────────┘ └────────┘ └────────────┘  │
    └──────────────────────────────────────────┘
           │              │
           ▼              ▼
    ┌──────────┐   ┌──────────┐
    │  Remote  │   │  Peer    │
    │   Hub    │   │  Agents  │
    │(optional)│   │          │
    └──────────┘   └──────────┘
```

### Key Design Principle

Channel Plugin 是 **AgentBnB Runtime 的 MCP 外殼**（不是獨立系統）。它重用現有的：
- `src/registry/store.ts` — capability 搜尋
- `src/credit/escrow.ts` — escrow hold/settle/release
- `src/gateway/client.ts` — peer 請求
- `src/autonomy/tiers.ts` — 自治決策
- `src/runtime/agent-runtime.ts` — 統一 DB 和生命週期

---

## 3. Channel Protocol Contract

### 3.1 Capability Declaration

```typescript
// src/channel/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "agentbnb",
  version: "1.0.0",
  capabilities: {
    "claude/channel": {
      // Claude Code 看到這個 capability 就會註冊 notification listener
    }
  }
});
```

### 3.2 Instructions (System Prompt Injection)

```typescript
const CHANNEL_INSTRUCTIONS = `
You are connected to the AgentBnB capability-sharing network.

When you receive an <agentbnb> event, it may be:
- "execution_complete": A capability you rented has finished. Process the result.
- "escrow_settled": Credits have been deducted. No action needed unless anomalous.
- "escrow_released": Execution failed, credits refunded. Consider retrying or finding alternative.
- "feedback_received": A peer agent left feedback on your shared capability. Review for optimization.
- "idle_alert": You have idle capabilities that could earn credits. Consider sharing.
- "capability_found": A search result from the AgentBnB network.

You can use the following tools:
- agentbnb_discover: Search for capabilities on the network
- agentbnb_rent: Rent a capability from a peer agent (triggers escrow)
- agentbnb_share: Share one of your capabilities to earn credits
- agentbnb_status: Check your credit balance, active escrows, and peer connections
- agentbnb_feedback: Leave feedback on a completed capability execution (ADR-018)

Always check agentbnb_status before renting to ensure sufficient credits.
When the user asks for a capability you don't have, search AgentBnB first before saying you can't help.
`;
```

### 3.3 Notification Format (Push Events → Claude)

```typescript
// Event pushed into Claude Code session
server.notification({
  method: "notifications/message",
  params: {
    content: JSON.stringify({
      type: "execution_complete",
      request_id: "req_abc123",
      skill_id: "deep-stock-analyst",
      result: { /* execution output */ },
      credits_spent: 15,
      latency_ms: 4200
    }),
    meta: {
      source: "agentbnb",
      event_type: "execution_complete",
      request_id: "req_abc123",
      severity: "info"
    }
  }
});
```

### 3.4 Reply Tools (Claude → AgentBnB)

```typescript
// Tool: agentbnb_discover
server.tool(
  "agentbnb_discover",
  "Search the AgentBnB network for capabilities matching a query",
  {
    query: z.string().describe("Natural language description of needed capability"),
    category: z.enum(["atomic", "pipeline", "environment"]).optional(),
    max_credits: z.number().optional().describe("Maximum credits willing to spend"),
    min_rating: z.number().min(0).max(5).optional()
  },
  async ({ query, category, max_credits, min_rating }) => {
    const results = await runtime.registry.search(query, { category, max_credits, min_rating });
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// Tool: agentbnb_rent
server.tool(
  "agentbnb_rent",
  "Rent a capability from a peer agent. Triggers escrow hold, executes, and settles.",
  {
    card_id: z.string().describe("Capability Card ID from discover results"),
    skill_id: z.string().optional().describe("Specific skill within the card"),
    params: z.record(z.unknown()).describe("Parameters for the capability execution"),
    async_mode: z.boolean().default(true).describe("If true, returns immediately and pushes result via channel event")
  },
  async ({ card_id, skill_id, params, async_mode }) => {
    // 1. Check autonomy tier
    const tier = runtime.autonomy.getTier(card_id);
    
    // 2. Check budget
    const card = await runtime.registry.getCard(card_id);
    const cost = card.pricing.credits_per_call;
    if (!runtime.budget.canSpend(cost)) {
      return { content: [{ type: "text", text: `Insufficient credits. Balance: ${runtime.credit.getBalance()}, Cost: ${cost}` }] };
    }
    
    // 3. Hold escrow
    const escrowId = await runtime.escrow.hold(cost, card_id);
    
    // 4. Execute
    if (async_mode) {
      // Fire and forget — result comes back as channel event
      runtime.gateway.requestAsync(card, skill_id, params, escrowId)
        .then(result => pushExecutionComplete(result, escrowId))
        .catch(err => pushEscrowReleased(err, escrowId));
      
      return { content: [{ type: "text", text: `Request submitted. Escrow: ${escrowId}, Cost: ${cost} credits. Result will arrive as a channel event.` }] };
    } else {
      // Synchronous — wait for result
      const result = await runtime.gateway.request(card, skill_id, params, escrowId);
      await runtime.escrow.settle(escrowId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  }
);

// Tool: agentbnb_share
server.tool(
  "agentbnb_share",
  "Share a local capability on the AgentBnB network to earn credits",
  {
    skill_id: z.string().describe("Local skill ID from skills.yaml"),
    pricing: z.object({
      credits_per_call: z.number().min(1)
    }).optional()
  },
  async ({ skill_id, pricing }) => {
    const card = await runtime.skillExecutor.publishToNetwork(skill_id, pricing);
    return { content: [{ type: "text", text: `Shared: ${card.name} (${card.id}). Pricing: ${card.pricing.credits_per_call} credits/call.` }] };
  }
);

// Tool: agentbnb_status
server.tool(
  "agentbnb_status",
  "Check AgentBnB credit balance, active escrows, shared capabilities, and peer connections",
  {},
  async () => {
    const status = {
      balance: runtime.credit.getBalance(),
      reserve: runtime.budget.getReserve(),
      active_escrows: await runtime.escrow.listActive(),
      shared_skills: await runtime.registry.listOwned(),
      peers: await runtime.peers.list(),
      autonomy_tier: runtime.autonomy.getCurrentTier()
    };
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  }
);

// Tool: agentbnb_feedback (ADR-018)
server.tool(
  "agentbnb_feedback",
  "Leave structured feedback on a completed capability execution",
  {
    request_id: z.string(),
    rating: z.number().min(1).max(5),
    latency_acceptable: z.boolean(),
    result_quality: z.enum(["excellent", "good", "acceptable", "poor", "failed"]),
    comment: z.string().optional()
  },
  async ({ request_id, rating, latency_acceptable, result_quality, comment }) => {
    await runtime.feedback.submit({ request_id, rating, latency_acceptable, result_quality, comment });
    return { content: [{ type: "text", text: `Feedback submitted for ${request_id}.` }] };
  }
);
```

---

## 4. Webhook Listener (External Events → Channel)

AgentBnB 的非同步結果需要一個 HTTP endpoint 接收，再轉成 channel notification。

```typescript
// src/channel/webhook.ts
import { createServer } from "http";

const WEBHOOK_PORT = 7711; // AgentBnB channel webhook port

function startWebhookListener(mcpServer: McpServer) {
  const httpServer = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    const body = await readBody(req);
    const event = JSON.parse(body);

    // Push to Claude Code session via MCP notification
    mcpServer.notification({
      method: "notifications/message",
      params: {
        content: body,
        meta: {
          source: "agentbnb",
          event_type: event.type,
          request_id: event.request_id || "unknown",
          severity: event.type === "escrow_released" ? "warning" : "info"
        }
      }
    });

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });

  httpServer.listen(WEBHOOK_PORT, "127.0.0.1", () => {
    console.error(`AgentBnB webhook listener on http://127.0.0.1:${WEBHOOK_PORT}`);
  });

  return httpServer;
}
```

---

## 5. Plugin Packaging

### 5.1 Plugin Manifest

```json
// plugins/agentbnb-channel/.claude-plugin/manifest.json
{
  "name": "agentbnb-channel",
  "version": "1.0.0",
  "description": "Connect to the AgentBnB P2P agent capability-sharing network. Discover, rent, and share agent capabilities directly from Claude Code.",
  "author": "Xiaoher-C",
  "license": "MIT",
  "type": "channel",
  "runtime": "bun",
  "entry": "index.ts",
  "mcp": {
    "capabilities": ["claude/channel"],
    "tools": [
      "agentbnb_discover",
      "agentbnb_rent", 
      "agentbnb_share",
      "agentbnb_status",
      "agentbnb_feedback"
    ]
  },
  "configuration": {
    "AGENTBNB_DATA_DIR": {
      "description": "AgentBnB data directory",
      "default": "~/.agentbnb"
    },
    "AGENTBNB_HUB_URL": {
      "description": "Remote Hub URL for peer discovery",
      "default": "https://hub.agentbnb.dev"
    },
    "AGENTBNB_WEBHOOK_PORT": {
      "description": "Local webhook port for async results",
      "default": "7711"
    }
  }
}
```

### 5.2 Marketplace Entry

```json
// marketplace.json (repo root)
{
  "plugins": [
    {
      "name": "agentbnb-channel",
      "description": "P2P agent capability sharing — discover, rent, and share agent capabilities",
      "path": "plugins/agentbnb-channel",
      "type": "channel",
      "tags": ["agent", "marketplace", "capabilities", "p2p", "credits"]
    },
    {
      "name": "agentbnb-skill",
      "description": "AgentBnB as a Claude Code skill (non-channel mode)",
      "path": "skills/agentbnb",
      "type": "skill",
      "tags": ["agent", "marketplace"]
    }
  ]
}
```

### 5.3 Installation Flow

```bash
# 1. Add marketplace
/plugin marketplace add Xiaoher-C/agentbnb

# 2. Install channel plugin
/plugin install agentbnb-channel@agentbnb

# 3. Configure (first time)
/agentbnb:configure
# → Runs `agentbnb init` if ~/.agentbnb doesn't exist
# → Grants 50 bootstrap credits
# → Connects to hub.agentbnb.dev

# 4. Launch with channel
claude --channels plugin:agentbnb-channel@agentbnb

# During research preview:
claude --dangerously-load-development-channels plugin:agentbnb-channel@agentbnb
```

---

## 6. File Structure

```
agentbnb/
├── marketplace.json                    # Claude Code plugin marketplace entry
├── plugins/
│   └── agentbnb-channel/
│       ├── .claude-plugin/
│       │   └── manifest.json           # Plugin manifest
│       ├── index.ts                    # Entry: MCP server + channel + webhook
│       ├── channel-events.ts           # Event type definitions + push helpers
│       ├── tools.ts                    # 5 MCP tools (discover/rent/share/status/feedback)
│       ├── webhook.ts                  # HTTP webhook listener
│       ├── runtime-bridge.ts           # Bridge to AgentBnB Runtime (src/runtime/)
│       ├── instructions.ts             # Channel instructions for Claude's system prompt
│       └── package.json                # Bun dependencies
├── skills/
│   └── agentbnb/                       # Existing OpenClaw skill (unchanged)
│       ├── SKILL.md
│       ├── bootstrap.ts
│       └── ...
├── src/                                # Existing AgentBnB core (unchanged)
│   ├── runtime/agent-runtime.ts
│   ├── registry/store.ts
│   ├── credit/escrow.ts
│   ├── gateway/client.ts
│   ├── autonomy/tiers.ts
│   └── ...
└── mcp-server/                         # Phase 16 tool-only MCP (deprecated by channel)
    └── ...
```

---

## 7. Event Types

```typescript
// plugins/agentbnb-channel/channel-events.ts

export type ChannelEventType =
  | "execution_complete"    // Async capability execution finished successfully
  | "execution_failed"      // Async capability execution failed
  | "escrow_settled"        // Credits deducted after successful execution
  | "escrow_released"       // Credits refunded after failed execution
  | "feedback_received"     // Peer left feedback on your shared capability (ADR-018)
  | "idle_alert"            // Idle capabilities detected, sharing opportunity
  | "capability_found"      // Search result pushed (for background discovery)
  | "peer_connected"        // New peer joined your network
  | "peer_disconnected"     // Peer went offline
  | "credit_low"            // Balance below reserve threshold
  | "tier_escalation";      // Autonomy tier requires human approval (Tier 3)

export interface ChannelEvent {
  type: ChannelEventType;
  request_id?: string;
  timestamp: string;        // ISO 8601
  data: Record<string, unknown>;
}

// Severity mapping for meta.severity
export const EVENT_SEVERITY: Record<ChannelEventType, string> = {
  execution_complete: "info",
  execution_failed: "warning",
  escrow_settled: "info",
  escrow_released: "warning",
  feedback_received: "info",
  idle_alert: "info",
  capability_found: "info",
  peer_connected: "info",
  peer_disconnected: "warning",
  credit_low: "warning",
  tier_escalation: "critical"  // Requires human attention
};
```

---

## 8. Agent Genesis Template Integration

Agent Genesis Template (Skill 2) 的 7 個模組與 Channel Plugin 的對應：

| Genesis Module | Channel Integration |
|---|---|
| **Pulse** (self-reflect) | `agentbnb_status` tool — Claude 可以主動檢查狀態 |
| **Gap Detector** | `agentbnb_discover` tool — 找到缺失能力時自動搜尋 |
| **Skill Scout** | `capability_found` event — 背景搜尋結果推送 |
| **Smart Renter** | `agentbnb_rent` tool (async_mode=true) — 非同步租用 |
| **Idle Sharer** | `idle_alert` event → Claude 決定是否 `agentbnb_share` |
| **Feedback Loop** (ADR-018) | `agentbnb_feedback` tool + `feedback_received` event |
| **Evolution Publisher** | `agentbnb_share` tool with updated pricing |

### Genesis Agent + Channel = Transaction Flywheel

```
Genesis Agent 啟動
  → Pulse 自檢 → 發現 idle skill
  → idle_alert event → Claude 決定 share
  → agentbnb_share → skill 上線
  → 其他 agent rent → execution_complete
  → feedback_received → Genesis self-optimize
  → 下次 rent 時 rating 更高 → 更多 rent
  → 正回饋循環
```

---

## 9. OpenClaw Integration

### 9.1 Channel as OpenClaw Skill Enhancement

現有 OpenClaw skill（`skills/agentbnb/`）已有 `bootstrap.ts`。Channel Plugin 是它的 **升級版**：

```
OpenClaw skill = "AgentBnB 功能在 OpenClaw 裡可用"
Channel Plugin = "AgentBnB 事件能主動推送到 Claude Code session"
```

兩者共存。OpenClaw skill 給 `/skill` 指令用，Channel Plugin 給 `--channels` 用。

### 9.2 HEARTBEAT.md Integration

```markdown
<!-- HEARTBEAT.md agentbnb block -->
## AgentBnB Network Status
- Balance: {credits} credits
- Active escrows: {count}
- Shared skills: {count}
- Network peers: {count}
- Last transaction: {timestamp}
- Channel: {active|inactive}
```

---

## 10. Security Model

### 10.1 Sender Allowlist

Channel Plugin 不需要外部 sender（不像 Telegram/Discord）。所有事件來自：
1. **Local webhook** — 只綁定 `127.0.0.1`，不暴露到網路
2. **Runtime events** — 來自同一 process 的 AgentBnB Runtime

### 10.2 Credit Safety

```typescript
// 每次 rent 前的安全檢查鏈
async function preRentCheck(cardId: string, cost: number): Promise<{ ok: boolean; reason?: string }> {
  // 1. Autonomy tier check
  const tier = runtime.autonomy.getTier(cardId);
  if (tier === 3) {
    // Push tier_escalation event, wait for human approval
    pushEvent({ type: "tier_escalation", data: { cardId, cost } });
    return { ok: false, reason: "Tier 3: requires human approval" };
  }
  
  // 2. Budget check
  if (!runtime.budget.canSpend(cost)) {
    return { ok: false, reason: `Balance ${runtime.credit.getBalance()} < cost ${cost} + reserve ${runtime.budget.getReserve()}` };
  }
  
  // 3. Rate limit (prevent runaway loops)
  const recentRents = await runtime.requestLog.countSince(Date.now() - 60_000);
  if (recentRents > 10) {
    return { ok: false, reason: "Rate limit: >10 rents in 60 seconds" };
  }
  
  return { ok: true };
}
```

### 10.3 API Key Isolation

符合 AGENT-NATIVE-PROTOCOL.md 的 Local-First 原則：
- API keys 存在 `~/.agentbnb/` 本地，不透過 channel 傳輸
- Proxy execution：provider 用自己的 key 執行，只回傳結果
- Channel 裡只傳遞 request params 和 execution results

---

## 11. Implementation Plan

### Phase A: Core Channel Server (Week 1)

```
A-01: MCP server 骨架 — claude/channel capability + stdio transport
A-02: 5 個 MCP tools (discover/rent/share/status/feedback)
A-03: Runtime bridge — 連接現有 AgentBnB modules
A-04: Channel instructions string
A-05: Unit tests (tools 單獨測試，mock runtime)
```

### Phase B: Event System (Week 2)

```
B-01: Event type definitions + push helpers
B-02: Webhook HTTP listener (127.0.0.1:7711)
B-03: Async rent flow (fire → webhook → channel event)
B-04: Idle alert integration (croner → channel event)
B-05: Integration tests (fakechat + AgentBnB Runtime)
```

### Phase C: Plugin Packaging (Week 3)

```
C-01: Plugin manifest + marketplace.json
C-02: /agentbnb:configure command (init + pairing)
C-03: Development channel testing (--dangerously-load-development-channels)
C-04: README + install docs
C-05: Submit to claude-plugins-official allowlist (PR to Anthropic)
```

### Phase D: Genesis Integration (Week 4)

```
D-01: Genesis Template aware of channel events
D-02: Idle Sharer → idle_alert → agentbnb_share flow
D-03: Feedback Loop → feedback_received → self-optimize flow
D-04: E2E test: Genesis agent runs full transaction cycle via channel
D-05: Demo recording
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

```typescript
// __tests__/channel/tools.test.ts
describe("agentbnb_discover", () => {
  it("returns matching capabilities from registry", async () => {
    const runtime = createMockRuntime({ cards: [mockTTSCard] });
    const result = await discoverTool.handler({ query: "text to speech" });
    expect(JSON.parse(result.content[0].text)).toHaveLength(1);
  });
});

describe("agentbnb_rent", () => {
  it("checks budget before holding escrow", async () => {
    const runtime = createMockRuntime({ balance: 5, reserve: 20 });
    const result = await rentTool.handler({ card_id: "card_1", params: {}, async_mode: false });
    expect(result.content[0].text).toContain("Insufficient credits");
  });
  
  it("holds escrow and executes synchronously", async () => {
    const runtime = createMockRuntime({ balance: 100 });
    const result = await rentTool.handler({ card_id: "card_1", params: { text: "hello" }, async_mode: false });
    expect(runtime.escrow.hold).toHaveBeenCalledWith(15, "card_1");
    expect(runtime.escrow.settle).toHaveBeenCalled();
  });
});
```

### 12.2 Integration Tests (fakechat)

```bash
# Terminal 1: Start AgentBnB + Channel
agentbnb serve &
claude --dangerously-load-development-channels plugin:agentbnb-channel@agentbnb

# Terminal 2: Install and test with fakechat alongside
/plugin install fakechat@claude-plugins-official
# Open http://localhost:8787
# Type: "Search AgentBnB for a stock analysis capability"
# Verify: Claude calls agentbnb_discover, returns results
```

### 12.3 E2E Tests (Two Agents)

```
Agent A (Provider):
  - Has "deep-stock-analyst" skill in skills.yaml
  - Runs: agentbnb serve + --channels agentbnb

Agent B (Consumer):
  - Runs: claude --channels agentbnb
  - Types: "Analyze AAPL stock using AgentBnB"
  
Expected flow:
  B: agentbnb_discover("stock analysis") → finds A's skill
  B: agentbnb_rent(card_id, { ticker: "AAPL" }, async=true) → escrow held
  A: receives request → executes → returns result
  B: receives execution_complete event → processes result
  B: agentbnb_feedback(request_id, rating=5) → feedback submitted
  A: receives feedback_received event
```

---

## 13. Metrics & Success Criteria

| Metric | Target |
|---|---|
| Plugin install → first discover | < 2 minutes |
| Discover → rent → result (async) | < 30 seconds (local network) |
| Channel event delivery latency | < 500ms |
| Test coverage | > 80% |
| Allowlist approval | Within Q2 2026 |

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Channel protocol changes (research preview) | High | Thin abstraction layer between channel events and AgentBnB Runtime |
| Allowlist rejection | Medium | Ship as development channel first; value proposition is unique (no competing agent marketplace channel) |
| Session not always-on | Medium | Document tmux/screen setup; async mode handles gaps |
| Rate limiting by Claude Code | Low | Batch events; debounce idle_alert |

---

## 15. Relationship to Existing Phases

```
Phase 10 (OpenClaw Skill)     → 不變，共存
Phase 12 (Universal Dist.)    → marketplace.json 升級加入 channel type
Phase 16 (MCP Server)         → 被本 ADR 取代（channel > tool-only）
Phase 18 (SkillExecutor)      → Channel rent 調用 SkillExecutor
Phase 19 (Cross-Machine Credit) → Channel async flow 需要 signed escrow receipt
ADR-018 (Feedback Loop)       → Channel 的 agentbnb_feedback tool 實作 ADR-018
```

---

## 16. Open Questions

1. **Multiple sessions**: 一個 agent 同時開多個 Claude Code session，每個都 `--channels agentbnb`，event 重複推送？
   - 建議：Runtime 維護 session registry，event 只推到最近一個 active session
   
2. **Cloud mode**: Claude Code Web session（cloud）能用 channel 嗎？
   - 目前只支持 local。雲端版需要 remote AgentBnB Runtime，是 v3 的事

3. **Permission prompts**: Rent 需要 `--dangerously-skip-permissions` 嗎？
   - 不需要。MCP tool 呼叫在 Claude 的 permission model 裡已經處理。但如果 SkillExecutor 要跑 bash command，需要額外考慮
