#!/bin/bash
# demo.sh — Single-machine two-agent demo
#
# Runs both agents in isolated temp directories on one machine to demonstrate
# the full AgentBnB flow without needing two physical machines:
#   - Agent A initializes and publishes a capability card
#   - Agent B initializes and connects to Agent A as a peer
#   - Agent B discovers the card in Agent A's registry
#   - (Gateway request step is shown but requires a running handler)
#
# Prerequisites:
#   npm install -g agentbnb    (or: node dist/cli/index.js)
#
# Usage:
#   chmod +x demo.sh
#   ./demo.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use 'agentbnb' if installed globally, otherwise fallback to dist build
AGENTBNB="${AGENTBNB_BIN:-agentbnb}"

echo "=== AgentBnB Two-Agent Demo ==="
echo ""

# ─── Setup isolated config dirs ───────────────────────────────────────────────
AGENT_A_DIR=$(mktemp -d)
AGENT_B_DIR=$(mktemp -d)

cleanup() {
  echo ""
  echo "Cleaning up..."
  # Kill background server if still running
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${AGENT_A_DIR}" "${AGENT_B_DIR}"
  echo "Temp dirs removed."
}
trap cleanup EXIT

echo "Agent A config dir: ${AGENT_A_DIR}"
echo "Agent B config dir: ${AGENT_B_DIR}"
echo ""

# ─── Agent A: Initialize ──────────────────────────────────────────────────────
echo "--- Step 1: Initialize Agent A (alice) ---"
AGENTBNB_DIR="${AGENT_A_DIR}" ${AGENTBNB} init --owner alice --port 7700 --host 127.0.0.1 --json
echo ""

# Extract Agent A's token for later use
ALICE_TOKEN=$(AGENTBNB_DIR="${AGENT_A_DIR}" ${AGENTBNB} status --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('')" 2>/dev/null || \
  cat "${AGENT_A_DIR}/config.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['token'])")

echo "Alice's token: ${ALICE_TOKEN}"
echo ""

# ─── Agent A: Publish capability card ─────────────────────────────────────────
echo "--- Step 2: Agent A publishes text-summarizer ---"
AGENTBNB_DIR="${AGENT_A_DIR}" ${AGENTBNB} publish "${SCRIPT_DIR}/sample-card.json"
echo ""

# ─── Agent A: List published cards ────────────────────────────────────────────
echo "--- Step 3: Agent A's registry ---"
AGENTBNB_DIR="${AGENT_A_DIR}" ${AGENTBNB} discover
echo ""

# ─── Agent B: Initialize ──────────────────────────────────────────────────────
echo "--- Step 4: Initialize Agent B (bob) ---"
AGENTBNB_DIR="${AGENT_B_DIR}" ${AGENTBNB} init --owner bob --port 7701 --host 127.0.0.1 --json
echo ""

# ─── Agent B: Connect to Agent A as a peer ────────────────────────────────────
echo "--- Step 5: Agent B connects to Agent A (alice) ---"
AGENTBNB_DIR="${AGENT_B_DIR}" ${AGENTBNB} connect alice "http://127.0.0.1:7700" "${ALICE_TOKEN}"
echo ""

# ─── Agent B: List peers ──────────────────────────────────────────────────────
echo "--- Step 6: Agent B's peer list ---"
AGENTBNB_DIR="${AGENT_B_DIR}" ${AGENTBNB} peers
echo ""

# ─── Agent A: Show credit status ──────────────────────────────────────────────
echo "--- Step 7: Agent A's credit status ---"
AGENTBNB_DIR="${AGENT_A_DIR}" ${AGENTBNB} status
echo ""

echo "=== Demo complete ==="
echo ""
echo "Next steps for a real two-machine setup:"
echo "  1. Run agent-a-setup.sh on Machine A"
echo "  2. Copy Alice's IP and token"
echo "  3. Run agent-b-setup.sh on Machine B with those values"
echo "  4. Agent B can request capabilities via: agentbnb request <card-id> --peer alice"
