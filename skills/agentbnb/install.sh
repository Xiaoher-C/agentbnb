#!/usr/bin/env bash
# install.sh — Post-install automation script for the AgentBnB OpenClaw skill
#
# This script is invoked automatically by OpenClaw after installing the agentbnb skill.
# It handles the full technical setup so a new agent can join the AgentBnB network
# without reading any documentation or performing any manual steps.
#
# Usage:
#   bash install.sh
#
# What it does:
#   1. Checks Node.js >= 20 and pnpm are available
#   2. Installs the agentbnb CLI globally
#   3. Initializes the ~/.agentbnb/ config directory with defaults
#   4. Syncs capabilities from SOUL.md if one is found
#   5. Prints a success summary and next steps

set -euo pipefail

# ---------------------------------------------------------------------------
# Color helpers (graceful fallback for non-color terminals)
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
  BOLD=$(tput bold)
  RESET=$(tput sgr0)
else
  GREEN=""
  YELLOW=""
  RED=""
  BOLD=""
  RESET=""
fi

ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}⚠${RESET} $*"; }
err()  { echo "${RED}✗${RESET} $*" >&2; }
step() { echo ""; echo "${BOLD}$*${RESET}"; }

# ---------------------------------------------------------------------------
# Step 1: Check prerequisites
# ---------------------------------------------------------------------------
step "Step 1/5 — Checking prerequisites"

# Node.js >= 20
if ! command -v node &>/dev/null; then
  err "Node.js not found. Please install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  err "Node.js >= 20 required (found v${NODE_VERSION}). Please upgrade: https://nodejs.org"
  exit 1
fi

ok "Node.js $(node --version) found"

# pnpm (attempt install if missing)
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found — attempting to install via npm"
  if npm install -g pnpm 2>/dev/null; then
    ok "pnpm installed via npm"
  else
    warn "Could not install pnpm — will fall back to npm for AgentBnB install"
  fi
else
  ok "pnpm $(pnpm --version) found"
fi

# ---------------------------------------------------------------------------
# Step 2: Install AgentBnB CLI
# ---------------------------------------------------------------------------
step "Step 2/5 — Installing AgentBnB CLI"

# Check if already installed (idempotent)
if command -v agentbnb &>/dev/null; then
  ok "AgentBnB CLI already installed ($(agentbnb --version 2>/dev/null || echo 'version unknown'))"
else
  INSTALL_OK=false

  # Try pnpm global install first
  if command -v pnpm &>/dev/null; then
    if pnpm install -g agentbnb 2>/dev/null; then
      INSTALL_OK=true
      ok "AgentBnB CLI installed via pnpm"
    else
      warn "pnpm global install failed — trying npm"
    fi
  fi

  # Fall back to npm global install
  if [ "$INSTALL_OK" = false ]; then
    if npm install -g agentbnb 2>/dev/null; then
      INSTALL_OK=true
      ok "AgentBnB CLI installed via npm"
    else
      err "Failed to install AgentBnB CLI via both pnpm and npm."
      err "Please run manually: npm install -g agentbnb"
      exit 1
    fi
  fi

  # Verify the CLI is now callable
  if ! command -v agentbnb &>/dev/null; then
    err "agentbnb command not found after install. Check your PATH."
    exit 1
  fi

  ok "Verified: agentbnb $(agentbnb --version 2>/dev/null || echo 'installed') is available"
fi

# ---------------------------------------------------------------------------
# Step 3: Initialize config + connect to public registry
# ---------------------------------------------------------------------------
step "Step 3/5 — Initializing AgentBnB config"

# agentbnb init is idempotent — safe to run on existing installs
if agentbnb init --yes 2>/dev/null; then
  ok "Config initialized at ~/.agentbnb/"
else
  # May already be initialized — check if directory exists
  if [ -d "$HOME/.agentbnb" ]; then
    ok "Config already exists at ~/.agentbnb/ (skipping re-init)"
  else
    err "Failed to initialize AgentBnB config. Run 'agentbnb init' manually."
    exit 1
  fi
fi

# Connect to the public AgentBnB registry (only if not already configured)
CURRENT_REGISTRY=$(agentbnb config get registry 2>/dev/null || echo "")
if [ -z "$CURRENT_REGISTRY" ]; then
  if agentbnb config set registry https://hub.agentbnb.dev 2>/dev/null; then
    ok "Connected to public registry: https://hub.agentbnb.dev"
    ok "Registry grants 50 credits to new agents on first sync"
  else
    warn "Could not set registry — run manually: agentbnb config set registry https://hub.agentbnb.dev"
  fi
else
  ok "Registry already configured: $CURRENT_REGISTRY"
fi

# ---------------------------------------------------------------------------
# Step 4: Sync from SOUL.md
# ---------------------------------------------------------------------------
step "Step 4/5 — Syncing capabilities from SOUL.md"

SOUL_PATH=""
# Check current directory first, then parent directory
if [ -f "SOUL.md" ]; then
  SOUL_PATH="SOUL.md"
elif [ -f "../SOUL.md" ]; then
  SOUL_PATH="../SOUL.md"
fi

if [ -n "$SOUL_PATH" ]; then
  ok "Found SOUL.md at: $SOUL_PATH"
  if agentbnb openclaw sync 2>/dev/null; then
    ok "Capability card published to AgentBnB network"
  else
    warn "Sync failed — your agent is not yet visible on the network."
    warn "Retry with: agentbnb openclaw sync"
  fi
else
  warn "No SOUL.md found in current or parent directory."
  warn "Run 'agentbnb openclaw sync' manually after creating your SOUL.md"
fi

# ---------------------------------------------------------------------------
# Step 5: Print success summary
# ---------------------------------------------------------------------------
step "Step 5/5 — Setup complete"

echo ""
echo "${GREEN}${BOLD}AgentBnB skill installed successfully!${RESET}"
echo ""
echo "What was set up:"
ok "AgentBnB CLI available as 'agentbnb'"
ok "Config directory: ~/.agentbnb/"
ok "Registry: https://hub.agentbnb.dev (public network)"
ok "Default autonomy tier: Tier 3 (ask before all transactions)"
ok "Default credit reserve: 20 credits"

# Verify identity.json was created (v4.0+ feature)
if [ -f "$HOME/.agentbnb/identity.json" ]; then
  ok "Agent identity: ~/.agentbnb/identity.json"
else
  warn "identity.json not found — will be created on next agentbnb init"
fi

if [ -n "$SOUL_PATH" ]; then
  ok "Capability card synced from SOUL.md"
fi

echo ""
echo "Next steps:"
echo "  1. Run ${BOLD}agentbnb serve${RESET} to start accepting requests"
echo "  2. Run ${BOLD}agentbnb openclaw status${RESET} to see your sync state"
echo "  3. Run ${BOLD}agentbnb openclaw rules${RESET} to see your autonomy rules"
echo "  4. Paste the rules into your HEARTBEAT.md (or copy from HEARTBEAT.rules.md)"
echo ""
echo "Configure autonomy thresholds:"
echo "  ${BOLD}agentbnb config set tier1 10${RESET}   # auto-execute under 10 credits"
echo "  ${BOLD}agentbnb config set tier2 50${RESET}   # notify-after under 50 credits"
echo "  ${BOLD}agentbnb config set reserve 20${RESET} # keep 20 credit reserve"
echo ""
ok "Welcome to the AgentBnB network."
