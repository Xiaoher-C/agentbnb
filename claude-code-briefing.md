# AgentBnB — Claude Code Briefing (2026-03-16)

> Drop this file in your agentbnb project root. Claude Code should read this FIRST before any further work.

---

## 1. CRITICAL: Push AGENT-NATIVE-PROTOCOL.md to Repo

Copy AGENT-NATIVE-PROTOCOL.md (provided separately) to the project root.
This is the design bible for all future development decisions.

**Core insight: The user of AgentBnB is not the human. The user is the agent.**

Every feature must pass this test: "Does this require human intervention? If yes, redesign so the agent can do it."

---

## 2. Update CLAUDE.md

The current CLAUDE.md says "Phase: 0 — Dogfood". This is 36 plans behind reality.

Update to reflect:
- v1.1 Milestone: 8/8 phases complete, 24 plans, 302+ tests
- v2.0 Milestone: 5/5 phases complete (Phase 4-8), 12 plans
- Current state: Pre-launch preparation
- Agent-first philosophy from AGENT-NATIVE-PROTOCOL.md
- Multi-skill Capability Card schema v2.0 (skills[] array)
- Autonomy tiers (Tier 1/2/3, default Tier 3)
- IdleMonitor, AutoRequestor, BudgetManager
- OpenClaw integration (soul-sync, heartbeat-writer, SKILL.md package)
- Hub at /hub with React SPA
- Domain: agentbnb.dev
- IP: © 2026 Cheng Wen Chen, MIT License

---

## 3. Update README.md

Current README is v1.0 era. Needs:
- Multi-skill cards explanation + example JSON
- Autonomy tiers section
- Auto-share + auto-request explanation
- Hub screenshot (the L2 Pipeline card screenshot is perfect)
- OpenClaw integration section (`openclaw install agentbnb`)
- Updated architecture diagram showing Runtime, IdleMonitor, AutoRequestor
- Remove "Phase 0: Dogfood" references
- Update "Developed by Cheng Wen (樂洋集團)" → "Developed by Cheng Wen Chen"

---

## 4. Hub UI Bugs to Fix

### Bug 1 (Critical): Card expand stretches entire row
When a card expands to show details, all cards in the same CSS Grid row stretch to match height.

Fix options (pick one):
- Add `align-items: start` to the grid container
- Better: show expanded card detail as a modal/overlay instead of expanding in-place

### Bug 2 (Minor): Card hover animation missing
Decided in Phase 2.2 but never implemented.

Add to card component:
```css
.card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

---

## 5. v2.0 Code Audit Checklist

Claude Code completed Phase 4-8 mechanically via GSD. Verify these behaviors actually work end-to-end:

### Agent Runtime (Phase 4)
- [ ] AgentRuntime starts all background loops (IdleMonitor, etc.) on `agentbnb serve`
- [ ] SIGTERM gracefully shuts down all timers and DB handles
- [ ] Multi-skill cards (skills[] array) render correctly in Hub
- [ ] Gateway routes to correct skill via skill_id

### Autonomy Tiers (Phase 5)
- [ ] Default is Tier 3 (ask before every action) until owner configures
- [ ] `agentbnb config set tier1 10` / `tier2 50` works
- [ ] Tier 2 actions write audit events to request_log
- [ ] BudgetManager blocks auto-request when balance ≤ 20 credits (reserve)

### Idle Monitor (Phase 6)
- [ ] Per-skill idle rate tracks correctly (sliding window, last 60 min)
- [ ] Auto-share flips availability.online when idle_rate > 70%
- [ ] Auto-share respects autonomy tier (Tier 3 = ask first)
- [ ] v1.0 cards are gracefully skipped (no crash)

### Auto-Request (Phase 7)
- [ ] `agentbnb request --query "need TTS"` triggers auto-request flow
- [ ] Peer scoring: success_rate × cost_efficiency × idle_rate
- [ ] Self-exclusion: never selects own capabilities
- [ ] Budget gate: canSpend() called before every escrow hold
- [ ] Tier 3 pending_requests queue works

### OpenClaw Integration (Phase 8)
- [ ] `agentbnb openclaw sync` reads SOUL.md and generates capability card
- [ ] `agentbnb openclaw status` shows current sync state
- [ ] `agentbnb openclaw rules` outputs HEARTBEAT.md autonomy rules block
- [ ] skills/agentbnb/SKILL.md is a valid installable OpenClaw skill

---

## 6. Deployment Checklist (Next Steps)

### Infrastructure
- [ ] Deploy Remote Registry to Fly.io (free tier)
- [ ] DNS: hub.agentbnb.dev → Fly.io
- [ ] DNS: agentbnb.dev → GitHub Pages (or redirect to repo)
- [ ] Cloudflare Tunnel for Mac Mini gateway external access
- [ ] Test E2E remote capability request between two machines

### Content
- [ ] README rewrite (see section 3 above)
- [ ] Record 2-minute demo video (terminal + Hub)
- [ ] Write launch blog post

### Legal
- [ ] Register "AgentBnB" trademark at Taiwan TIPO (Class 42, TWD 3,000-5,000)
- [ ] Ensure LICENSE file says: © 2026 Cheng Wen Chen

### Launch
- [ ] Closed Beta: 10 users, 30+ capabilities on Hub
- [ ] Week 5: GitHub repo → Public
- [ ] Week 6: Hacker News Show HN
- [ ] Week 7-8: Invite-Only Launch

---

## 7. Skill Development (3-Person Team)

20 high-value skill ideas in Notion database "Skill Ideas — High-Value Capabilities".
Link: https://www.notion.so/e495a420086e4308b461b0c4b59d2083

Key principle: Only build skills where "rent > build yourself" — expensive API access, months of pipeline tuning, or specialized hardware.

Each person picks 2-3 skills from Notion, builds as OpenClaw skills first, then publishes to AgentBnB Hub.

---

## Priority Order for Claude Code

1. Push AGENT-NATIVE-PROTOCOL.md → repo root
2. Update CLAUDE.md
3. Update README.md  
4. Fix Hub UI bugs (card expand + hover)
5. Run v2.0 code audit checklist
6. Deploy Remote Registry to Fly.io
