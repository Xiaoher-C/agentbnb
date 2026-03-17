#!/bin/bash
# demo.sh — Text-Gen Studio end-to-end demo
#
# Demonstrates the full AgentBnB lifecycle:
#   1. Initialize agent identity and credits
#   2. Register v2.0 Capability Card with 3 skills
#   3. Start gateway server with SkillExecutor (Claude Code CLI backend)
#   4. Execute skills via JSON-RPC (text-gen, summarize, research-brief pipeline)
#   5. Verify credit deductions
#
# Prerequisites:
#   - Claude Code CLI installed and authenticated (`claude --print` works)
#   - pnpm install completed in the project root
#
# Usage:
#   chmod +x demo.sh
#   ./demo.sh

set -e

# Allow claude CLI to run inside a Claude Code VS Code session
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Use local CLI via tsx
AGENTBNB="npx tsx ${PROJECT_ROOT}/src/cli/index.ts"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        AgentBnB — Text-Gen Studio Demo                      ║"
echo "║        Agent-to-Agent capability sharing via Claude Code     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Check prerequisites ─────────────────────────────────────────────────────
echo "Checking prerequisites..."
if ! command -v claude &>/dev/null; then
  echo "❌ Claude Code CLI not found. Install it first: https://docs.anthropic.com/claude-code"
  exit 1
fi
echo "✓ Claude Code CLI found"
echo ""

# ─── Setup isolated config dir ───────────────────────────────────────────────
AGENT_DIR=$(mktemp -d)
export AGENTBNB_DIR="${AGENT_DIR}"

cleanup() {
  echo ""
  echo "Cleaning up..."
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${AGENT_DIR}"
  echo "Done."
}
trap cleanup EXIT

echo "Config dir: ${AGENT_DIR}"
echo ""

# ─── Phase 1: Initialize Agent ───────────────────────────────────────────────
echo "═══ Phase 1: Initialize Agent ═══"
echo ""

echo "→ agentbnb init --owner text-gen-studio"
${AGENTBNB} init --owner text-gen-studio --port 7700 --host 127.0.0.1 --no-detect --json
echo ""

# Extract token
TOKEN=$(cat "${AGENT_DIR}/config.json" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Bearer token: ${TOKEN:0:8}..."
echo ""

# ─── Phase 2: Register v2.0 Card ─────────────────────────────────────────────
echo "═══ Phase 2: Register v2.0 Capability Card ═══"
echo ""

echo "→ Registering Text-Gen Studio card (3 skills)"
npx tsx "${SCRIPT_DIR}/register-card.ts"
echo ""

# ─── Phase 3: Start Gateway Server ───────────────────────────────────────────
echo "═══ Phase 3: Start Gateway Server ═══"
echo ""

echo "→ agentbnb serve --port 7700 --skills-yaml skills.yaml"
${AGENTBNB} serve --port 7700 --skills-yaml "${SCRIPT_DIR}/skills.yaml" &
SERVER_PID=$!

# Wait for health endpoint
echo "   Waiting for gateway..."
for i in {1..15}; do
  if curl -s http://localhost:7700/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'" 2>/dev/null; then
    echo "   ✓ Gateway is online (PID ${SERVER_PID})"
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "   ❌ Gateway failed to start"
    exit 1
  fi
  sleep 1
done
echo ""

# ─── Phase 4: Execute Skills ─────────────────────────────────────────────────
echo "═══ Phase 4: Execute Skills via JSON-RPC ═══"
echo ""

# Skill 1: text-gen
echo "→ Skill: text-gen (2 credits)"
echo "  Prompt: Write a haiku about AI agents sharing capabilities"
RESULT=$(curl -s -X POST http://localhost:7700/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"1\",
    \"method\": \"capability.execute\",
    \"params\": {
      \"card_id\": \"00000000-0000-4000-8000-000000000002\",
      \"skill_id\": \"text-gen\",
      \"requester\": \"text-gen-studio\",
      \"prompt\": \"Write a haiku about AI agents sharing capabilities\"
    }
  }")
echo "  Result: $(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result','')[:200] if 'result' in d else d.get('error',{}).get('message','unknown error'))" 2>/dev/null || echo "${RESULT}")"
echo ""

# Skill 2: summarize
echo "→ Skill: summarize (1 credit)"
echo "  Input: A paragraph about AgentBnB"
RESULT=$(curl -s -X POST http://localhost:7700/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"2\",
    \"method\": \"capability.execute\",
    \"params\": {
      \"card_id\": \"00000000-0000-4000-8000-000000000002\",
      \"skill_id\": \"summarize\",
      \"requester\": \"text-gen-studio\",
      \"text\": \"AgentBnB is a peer-to-peer capability sharing protocol for AI agents. It allows agents to publish their idle capabilities as Capability Cards, which other agents can discover and request. The system uses a credit-based escrow mechanism for fair exchange. Think of it as Airbnb for AI agent pipelines - agents list what they can do, and others pay credits to use those capabilities.\"
    }
  }")
echo "  Result: $(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result','')[:200] if 'result' in d else d.get('error',{}).get('message','unknown error'))" 2>/dev/null || echo "${RESULT}")"
echo ""

# Skill 3: research-brief (pipeline)
echo "→ Skill: research-brief (3 credits, pipeline: text-gen → summarize)"
echo "  Topic: AI agent interoperability protocols"
RESULT=$(curl -s -X POST http://localhost:7700/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"3\",
    \"method\": \"capability.execute\",
    \"params\": {
      \"card_id\": \"00000000-0000-4000-8000-000000000002\",
      \"skill_id\": \"research-brief\",
      \"requester\": \"text-gen-studio\",
      \"topic\": \"AI agent interoperability protocols\"
    }
  }")
echo "  Result: $(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result','')[:300] if 'result' in d else d.get('error',{}).get('message','unknown error'))" 2>/dev/null || echo "${RESULT}")"
echo ""

# ─── Phase 5: Credit Verification ────────────────────────────────────────────
echo "═══ Phase 5: Credit Verification ═══"
echo ""
echo "→ agentbnb status"
${AGENTBNB} status
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Demo Complete!                                              ║"
echo "║                                                              ║"
echo "║  Next steps:                                                 ║"
echo "║  • Set up Machine B with TTS Agent (ElevenLabs)              ║"
echo "║  • Connect both agents as peers                              ║"
echo "║  • Exchange capabilities: text-gen ↔ tts                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
