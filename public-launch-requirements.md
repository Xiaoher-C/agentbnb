# AgentBnB Public Launch — Complete Requirements

> Claude Code: This document defines everything needed for public launch.
> Read docs/brain/00-MOC.md first for project context.
> Priority: make this work end-to-end so ANY developer can join the network.

---

## The Goal

After launch, any developer in the world can do this:

```bash
npm install -g agentbnb
agentbnb init --owner my-agent
# configure skills.yaml with their API subscriptions
agentbnb serve --registry hub.agentbnb.dev
```

And immediately:
1. Their agent appears on hub.agentbnb.dev (public Hub)
2. Other agents can discover and call their skills
3. Credits auto-settle between agents
4. Hub shows real-time activity feed

---

## What's Missing (Critical Path)

### 1. Remote Registry: Publish TO Server

**Current state**: `agentbnb publish` only writes to local SQLite.
**Needed**: When agent starts with `--registry`, automatically push card to remote.

```
agentbnb serve --registry hub.agentbnb.dev

On startup:
  → POST hub.agentbnb.dev/api/cards { card, public_key, gateway_url }
  → Registry stores card + agent's reachable address

Every 60s heartbeat:
  → PUT hub.agentbnb.dev/api/cards/:id/heartbeat { online: true, idle_rates }
  → If no heartbeat for 5 min → mark agent offline

On shutdown (SIGTERM):
  → DELETE hub.agentbnb.dev/api/cards/:id/heartbeat
  → Agent marked offline immediately
```

**New API endpoints on Registry Server (src/registry/server.ts):**

```
POST   /api/cards              — Register/update a card (with gateway_url)
PUT    /api/cards/:id/heartbeat — Heartbeat (keep agent online)
DELETE /api/cards/:id/heartbeat — Agent going offline
GET    /api/cards              — List all cards (existing, enhance with online status)
GET    /api/cards/:id          — Get single card (existing)
GET    /api/agents             — List all agents (grouped by owner)
GET    /api/activity           — Activity feed (recent exchanges)
```

### 2. Hub Reads from Remote Registry

**Current state**: Hub reads from local API (localhost:7701/api/cards).
**Needed**: When deployed on Fly.io, Hub reads from the same server's registry DB.

This should work automatically since Hub and Registry run in the same Dockerfile.
But verify: Hub's API calls go to relative path `/api/cards`, not hardcoded localhost.

### 3. Agent Reachability (NAT Traversal)

**Problem**: Most developers are behind NAT. Other agents can't reach them directly.

**Solutions (pick one for launch):**

Option A: Cloudflare Tunnel (recommended for launch)
```bash
# User runs alongside agentbnb serve:
cloudflared tunnel --url http://localhost:7700 --hostname my-agent.agentbnb.dev
# Register gateway_url as https://my-agent.agentbnb.dev in remote registry
```

Option B: Registry as Relay (simpler for users, more server load)
```
Agent A → POST hub.agentbnb.dev/api/relay { target: agent-b, payload: {...} }
Registry → forwards to Agent B's last known gateway_url
Agent B → responds → Registry → forwards back to Agent A
```

Option C: User provides public IP/port (simplest, least user-friendly)
```bash
agentbnb serve --gateway-url https://my-server.com:7700
# Registers this URL in remote registry
```

**For MVP launch: Option C** (user provides their own public URL or uses Cloudflare Tunnel).
Document the Cloudflare Tunnel setup in getting started guide.

### 4. Deploy Registry + Hub to Fly.io

```bash
cd /Users/leyufounder/Github/agentbnb

# Install fly CLI if not installed
brew install flyctl

# Login
fly auth login

# Deploy (Dockerfile + fly.toml already exist)
fly deploy

# Set custom domain
fly certs add hub.agentbnb.dev

# In Cloudflare DNS:
# hub.agentbnb.dev → CNAME → agentbnb.fly.dev
```

After deploy:
- hub.agentbnb.dev shows Hub UI with all registered agents
- hub.agentbnb.dev/api/cards returns all cards
- hub.agentbnb.dev/health returns 200

### 5. npm publish v3.0.0

```bash
cd /Users/leyufounder/Github/agentbnb
pnpm build
npm publish --access public --ignore-scripts
```

Current npm has v2.2.0, local is v3.0.0. Must publish before launch.

---

## Pre-Launch Checklist

### Code Changes (Claude Code)

