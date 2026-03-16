# Phase 15: Distribution + Discovery — Research

**Researched:** 2026-03-16
**Domain:** Claude Code plugin system, AgentSkills open standard, GitHub repository discovery
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIST-01 | Claude Code `.claude-plugin/marketplace.json` created with correct schema | marketplace.json schema fully documented — see Marketplace Schema section |
| DIST-02 | Plugin structure at `plugins/agentbnb-network/` with `plugin.json` and `SKILL.md` | plugin.json complete schema documented — see Plugin Manifest Schema section |
| DIST-03 | `SKILL.md` has complete YAML frontmatter for auto-indexing (name, version, description, author, tags) | AgentSkills spec confirmed: metadata map holds author+version, compatibility holds tool targeting |
| DIST-04 | GitHub repository topics set: `ai-agent-skill`, `claude-code`, `agent-skills` | GitHub API `PUT /repos/topics` documented — `gh api` command confirmed |
| DIST-05 | README updated with hub screenshot, badges, and one-line install commands per tool | Existing README structure confirmed — screenshot placeholder exists; install patterns researched |
</phase_requirements>

---

## Summary

Phase 15 creates the distribution layer that makes AgentBnB discoverable and installable. This is a file-creation and configuration phase — no new TypeScript code is required. The work falls into four distinct tasks: (1) creating the Claude Code plugin package at `plugins/agentbnb-network/`, (2) creating the marketplace entry at `.claude-plugin/marketplace.json`, (3) updating the `skills/agentbnb/SKILL.md` with complete AgentSkills-standard frontmatter for cross-tool indexing, (4) setting GitHub repository topics, and (5) overhauling README.md with a screenshot, badges, and per-tool install commands.

The Claude Code plugin system is well-documented with a stable schema. The AgentSkills open standard is also well-documented — the existing `skills/agentbnb/SKILL.md` already uses frontmatter but is missing some required fields (`version`, `author`, `tags`) needed for cross-tool auto-indexing. The `metadata` map in the AgentSkills spec is the correct location for those non-standard fields.

**Primary recommendation:** Create two separate `SKILL.md` files serving different purposes — the existing `skills/agentbnb/SKILL.md` is agent-executable instructions for OpenClaw; the new `plugins/agentbnb-network/skills/agentbnb-network/SKILL.md` is the Claude Code plugin skill for human developers. Both should meet the AgentSkills standard frontmatter.

**Key finding:** The existing `skills/agentbnb/SKILL.md` has `version: 2.0.0` in frontmatter but `package.json` has `"version": "1.0.0"`. The canonical version should come from `package.json`. Plan must resolve this inconsistency.

---

## Standard Stack

### Core
| Item | Version/State | Purpose | Why Standard |
|------|---------------|---------|--------------|
| Claude Code plugin format | current (2026) | Plugin discovery and distribution | Official Anthropic spec |
| AgentSkills open standard | v1 | Cross-tool SKILL.md portability | Used by 30+ tools including Cursor, Copilot, Gemini CLI |
| GitHub Topics API | REST v3 | Searchable repo tagging | Native GitHub discovery mechanism |
| `gh` CLI | installed | Script-based topic management | Wraps GitHub API, handles auth automatically |

### No External Libraries Required
This phase creates static files only. No npm packages to install.

---

## Architecture Patterns

### Recommended Directory Structure

```
agentbnb/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace catalog (DIST-01)
└── plugins/
    └── agentbnb-network/          # Plugin package root (DIST-02)
        ├── .claude-plugin/
        │   └── plugin.json        # Plugin manifest
        └── skills/
            └── agentbnb-network/
                └── SKILL.md       # Agent skill for Claude Code
```

Note: `commands/`, `agents/`, `hooks/`, and `skills/` must all be at the plugin root, NOT inside `.claude-plugin/`. Only `plugin.json` goes in `.claude-plugin/`.

---

## Schema Reference (HIGH confidence — from official Claude Code docs)

### Plugin Manifest: `plugins/agentbnb-network/.claude-plugin/plugin.json`

Only `name` is required when a manifest is provided. The `version` field in `plugin.json` takes priority over any version set in `marketplace.json` when both exist. **Best practice: set version only in `plugin.json`, omit from marketplace entry.**

```json
{
  "name": "agentbnb-network",
  "description": "Connect your agent to the AgentBnB P2P capability sharing network — earn credits by sharing idle APIs, spend credits to request capabilities from peers",
  "version": "2.2.0",
  "author": {
    "name": "Cheng Wen Chen",
    "email": "chengwen@agentbnb.dev",
    "url": "https://github.com/Xiaoher-C/agentbnb"
  },
  "homepage": "https://agentbnb.dev",
  "repository": "https://github.com/Xiaoher-C/agentbnb",
  "license": "MIT",
  "keywords": ["agent", "capability-sharing", "p2p", "credits", "ai-agent"]
}
```

