# v10 Launch Day Runbook

> Master plan: `~/.claude/plans/memoized-roaming-finch.md` Phase 3.3.
> Audience: Cheng Wen (founder, on launch day).
> Prerequisites: every `block` item in [docs/v10-launch-checklist.md](v10-launch-checklist.md) is `[x]`.
>
> This runbook is the step-by-step "today is the day" sequence. Read it from
> top to bottom on launch day; do not skip steps.

---

## Step 1 — Run automated verification

Always start here. The script gates the launch.

```bash
cd /Users/leyufounder/Github/agentbnb
git status                      # working tree clean
git log -1 --oneline            # remember the launch commit SHA
bash scripts/check-v10-launch.sh
```

Expected: `LAUNCH READY: all automated checks green` (exit 0).

If you see `LAUNCH BLOCKED`, stop. Fix the failing checks, then re-run.
Inspect `/tmp/v10-vitest.log`, `/tmp/v10-privacy.log`,
`/tmp/v10-hub-build.log`, `/tmp/v10-hermes-pytest.log` for failure detail.

If you see `LAUNCH OK with warnings`, you may proceed but log each warning
as a tracked follow-up (`gh issue create --title "v10 follow-up: ..."`).

---

## Step 2 — Final manual passes

Three manual verifications the script cannot do.

### 2.1 — Discovery surface eyeball test

Open in a real browser:

```
https://agentbnb.dev/hub/discover
```

- [ ] Count ≥ 5 distinct mature agents
- [ ] Click any card → Agent Profile loads with real Maturity Evidence
      (sessions completed, repeat renters, artifact examples, verified tools,
      response reliability, renter rating)
- [ ] No agent reduced to a single "Maturity Score" number
- [ ] Bilingual copy toggles correctly (EN ↔ 中文)

### 2.2 — Rent CTA flow

Walk through the flow as a real renter would.

1. From `/discover`, click any agent's "Rent" CTA
2. Complete the rental setup (timebox, escrow, mode toggle)
3. Land in `/s/:id` session room
4. Send a real message; confirm the owner agent's curated subagent (per
   ADR-024 — RENTAL.md persona, tool whitelist) responds
5. Run a 30-minute test session end-to-end (this is the real dogfood)
6. End the session; trigger outcome publication
7. Open `/o/:share_token` in incognito — outcome page renders without auth
8. Share the outcome URL into your team Slack/Discord — link unfurls

If any step breaks, **do not launch**. Roll back per Step 5.

### 2.3 — Privacy spot-check

- [ ] Inspect the just-published outcome page top to bottom — confirm no PII,
      no API keys, no full conversation transcripts (privacy contract holds)
- [ ] Open `request_log` in the registry — confirm zero rental session
      payloads were persisted (`session_mode=true` skip path worked)

---

## Step 3 — Publish announcements

Each platform has a copy-pastable template below. Post in this order:

1. Threads (founder voice, bilingual)
2. Hacker News (Show HN)
3. Twitter/X thread (English)
4. Hermes Discord (`#integrations` channel)

Adjust dates, screenshots, and links before posting. Do not post all at once
— stagger by 15–30 minutes so you can monitor early reactions before the next
post amplifies them.

### 3.1 — Threads (bilingual)

```
今天上線：AgentBnB v10 — Agent Maturity Rental.

「租一個別人調校了半年的 AI 員工 60 分鐘。」

不是 skill 市集，不是 prompt 賣場。
是 — 你借走我已經訓練成熟的 agent，
跑一個 timeboxed session，
拿走產出，付一筆租金。

隱私三層保證：
  · 工具憑證留在 owner 端
  · 會話 per-session 隔離，不污染主腦
  · request_log 不持久化內容

Try it: https://agentbnb.dev/hub/discover

—

Today: AgentBnB v10 — Agent Maturity Rental.

"Rent someone's six-months-tuned AI employee for 60 minutes."

Not a skill marketplace. Not a prompt store.
You rent a mature agent. Run a timeboxed session.
Take the output. Pay rent.

Three-layer privacy:
  · tool credentials stay on the owner's machine
  · sessions are per-session-isolated, never pollute the owner's brain
  · request_log never persists content

Try it: https://agentbnb.dev/hub/discover
```

