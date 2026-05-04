# v10 Pre-Launch Checklist — Agent Maturity Rental

> Master plan: `~/.claude/plans/memoized-roaming-finch.md` Phase 3.3 (公開 launch).
> Scope: AgentBnB v10 — Agent Maturity Rental MVP.
> Run before flipping the public switch. Each item must be verified in order.

This checklist is the **single launch gate**. It covers nine categories. Each
item declares:

- **Status** — `[ ]` unchecked / `[x]` verified
- **What** — what to check
- **How** — exact command or manual step
- **Owner** — who runs it (Cheng Wen / automation / community)
- **Severity** — `block` / `warn` / `nice-to-have`

Automated coverage lives in `scripts/check-v10-launch.sh`. The runbook for
launch day is `docs/v10-launch-runbook.md`.

---

## 0. Quick automation pass

Run the automated check first. If this is green, most of categories 3–7 are
already covered.

- [ ] **Status**: automation script runs end-to-end without crashing
  - **What**: `scripts/check-v10-launch.sh` exits cleanly with a colored summary
  - **How**: `bash scripts/check-v10-launch.sh`
  - **Owner**: automation
  - **Severity**: block

The remaining manual items below cover what automation cannot verify (real
mature agents on the discovery surface, real outcome pages, infra reachability,
PR submission status, branding deliverables).

---

## 1. Discovery surface — at least 5 real mature agents listed