Full `plugin.json` schema fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | YES (if manifest present) | Kebab-case; becomes skill namespace prefix |
| `description` | string | No | Shown in plugin manager |
| `version` | string | No | Semver; wins over marketplace entry version |
| `author` | object | No | `name` (required), `email`, `url` |
| `homepage` | string | No | Docs URL |
| `repository` | string | No | Source repo URL |
| `license` | string | No | SPDX identifier e.g. `"MIT"` |
| `keywords` | array | No | Discovery tags |
| `skills` | string/array | No | Custom path overrides (not needed if skills/ is at root) |
| `commands` | string/array | No | Custom command path overrides |
| `agents` | string/array | No | Custom agent path overrides |
| `hooks` | string/array/object | No | Hook config |
| `mcpServers` | string/array/object | No | MCP server config |
| `lspServers` | string/array/object | No | LSP server config |

### Marketplace File: `.claude-plugin/marketplace.json`

```json
{
  "name": "agentbnb",
  "owner": {
    "name": "Cheng Wen Chen",
    "email": "chengwen@agentbnb.dev"
  },
  "plugins": [
    {
      "name": "agentbnb-network",
      "source": "./plugins/agentbnb-network",
      "description": "Connect your agent to the AgentBnB P2P capability sharing network"
    }
  ]
}
```

Full marketplace.json schema:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | YES | Marketplace identifier; kebab-case. Reserved names blocked (see below) |
| `owner` | object | YES | `name` (required), `email` (optional) |
| `plugins` | array | YES | List of plugin entries |
| `metadata.description` | string | No | Marketplace description |
| `metadata.pluginRoot` | string | No | Base dir prepended to relative source paths |

**Reserved marketplace names** (cannot use): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `life-sciences`.

Each plugin entry in the `plugins` array:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | YES | Plugin identifier |
| `source` | string/object | YES | Where to fetch the plugin |
| `description` | string | No | Short description |
| `version` | string | No | **Omit if version is in plugin.json** (plugin.json always wins silently) |
| `author` | object | No | `name`, `email` |
| `category` | string | No | Plugin category |
| `tags` | array | No | Tags for searchability |
| `keywords` | array | No | Discovery keywords |
| `strict` | boolean | No | Default `true`. Set `false` if plugin has no own `plugin.json` |

**Source types:**

```json
// Relative path (same repo) — recommended for AgentBnB
"source": "./plugins/agentbnb-network"

// GitHub (external repo)
"source": { "source": "github", "repo": "Xiaoher-C/agentbnb" }

// git-subdir (monorepo) — not needed here
"source": { "source": "git-subdir", "url": "...", "path": "plugins/agentbnb-network" }
```

For AgentBnB, use relative path `"source": "./plugins/agentbnb-network"` since the plugin lives in the same repo. Users who add the marketplace via GitHub (`owner/repo`) will be able to resolve the relative path because the full repo is cloned.

**Version discipline** (critical): Set `version` only in `plugin.json`. Do NOT set it in the marketplace entry. If both are set, `plugin.json` wins silently — the marketplace version is ignored. The roadmap already notes: "plugin.json version discipline — version in plugin.json only."

### Plugin Skill: `plugins/agentbnb-network/skills/agentbnb-network/SKILL.md`

The plugin's SKILL.md is for human Claude Code users installing AgentBnB. It differs from `skills/agentbnb/SKILL.md` (which is for OpenClaw agents — agent-executable instructions).

Frontmatter for Claude Code plugin skill:

```yaml
---
name: agentbnb-network
description: Connect your agent to the AgentBnB P2P capability sharing network. Use when setting up AgentBnB, publishing capability cards, managing credits, or requesting capabilities from peer agents.
disable-model-invocation: true
---
```

The Claude Code plugin skill should guide a human developer through installing and setting up AgentBnB — this is a `disable-model-invocation: true` task skill (manual invocation only).

### Existing SKILL.md Update: `skills/agentbnb/SKILL.md`

The AgentSkills open standard (agentskills.io) defines the authoritative cross-tool format. Key finding: the standard does NOT have `version`, `author`, or `tags` as top-level frontmatter fields. These go inside the `metadata` map. The `compatible-tools` field does not exist in the spec — use `compatibility` instead for tool targeting.