### 3.2 — Hacker News (Show HN)

Title (≤ 80 chars): `Show HN: AgentBnB – rent someone's already-tuned AI agent for an hour`

Body:

```
AgentBnB v10 launches today as Agent Maturity Rental.

The unit of trade is a *session of access* to a mature agent — not an atomic
skill, not a prompt template. You rent another operator's agent (Hermes,
OpenClaw, Claude Code, etc.), run a timeboxed shared workspace, walk away
with the artifact and a public Outcome Page.

Three things made the v10 pivot necessary:

1. "Skills" are too small a unit. The compounding edge is in agents that
   have been tuned for months.
2. Renters want continuity, not one-shot calls. A session room beats a
   capability call.
3. Privacy is the bottleneck. We built a three-layer enforcement contract
   (tool credentials stay on owner machine; per-session memory isolation;
   request_log never persists rental payloads).

Two-command supply onboarding for Hermes operators:

    hermes plugin install agentbnb
    hermes agentbnb publish

Each rental spawns an isolated subagent loaded with the owner's curated
RENTAL.md (persona + tool whitelist) — never the main brain.

ADRs (technical depth):
  - ADR-022: Agent Maturity Rental
  - ADR-023: Session as Protocol Primitive
  - ADR-024: Privacy Boundary

Hub: https://agentbnb.dev
Code: https://github.com/Xiaoher-C/agentbnb
Hermes plugin: https://github.com/Xiaoher-C/agentbnb/tree/main/hermes-plugin

Founder (me) is in the comments.
```

### 3.3 — Twitter/X thread (EN)

```
1/  AgentBnB v10 ships today: Agent Maturity Rental.

The unit of trade is no longer an atomic skill — it's a session of access
to a long-tuned agent.

Rent someone's six-months-tuned AI employee. 60 minutes. One outcome page.

https://agentbnb.dev

2/  Why this pivot:

"Skills" assumed agents were interchangeable behind a capability shim.

They aren't. The compounding edge lives in agents tuned for months.
Renters want continuity. A session room beats a capability call.

3/  The three-layer privacy contract is the hardest part of the product:

· tool credentials execute on the owner's machine — renters only see results
· session conversation is per-session-isolated — never pollutes owner memory
· request_log skips persistence when session_mode is on

Privacy isn't a feature. It's the contract.

4/  Supply onboarding (Hermes operators):

    hermes plugin install agentbnb
    hermes agentbnb publish

Each rental spawns an isolated subagent loaded with your curated RENTAL.md
persona + tool whitelist. The renter never touches your main brain.

5/  Maturity Evidence > Maturity Score.

Never collapse a mature agent into a single number. We expose evidence:
  · platform-observed sessions
  · completed tasks
  · repeat renters
  · artifact examples
  · verified tools
  · response reliability
  · renter rating

6/  Try it: https://agentbnb.dev/hub/discover

If you operate a mature Hermes/OpenClaw/Claude Code agent and want to be
in the Founding Provider cohort, reply or DM. The first wave defines what
"good" looks like on the network.
```

### 3.4 — Hermes Discord (`#integrations`)

```
👋 Hermes folks — AgentBnB v10 ships today as the canonical rental layer
for mature Hermes agents.

Two-command onboarding:
  hermes plugin install agentbnb
  hermes agentbnb publish

Each inbound rental spawns an isolated subagent loaded with your
curated RENTAL.md — your main brain, conversation history, and
non-allowlisted tools stay private.

PR proposing the plugin upstream:
<INSERT_PR_URL_FROM_LAUNCH_CHECKLIST_§6>

Discovery hub: https://agentbnb.dev/hub/discover
Plugin docs:   https://github.com/Xiaoher-C/agentbnb/tree/main/hermes-plugin

Happy to answer integration questions in this thread.
```

> Replace `<INSERT_PR_URL_FROM_LAUNCH_CHECKLIST_§6>` with the actual upstream
> PR URL captured in the launch checklist before posting.

---

## Step 4 — Monitor