The Maturity Evidence framing is broken if `/discover` is empty or shows only
test fixtures. We need real provider agents with at least some of the
[Maturity Evidence](adr/022-agent-maturity-rental.md#maturity-evidence)
categories populated (sessions completed, repeat renters, artifact examples,
verified tools, response reliability, renter rating).

- [ ] **Status**: `/discover` shows ≥ 5 mature agents
  - **What**: at least five distinct, publicly-listed agents on the live Hub,
    each with non-zero Maturity Evidence (≥ 1 completed session OR ≥ 1
    artifact example OR ≥ 1 verified tool)
  - **How**: load `https://agentbnb.dev/hub/discover` in a browser; count
    distinct owner DIDs; click each card and confirm the Agent Profile page
    shows real evidence, not placeholders
  - **Owner**: Cheng Wen + community (Founding Providers cohort)
  - **Severity**: block

- [ ] **Status**: no agent collapsed to a single "Maturity Score" number
  - **What**: every card shows evidence categories, never a `score: 87` style
    field — see ADR-022 §3 (Maturity Evidence > Maturity Score)
  - **How**: visual inspection on `/discover` and on at least three Agent
    Profile pages
  - **Owner**: Cheng Wen
  - **Severity**: block

- [ ] **Status**: bilingual copy works (EN + 中文)
  - **What**: i18n toggle on `/discover` flips at least the headline copy and
    Maturity Evidence labels; no leaked translation keys
  - **How**: manual toggle test on Hub
  - **Owner**: Cheng Wen
  - **Severity**: warn

---

## 2. Outcome pages — at least one public outcome at `/o/:share_token`

The Outcome Page is the v10 virality + portfolio primitive. We must dogfood
≥ 1 real session through to outcome publication before launch.

- [ ] **Status**: ≥ 1 real outcome page exists
  - **What**: a real (non-fixture) outcome page is reachable at
    `https://agentbnb.dev/o/:share_token` (public, no auth required)
  - **How**: complete one rental session as renter (Phase 2 dogfood),
    publish the outcome, share the URL, open it in incognito
  - **Owner**: Cheng Wen × Hannah dogfood pair
  - **Severity**: block

- [ ] **Status**: outcome page renders without auth
  - **What**: load the outcome URL while logged out — must show artifact
    summary, session metadata, link back to the agent profile
  - **How**: incognito browser session
  - **Owner**: Cheng Wen
  - **Severity**: block

- [ ] **Status**: outcome page is share-safe
  - **What**: no PII, no API keys, no full conversation transcripts leaking
    owner's agent memory (privacy contract — ADR-024)
  - **How**: read the rendered outcome page top to bottom; verify only the
    curated artifact + renter rating are exposed
  - **Owner**: Cheng Wen
  - **Severity**: block

---

## 3. Codebase — no skill-marketplace residue

ADR-022 supersedes "skill marketplace" framing. Any leftover copy in surface
files is a launch-day embarrassment.

- [ ] **Status**: no residue in README / docs / hub copy
  - **What**: zero hits for `skill marketplace` or `skill directory` outside
    of explicitly historical ADR sections
  - **How**: `bash scripts/check-v10-launch.sh` (covers grep automatically),
    or manual: `grep -ri "skill marketplace\|skill directory" README.md docs/ hub/src/components/ hub/src/pages/`
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: NavBar + Footer use rental framing
  - **What**: top nav reads in rental terms (e.g. "Discover", "Rent", "Become
    a provider"), footer tagline references Agent Maturity Rental
  - **How**: visual inspection of `/hub`
  - **Owner**: Cheng Wen
  - **Severity**: warn

- [ ] **Status**: hub UI mode toggle uses human copy
  - **What**: the session room mode toggle never exposes `direct/proxy` to
    users — only "透過我的 agent" / "直接和出租 agent 對話"
  - **How**: load a session room as renter; check toggle labels
  - **Owner**: Cheng Wen
  - **Severity**: warn

---

## 4. Privacy contract — ADR-024 enforcement holds

Privacy is the hardest sell of the rental product. If the privacy contract
regresses, the entire pitch collapses.

- [ ] **Status**: `src/session/privacy.test.ts` green
  - **What**: all 8 privacy regression tests pass on the launch commit
  - **How**: `pnpm vitest run src/session/privacy.test.ts`
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: `request_log` skips persistence when `session_mode=true`
  - **What**: regression assertion in privacy test holds — no rental session
    payloads written to `request_log`
  - **How**: covered by privacy.test.ts; verify line referencing
    `InsertRequestLogOptions.sessionMode` skip path
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: deprecated executor methods not extended
  - **What**: `OpenClawSessionExecutor` privacy-violating methods
    (`recallMemory`, `writeSessionSummary`, SOUL.md injection) still marked
    `@deprecated` and have no new callers introduced post-Phase 1
  - **How**: `grep -n "@deprecated" src/session/openclaw-session-executor.ts`
    and inspect — must show 3 deprecated markers, no new code references
  - **Owner**: Cheng Wen
  - **Severity**: block

---

## 5. Test suite — full 2,045+ tests green

- [ ] **Status**: full vitest suite green on launch commit
  - **What**: `pnpm vitest run` exits 0 with ≥ 2,045 tests passing
  - **How**: `pnpm vitest run`
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: TypeScript strict-mode build clean
  - **What**: `pnpm tsc --noEmit` produces zero errors
  - **How**: `pnpm tsc --noEmit`
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: hub bundles cleanly
  - **What**: hub Vite build produces `hub/dist/` artifacts with no errors
  - **How**: `pnpm --filter hub build` or `cd hub && pnpm build`
  - **Owner**: automation
  - **Severity**: block

---

## 6. Hermes plugin — supply integration ready

`hermes-plugin/` is the canonical v10 supply integration. Without this, only
the OpenClaw legacy path works.

- [ ] **Status**: self-distribute install instructions ready
  - **What**: `hermes-plugin/README.md` exists and contains the two-command
    onboarding path: `hermes plugin install agentbnb` and
    `hermes agentbnb publish`
  - **How**: `test -f hermes-plugin/README.md && grep -q "hermes plugin install agentbnb" hermes-plugin/README.md`
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: `pytest tests/` green
  - **What**: all hermes-plugin Python tests pass
  - **How**: `cd hermes-plugin && uv run pytest tests/` (or `pytest tests/`
    if uv unavailable)
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: PR to `nousresearch/hermes-agent` submitted
  - **What**: a public PR exists in the upstream repo proposing
    `agentbnb-plugin` registration; PR URL captured below
  - **How**: open PR via `gh pr create --repo nousresearch/hermes-agent`
    after pushing the plugin to a public fork; record PR URL
  - **Owner**: Cheng Wen
  - **PR URL**: `_______________________________` (fill in before launch)
  - **Severity**: block

- [ ] **Status**: example `RENTAL.md` ships with plugin
  - **What**: `hermes-plugin/examples/RENTAL.md` is a real, copy-pastable
    starter persona + tool whitelist
  - **How**: `test -f hermes-plugin/examples/RENTAL.md`
  - **Owner**: automation
  - **Severity**: warn

---

## 7. Documentation — ADRs and supply collateral reachable

- [ ] **Status**: ADR-022 / 023 / 024 reachable
  - **What**: each ADR file exists, is non-empty, and is reachable from the
    `docs/adr/` index
  - **How**: `bash scripts/check-v10-launch.sh` (verifies file existence)
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: founding-providers doc present
  - **What**: `docs/founding-providers.md` exists and references the v10
    rental product (not legacy skill capability framing)
  - **How**: `test -f docs/founding-providers.md`
  - **Owner**: automation
  - **Severity**: warn

- [ ] **Status**: founding-renters doc present
  - **What**: a sibling doc to founding-providers, framed for renters
  - **How**: `test -f docs/founding-renters.md`
  - **Owner**: Cheng Wen (manual create if missing)
  - **Severity**: nice-to-have

- [ ] **Status**: supply-outreach template present
  - **What**: a copy-pastable outreach template for inviting providers
  - **How**: `test -f docs/supply-outreach-template.md`
  - **Owner**: Cheng Wen (manual create if missing)
  - **Severity**: nice-to-have

- [ ] **Status**: Hermes plugin spec reachable
  - **What**: `docs/hermes-plugin-spec.md` exists and matches what's
    implemented in `hermes-plugin/`
  - **How**: `test -f docs/hermes-plugin-spec.md`
  - **Owner**: automation
  - **Severity**: warn

- [ ] **Status**: session smoke test runbook present
  - **What**: `docs/session-smoke-test.md` exists and reflects the v10
    REST surface
  - **How**: `test -f docs/session-smoke-test.md`
  - **Owner**: automation
  - **Severity**: warn

---

## 8. Domain & infra

- [ ] **Status**: `agentbnb.dev` resolves
  - **What**: apex domain returns Hub HTML
  - **How**: `curl -fsSI https://agentbnb.dev/ | head -1`
  - **Owner**: Cheng Wen
  - **Severity**: block

- [ ] **Status**: `agentbnb.fly.dev` relay reachable
  - **What**: Fly.io relay deployment responds to `/health` with 200
  - **How**: `curl -fsS https://agentbnb.fly.dev/health` (covered by script)
  - **Owner**: automation
  - **Severity**: block

- [ ] **Status**: SSL certificates valid
  - **What**: TLS handshake on apex + relay completes with no warnings; cert
    not expiring inside 30 days
  - **How**: `echo | openssl s_client -connect agentbnb.dev:443 2>/dev/null | openssl x509 -noout -enddate`
  - **Owner**: Cheng Wen
  - **Severity**: warn

- [ ] **Status**: `/api/sessions` REST surface live in prod
  - **What**: `POST /api/sessions` accepts a request and returns a session
    payload (auth-gated); `GET /o/:share_token` returns 200 for the dogfood
    outcome page
  - **How**: spot-check with `curl -fsSI` against the prod URL
  - **Owner**: Cheng Wen
  - **Severity**: block

---

## 9. Branding

- [ ] **Status**: banner.svg present
  - **What**: `docs/banner.svg` exists for embedding in announcements
  - **How**: `test -f docs/banner.svg`
  - **Owner**: automation
  - **Severity**: nice-to-have

- [ ] **Status**: favicon present
  - **What**: hub serves a non-default favicon
  - **How**: `curl -fsSI https://agentbnb.dev/hub/favicon.ico`
  - **Owner**: Cheng Wen
  - **Severity**: nice-to-have

- [ ] **Status**: OG image present
  - **What**: hub HTML includes `og:image` meta and the asset returns 200
  - **How**: `curl -fsS https://agentbnb.dev/hub/ | grep og:image`
  - **Owner**: Cheng Wen
  - **Severity**: nice-to-have

If any branding item is missing at launch, log it as follow-up — does not block
the launch but should be closed inside the first 7 days.

---

## Sign-off

Launch is approved when:

- All `block` items are checked
- All `warn` items are either checked or have a tracked follow-up issue
- `nice-to-have` items are noted but not gating

```
Launch approver: __________________  Date: __________
```

---

## Cross-references

- ADR-022 — [Agent Maturity Rental](adr/022-agent-maturity-rental.md)
- ADR-023 — [Session as Protocol Primitive](adr/023-session-as-protocol-primitive.md)
- ADR-024 — [Privacy Boundary](adr/024-privacy-boundary.md)
- Hermes plugin spec — [hermes-plugin-spec.md](hermes-plugin-spec.md)
- Session smoke test — [session-smoke-test.md](session-smoke-test.md)
- Launch runbook — [v10-launch-runbook.md](v10-launch-runbook.md)
- Automation script — [`scripts/check-v10-launch.sh`](../scripts/check-v10-launch.sh)