Current `skills/agentbnb/SKILL.md` frontmatter:
```yaml
---
name: agentbnb
version: 2.0.0          # WRONG: not a standard field; move to metadata
description: "..."
author: AgentBnB        # WRONG: not a standard field; move to metadata
requires: ...           # WRONG: not a standard field; remove or move to compatibility
entry_point: bootstrap.ts
install_script: install.sh
---
```

Required frontmatter per AgentSkills spec (DIST-03):
```yaml
---
name: agentbnb
description: "P2P capability sharing for AI agents — earn credits by sharing idle APIs, spend credits to request capabilities from peer agents. Use when an OpenClaw agent needs to join the AgentBnB network."
license: MIT
compatibility: "Requires Node.js >= 20, pnpm. Designed for OpenClaw agents. Compatible with Claude Code, Gemini CLI, and other AgentSkills-compatible tools."
metadata:
  author: "Cheng Wen Chen"
  version: "2.2.0"
  tags: "ai-agent-skill,claude-code,agent-skills,p2p,capability-sharing"
---
```

The `metadata` map accepts arbitrary string key-value pairs. Use it for `author`, `version`, and comma-separated `tags`. This is how cross-tool auto-indexers discover metadata beyond name/description.

---

## GitHub Topics (DIST-04)

**Command to set topics:**
```bash
gh api -X PUT /repos/Xiaoher-C/agentbnb/topics \
  -f "names[]=ai-agent-skill" \
  -f "names[]=claude-code" \
  -f "names[]=agent-skills"
```

Confirmed: current repo has no topics (`{"names":[]}`). The PUT endpoint replaces all topics atomically. Since starting from empty, no need to fetch-then-merge.

GitHub topic naming rules: lowercase, alphanumeric and hyphens only, max 35 characters per topic, max 20 topics per repo.

Additional topics to consider (discretion): `p2p`, `capability-sharing`, `mcp`, `typescript` — but DIST-04 specifies exactly three, so stick to those.

---

## README Overhaul (DIST-05)

The current README.md already has a strong structure. Key gaps:

1. **Screenshot**: `docs/hub-screenshot.png` is a placeholder (noted as blocker in STATE.md since v2.1). Phase 15 must supply a real screenshot. The Hub is at `/hub` when `agentbnb serve` is running — take a screenshot of the Discover page showing the dark SaaS design.

2. **Per-tool install badges and commands**: The existing README has one `openclaw install agentbnb` command under OpenClaw Integration. DIST-05 requires one-line install commands for Claude Code, OpenClaw, Antigravity, and CLI.

Proposed install command section:

```markdown
## Install

| Tool | Command |
|------|---------|
| Claude Code | `/plugin install agentbnb-network@agentbnb` |
| OpenClaw | `openclaw install agentbnb` |
| CLI (npm) | `npm install -g agentbnb` |
| CLI (pnpm) | `pnpm add -g agentbnb` |
```

For Claude Code plugin install to work, users must first add the marketplace:
```bash
/plugin marketplace add Xiaoher-C/agentbnb
```
Then install: `/plugin install agentbnb-network@agentbnb`

3. **Badges to add**: Claude Code plugin badge, AgentSkills compatibility badge, existing npm/Node/MIT badges stay.

