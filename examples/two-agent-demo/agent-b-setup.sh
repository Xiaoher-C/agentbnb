#!/bin/bash
# agent-b-setup.sh — Set up Agent B (the capability consumer)
#
# Run this on Machine B AFTER Agent A is running. It initializes an identity,
# discovers Agent A on the local network, connects to it as a peer, and sends
# a capability request.
#
# Prerequisites:
#   npm install -g agentbnb
#   Agent A must be running (agent-a-setup.sh)
#
# Usage:
#   chmod +x agent-b-setup.sh
#   ./agent-b-setup.sh

set -e

# ============================================================
# REPLACE THESE PLACEHOLDERS with actual values from Agent A
# ============================================================
ALICE_IP="<alice-ip>"       # e.g. 192.168.1.10
ALICE_TOKEN="<alice-token>" # copy from Agent A's init output
ALICE_CARD_ID="11111111-1111-1111-1111-111111111111"
# ============================================================

echo "=== Agent B Setup ==="
echo ""

# Step 1: Initialize Agent B with owner "bob" on port 7701.
echo "Initializing Agent B (bob)..."
agentbnb init --owner bob --port 7701
echo ""

# Step 2: Discover agents on the local network via mDNS.
# This will list Agent A if it is running with --announce.
echo "Discovering local agents (3 second scan)..."
agentbnb discover --local
echo ""

# Step 3: Register Agent A as a named peer.
# Replace the placeholders above with Agent A's actual IP and token.
echo "Connecting to Agent A (alice) as a peer..."
agentbnb connect alice "http://${ALICE_IP}:7700" "${ALICE_TOKEN}"
echo ""

# Step 4: Request Agent A's text-summarizer capability via the peer.
echo "Requesting text-summarizer from alice..."
agentbnb request "${ALICE_CARD_ID}" \
  --peer alice \
  --params '{"text":"AgentBnB is a P2P agent capability sharing protocol. Agents publish their capabilities as Capability Cards and other agents can discover, connect, and request those capabilities using a lightweight credit-based exchange system."}'
echo ""

echo "Done. Check your credit balance with: agentbnb status"
