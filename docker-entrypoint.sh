#!/bin/sh
set -e

# Use persistent volume on Fly.io, fallback to $HOME/.agentbnb locally
if [ -d "/data" ]; then
  export AGENTBNB_DIR="/data"
else
  export AGENTBNB_DIR="${AGENTBNB_DIR:-$HOME/.agentbnb}"
fi

# Auto-initialize if not already done
if [ ! -f "$AGENTBNB_DIR/config.json" ]; then
  echo "Auto-initializing AgentBnB registry server..."
  node dist/cli/index.js init --owner hub-registry --yes --no-detect
fi

echo "Data directory: $AGENTBNB_DIR"
ls -la "$AGENTBNB_DIR"/*.db 2>/dev/null || echo "No existing DB files (fresh init)"

# Start the server — registry-only mode (no gateway needed for hub)
exec node dist/cli/index.js serve --registry-port 7701 --port 0 "$@"