```markdown
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-orange.svg)](https://github.com/Xiaoher-C/agentbnb)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Compatible-blue.svg)](https://agentskills.io)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin manifest validation | Custom JSON validator | `claude plugin validate .` or `/plugin validate .` | Official tool catches all schema errors |
| GitHub topic management | Manual GitHub UI | `gh api -X PUT /repos/{owner}/{repo}/topics` | Scriptable, reproducible |
| Cross-tool SKILL.md | Custom format | AgentSkills spec at agentskills.io | 30+ tools already parse this format |

---

## Common Pitfalls

### Pitfall 1: Components inside `.claude-plugin/` directory
**What goes wrong:** Putting `skills/`, `commands/`, or `agents/` inside `.claude-plugin/` instead of at plugin root.
**Why it happens:** Feels logical since `plugin.json` is there.
**How to avoid:** `.claude-plugin/` contains ONLY `plugin.json`. All components (skills/, commands/, etc.) go at plugin root.
**Warning sign:** Plugin loads but slash commands don't appear.

### Pitfall 2: Version set in both `plugin.json` AND `marketplace.json`
**What goes wrong:** Marketplace version is silently ignored; `plugin.json` always wins.
**Why it happens:** Authors try to be explicit in both places.
**How to avoid:** Set version ONLY in `plugin.json`. The marketplace entry for relative-path plugins in the same repo should have NO `version` field.
**Warning sign:** Bumping version in marketplace.json has no effect on update detection.

### Pitfall 3: Wrong marketplace name
**What goes wrong:** Using a reserved name like `agent-skills` causes validation failure.
**How to avoid:** Use `agentbnb` as the marketplace name — not reserved, and matches npm package name.

### Pitfall 4: Relative-path source requires git-based marketplace add
**What goes wrong:** If user adds marketplace via URL (not GitHub repo), relative plugin paths like `"./plugins/agentbnb-network"` won't resolve.
**How to avoid:** The README must instruct users to add with `/plugin marketplace add Xiaoher-C/agentbnb` (GitHub repo format), not a raw URL.
**Warning sign:** Plugin installation fails with "path not found" after adding marketplace.

### Pitfall 5: Existing SKILL.md uses non-standard frontmatter fields
**What goes wrong:** Fields like `version`, `author`, `requires`, `entry_point`, `install_script` at the top level are NOT part of the AgentSkills spec. Tools that strictly parse the spec may warn or ignore them.
**How to avoid:** Move `version` and `author` into the `metadata` map. Move `requires` into `compatibility`. Remove `entry_point` and `install_script` from frontmatter (they are documented in the Markdown body already).

### Pitfall 6: GitHub topics are case-sensitive — use only lowercase
**What goes wrong:** Topics with uppercase letters are rejected by the API.
**How to avoid:** `ai-agent-skill`, `claude-code`, `agent-skills` — all lowercase with hyphens.

---

## Code Examples

### Complete marketplace.json
```json
{
  "name": "agentbnb",
  "owner": {
    "name": "Cheng Wen Chen",
    "email": "chengwen@agentbnb.dev"
  },
  "plugins": [
    {
      "name": "agentbnb-network",
      "source": "./plugins/agentbnb-network",
      "description": "Connect your agent to the AgentBnB P2P capability sharing network — earn credits by sharing idle APIs, spend credits to request capabilities from peers"
    }
  ]
}
```

### Complete plugin.json
```json
{
  "name": "agentbnb-network",
  "description": "Connect your agent to the AgentBnB P2P capability sharing network — earn credits by sharing idle APIs, spend credits to request capabilities from peers",
  "version": "2.2.0",
  "author": {
    "name": "Cheng Wen Chen",
    "url": "https://github.com/Xiaoher-C/agentbnb"
  },
  "homepage": "https://agentbnb.dev",
  "repository": "https://github.com/Xiaoher-C/agentbnb",
  "license": "MIT",
  "keywords": ["agent", "capability-sharing", "p2p", "credits", "ai-agent", "agentbnb"]
}
```

### Complete skills/agentbnb/SKILL.md frontmatter (updated)
```yaml
---
name: agentbnb
description: "P2P capability sharing for AI agents — earn credits by sharing idle APIs, spend credits to request capabilities from peer agents. Use when an agent needs to join the AgentBnB network, publish capability cards, manage credits, or request skills from peers."
license: MIT
compatibility: "Requires Node.js >= 20 and pnpm. Designed for OpenClaw agents. Compatible with Claude Code, Gemini CLI, and other AgentSkills-compatible tools."
metadata:
  author: "Cheng Wen Chen"
  version: "2.2.0"
  tags: "ai-agent-skill,claude-code,agent-skills,p2p,capability-sharing"
---
```

### GitHub topics command
```bash
# Source: GitHub REST API v3
gh api -X PUT /repos/Xiaoher-C/agentbnb/topics \
  -f "names[]=ai-agent-skill" \
  -f "names[]=claude-code" \
  -f "names[]=agent-skills"
```

### Claude Code install commands (for README)
```bash
# Add marketplace
/plugin marketplace add Xiaoher-C/agentbnb

# Install plugin
/plugin install agentbnb-network@agentbnb
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Single-tool SKILL.md with custom frontmatter | AgentSkills open standard with `metadata` map | Works across 30+ tools |
| Manual GitHub topic editing | `gh api PUT /repos/topics` | Scriptable, reproducible |
| Plugin = npm package only | Claude Code plugin marketplace system | Native in-tool installation |

---

## Open Questions

1. **Hub screenshot for README (DIST-05)**
   - What we know: `docs/hub-screenshot.png` is a placeholder; the Hub is built and running
   - What's unclear: Whether the planner task should include taking the screenshot programmatically vs leaving it as a manual step
   - Recommendation: Make the screenshot step explicit in the plan — run `agentbnb serve`, open `http://localhost:7700/hub`, take screenshot, save to `docs/hub-screenshot.png`. This is a human-assist step unless the plan uses headless Puppeteer. Treat as manual verification step.