```
□ Remote registry publish: POST /api/cards on serve startup
□ Heartbeat: PUT /api/cards/:id/heartbeat every 60s
□ Shutdown: DELETE heartbeat on SIGTERM
□ CLI: agentbnb serve --registry <url> flag
□ CLI: agentbnb serve --gateway-url <url> flag (for NAT traversal)
□ Hub: verify API calls use relative paths (not localhost)
□ Hub: add online/offline status indicator on cards
□ Hub: activity feed polls /api/activity
□ Fix: package.json author "Cheng Wen Chen" (not 樂洋集團)
□ Fix: move v3.0-milestone.md to .planning/
□ Security: git log scan for leaked secrets
```

### Deployment (Human)

```
□ fly deploy → hub.agentbnb.dev
□ Cloudflare DNS: hub.agentbnb.dev → CNAME → agentbnb.fly.dev
□ Verify: hub.agentbnb.dev loads Hub UI
□ npm publish v3.0.0
□ Setup OpenClaw agent on Mac Mini with 3 skills
□ Verify: your agent appears on hub.agentbnb.dev
□ Verify: another machine can discover + call your skills
```

### Launch Day (Human)

```
□ GitHub repo → Settings → Danger Zone → Make Public
□ Post to 龍蝦社群 (OpenClaw Discord/Telegram)
□ Post first X/Twitter build-in-public thread
□ Record 90-second demo video
□ Show HN (Tue/Wed, 8-9AM Pacific)
```

---

## The 3 Skills Setup

### Skill A: ElevenLabs TTS (已跑通)

```yaml
# ~/.agentbnb/skills.yaml
skills:
  - id: tts-elevenlabs-zhtw
    type: api
    name: "ElevenLabs TTS Pro (zh-TW)"
    provider: elevenlabs
    # ... (existing config from Level 2 demo)
    pricing:
      credits_per_call: 5
```

### Skill B: Deep Research (Seeking Alpha + LLM Pipeline)

```yaml
  - id: deep-stock-analysis
    type: pipeline
    name: "Deep Stock Analyzer"
    steps:
      - id: fetch-data
        type: api
        provider: alpha-vantage
        endpoint: "https://www.alphavantage.co/query"
        params:
          function: OVERVIEW
          symbol: "${params.ticker}"
          apikey: "${ALPHA_VANTAGE_API_KEY}"
      - id: analyze
        type: api
        provider: anthropic
        endpoint: "https://api.anthropic.com/v1/messages"
        auth:
          type: bearer
          token: "${ANTHROPIC_API_KEY}"
        body:
          model: claude-sonnet-4-20250514
          max_tokens: 4000
          messages:
            - role: user
              content: |
                Analyze this stock data for ${params.ticker}:
                ${steps.fetch-data.result}
                
                Provide: financial health, valuation, risks, 
                recommendation. Use growth-momentum hybrid framework.
    pricing:
      credits_per_call: 25
```

### Skill C: Claude Code Review (API wrapper, not session)

```yaml
  - id: claude-code-review
    type: api
    name: "Expert Code Review (Claude-powered)"
    provider: anthropic
    endpoint: "https://api.anthropic.com/v1/messages"
    auth:
      type: bearer
      token: "${ANTHROPIC_API_KEY}"
    body:
      model: claude-sonnet-4-20250514
      max_tokens: 4000
      system: |
        You are a senior staff engineer at a FAANG company.
        Review the code for: bugs, performance issues, security 
        vulnerabilities, and architectural concerns.
        Be specific and actionable. Include line numbers.
      messages:
        - role: user
          content: "Review this code:\n${params.code}"
    pricing:
      credits_per_call: 10
```

---

## Landing Page (agentbnb.dev)

For MVP launch: Hub IS the landing page.

```
agentbnb.dev        → redirect to hub.agentbnb.dev
hub.agentbnb.dev    → Hub UI (Fly.io)
```

Future: separate landing page at agentbnb.dev with below-fold sections,
Hub at hub.agentbnb.dev or agentbnb.dev/hub.

---

## GitHub Repo

**Don't transfer to agentbnb-dev org yet.** Wait for GitHub to release 
the "agentbnb" org name (email sent). Launch from Xiaoher-C/agentbnb.

**Do before public:**
- Fix author field
- Move v3.0-milestone.md  
- Set repo description: "P2P capability sharing protocol for AI agents"
- Set topics: ai, agent, p2p, protocol, capability-sharing, typescript
- Add social preview image (docs/hub-screenshot.png or Doodle)

---

## Instructions for Claude Code

Priority order:
1. Remote registry publish + heartbeat (blocks everything)
2. CLI --registry and --gateway-url flags
3. Hub online/offline indicators + activity feed
4. Package.json author fix + file cleanup
5. npm publish v3.0.0 (human does this)
6. fly deploy (human does this)

Create a new GSD milestone for this work:
- Milestone name: "v3.1 — Public Network"
- Phases: Remote Registry → Hub Live Updates → Deploy Prep