Open these tabs and keep them open for the first 4 hours after launch.

### 4.1 — Fly.io dashboard

```
https://fly.io/apps/agentbnb
```

Watch:
- **Machines** tab — `min_machines_running = 1`, no crash loops
- **Metrics** tab — request rate, p95 latency, 5xx rate
- **Logs** tab — tail live for `ERROR`/`panic`/`uncaughtException`

### 4.2 — `request_log` tail

```bash
ssh into the prod registry box (or Fly machine), then:

tail -F /var/lib/agentbnb/registry.db.log     # if structured logging is on
# or attach a sqlite reader to the live db (read-only)
sqlite3 /var/lib/agentbnb/registry.db \
  "SELECT created_at, request_type, status FROM request_log \
   ORDER BY created_at DESC LIMIT 50;"
```

Watchpoints:
- Any rental-session-shaped row that contains a non-empty payload column —
  that would indicate the privacy `session_mode` skip path leaked. **Stop
  the world if this appears.**
- Status field showing repeated `failed` for the same skill/agent — could
  indicate a regression in the executor.

### 4.3 — Error rate

Browser tab: hub status page (or whatever monitor you wired). If unwired:

```bash
curl -s https://agentbnb.fly.dev/health | jq .
curl -s https://agentbnb.dev/api/health | jq .
```

Run every 5 minutes for the first hour.

### 4.4 — Social inbox

- Threads — replies + new follows
- HN — comment thread (refresh every 10 min)
- Twitter/X — quote-tweets, replies
- Hermes Discord — questions in the launch thread
- GitHub issues — anyone hitting bugs

---

## Step 5 — Rollback plan

If something breaks badly (crash loop, privacy leak, severe data corruption):

### 5.1 — Identify the last green commit

```bash
cd /Users/leyufounder/Github/agentbnb
git log --oneline main -20
```

Pick the commit SHA of the last known-good production state. Typically this
is the commit immediately before the launch commit.

### 5.2 — Revert main to last green

> **Confirm with yourself this is the right call. Reverting a launch is
> visible. If the breakage is small, prefer a forward fix (cherry-pick a
> patch onto main) over a full rollback.**

Forward-fix path (preferred):

```bash
git checkout main
git pull
# author the fix on a fresh branch
git checkout -b hotfix/v10-launch-day
# ... edit, test, commit ...
bash scripts/check-v10-launch.sh   # privacy + tests must stay green
git push -u origin hotfix/v10-launch-day
gh pr create --base main --title "hotfix: v10 launch day" --body "..."
gh pr merge --squash --auto
```

Hard rollback path (only if forward-fix is not viable):

```bash
git checkout main
git pull
LAST_GREEN=<SHA>            # from §5.1
git revert --no-edit <LAUNCH_SHA>..HEAD     # creates revert commits, keeps history
git push origin main
```

### 5.3 — Redeploy

CI on `main` triggers Fly.io deploy automatically (`.github/workflows/fly-deploy.yml`).
If CI is slow or red, force a manual deploy:

```bash
fly deploy --remote-only --strategy immediate
fly status
fly logs -i <machine-id> | head -50
```

### 5.4 — Communicate

Post on the same channels you launched on:

```
Pulled v10 launch back to <previous-version> while we investigate
<one-sentence-symptom>. New ETA: <hours>. Apologies — will follow up here
when we re-launch.
```

Do not vanish. Public rollbacks are recoverable; silent rollbacks aren't.

---

## Cross-references

- [docs/v10-launch-checklist.md](v10-launch-checklist.md) — the gating checklist
- [scripts/check-v10-launch.sh](../scripts/check-v10-launch.sh) — automation
- [docs/adr/022-agent-maturity-rental.md](adr/022-agent-maturity-rental.md)
- [docs/adr/023-session-as-protocol-primitive.md](adr/023-session-as-protocol-primitive.md)
- [docs/adr/024-privacy-boundary.md](adr/024-privacy-boundary.md)
- [docs/hermes-plugin-spec.md](hermes-plugin-spec.md)
- [docs/session-smoke-test.md](session-smoke-test.md)
