#!/bin/bash
# setup.sh — One-click TTS Studio agent setup for Machine B
#
# Prerequisites:
#   - ELEVENLABS_API_KEY environment variable set
#   - pnpm install completed in project root
#
# Usage:
#   export ELEVENLABS_API_KEY=your-key-here
#   chmod +x setup.sh
#   ./setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AGENTBNB="npx tsx ${PROJECT_ROOT}/src/cli/index.ts"

echo "═══ TTS Studio — Agent Setup ═══"
echo ""

# Check ElevenLabs key
if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then
  echo "❌ ELEVENLABS_API_KEY not set."
  echo "   export ELEVENLABS_API_KEY=your-key-here"
  exit 1
fi
echo "✓ ELEVENLABS_API_KEY found"

# Initialize agent
echo ""
echo "→ Initializing agent..."
${AGENTBNB} init --owner tts-studio --port 7700 --yes --json

# Register v2.0 card
echo ""
echo "→ Registering TTS card..."
npx tsx "${SCRIPT_DIR}/register-card.ts"

echo ""
echo "═══ Setup Complete ═══"
echo ""
echo "Start the agent:"
echo "  ${AGENTBNB} serve --port 7700 --skills-yaml ${SCRIPT_DIR}/skills.yaml"
echo ""
echo "Or with pnpm dev:"
echo "  pnpm dev serve --port 7700 --skills-yaml examples/tts-agent/skills.yaml"
