#!/bin/bash
# agent-a-setup.sh — Set up Agent A (the capability provider)
#
# Run this on Machine A. It initializes an AgentBnB identity, publishes a
# capability card, and starts the gateway server announcing itself on the LAN.
#
# Prerequisites:
#   npm install -g agentbnb
#
# Usage:
#   chmod +x agent-a-setup.sh
#   ./agent-a-setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Agent A Setup ==="
echo ""

# Step 1: Initialize Agent A with owner "alice" on port 7700.
# The gateway_url is auto-set to this machine's LAN IP (e.g. 192.168.1.10:7700).
# Use --host to override if needed.
echo "Initializing Agent A (alice)..."
agentbnb init --owner alice --port 7700
echo ""

# Step 2: Publish the sample capability card.
# This registers text-summarizer in Alice's local registry.
echo "Publishing text-summarizer capability..."
agentbnb publish "$SCRIPT_DIR/sample-card.json"
echo ""

# Step 3: Start the gateway and announce on the local network via mDNS.
# Agent B can discover this agent with: agentbnb discover --local
# Press Ctrl+C to stop the gateway.
echo "Starting gateway (announcing via mDNS)..."
echo "  Agent B can discover this gateway with: agentbnb discover --local"
echo "  Share your token with Agent B: agentbnb status --json | grep token"
echo ""
agentbnb serve --port 7700 --announce
