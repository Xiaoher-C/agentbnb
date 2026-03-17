#!/bin/sh
set -e

# Auto-initialize if not already done
AGENTBNB_DIR="${AGENTBNB_DIR:-$HOME/.agentbnb}"
if [ ! -f "$AGENTBNB_DIR/config.json" ]; then
  echo "Auto-initializing AgentBnB registry server..."
  node dist/cli/index.js init --owner hub-registry --yes --no-detect
fi

# Start the server — registry-only mode (no gateway needed for hub)
exec node dist/cli/index.js serve --registry-port 7701 --port 0 "$@"