2. **Antigravity tool install command**
   - What we know: README (Docs page) references Antigravity as a supported tool alongside Claude Code, OpenClaw, CLI
   - What's unclear: Antigravity is not in the AgentSkills ecosystem list from agentskills.io — no confirmed install command format
   - Recommendation: Use the same pattern as OpenClaw since Antigravity appears to be an AgentSkills-compatible tool. Placeholder: `antigravity install agentbnb`. The planner should mark this as unverified and leave a TODO comment.

3. **Version number to use**
   - What we know: `package.json` has `"version": "1.0.0"`, `skills/agentbnb/SKILL.md` frontmatter has `version: 2.0.0`, current milestone is v2.2
   - What's unclear: Which version should plugin.json and updated SKILL.md use
   - Recommendation: Use `2.2.0` to match the current milestone. The `package.json` version (`1.0.0`) should also be bumped to `2.2.0` as part of this phase or treated as a separate concern. The plan should update `package.json` version simultaneously.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1+ |
| Config file | `vitest.config.ts` (via package.json scripts) |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-01 | `.claude-plugin/marketplace.json` exists and is valid JSON | smoke | `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"` | ❌ Wave 0 |
| DIST-02 | `plugins/agentbnb-network/.claude-plugin/plugin.json` exists and is valid JSON | smoke | `node -e "JSON.parse(require('fs').readFileSync('plugins/agentbnb-network/.claude-plugin/plugin.json','utf8'))"` | ❌ Wave 0 |
| DIST-03 | `SKILL.md` frontmatter has required fields (name, description, metadata.author, metadata.version) | manual-only | Manual inspection | ❌ Wave 0 |
| DIST-04 | GitHub topics include required three topics | manual-only | `gh api repos/Xiaoher-C/agentbnb/topics` | N/A |
| DIST-05 | README has screenshot, badges, and install commands | manual-only | Visual inspection | N/A |

DIST-03, DIST-04, DIST-05 are structural/content requirements with no meaningful automated assertions beyond file existence. The JSON parse smoke tests for DIST-01 and DIST-02 are the only automated checks worth running.

### Sampling Rate
- **Per task commit:** `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('plugins/agentbnb-network/.claude-plugin/plugin.json','utf8'))" && echo "JSON valid"`
- **Per wave merge:** Same JSON validation + manual inspection of SKILL.md frontmatter
- **Phase gate:** All files exist, JSON is valid, GitHub topics confirmed via `gh api`, README screenshot loads in browser before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] No test framework changes needed — this phase creates static files only
- [ ] JSON validation commands are inline shell, not Vitest tests — appropriate for static file creation

*(Existing test infrastructure does not need modification for this phase)*

---

## Sources

### Primary (HIGH confidence)
- Official Claude Code Docs: `code.claude.com/docs/en/skills` — complete SKILL.md frontmatter specification
- Official Claude Code Docs: `code.claude.com/docs/en/plugins` — plugin structure, plugin.json schema
- Official Claude Code Docs: `code.claude.com/docs/en/plugins-reference` — complete plugin.json schema, all fields
- Official Claude Code Docs: `code.claude.com/docs/en/plugin-marketplaces` — complete marketplace.json schema, source types
- AgentSkills spec: `agentskills.io/specification` — complete SKILL.md cross-tool standard
- GitHub API inspection: `gh api repos/Xiaoher-C/agentbnb/topics` — confirmed zero current topics
- Project files: `skills/agentbnb/SKILL.md`, `package.json`, `README.md` — confirmed current state

### Secondary (MEDIUM confidence)
- WebSearch: GitHub REST API topics endpoint confirmed via multiple sources including GitHub Docs
- WebSearch: `gh api -X PUT /repos/{owner}/{repo}/topics` syntax confirmed

### Tertiary (LOW confidence — needs validation)
- Antigravity install command format — not verified; assumed similar to OpenClaw pattern

---

## Metadata

**Confidence breakdown:**
- marketplace.json schema: HIGH — directly from official Claude Code docs, complete spec
- plugin.json schema: HIGH — directly from official Claude Code docs, complete spec
- SKILL.md AgentSkills frontmatter: HIGH — directly from agentskills.io specification
- GitHub topics API: HIGH — confirmed via `gh api` call to live repo
- Antigravity install command: LOW — unverified, tool not in agentskills.io ecosystem list

**Research date:** 2026-03-16
**Valid until:** 2026-06-16 (stable schemas; Claude Code plugin system is in active development, verify if > 60 days)
