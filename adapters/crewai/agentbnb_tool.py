"""
AgentBnB CrewAI Tools -- Thin HTTP adapter for the AgentBnB Registry API.

Requirements: pip install httpx cryptography crewai

Copyright 2026 Cheng Wen Chen, MIT License
"""

# Requirements: pip install httpx cryptography crewai

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path

import httpx
from crewai.tools import tool
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)
from cryptography.hazmat.primitives.serialization import (
    load_der_private_key,
    load_der_public_key,
)

# ---------------------------------------------------------------------------
# Module-level configuration
# ---------------------------------------------------------------------------

REGISTRY_URL: str = os.environ.get("AGENTBNB_REGISTRY_URL", "http://localhost:3000")
CONFIG_DIR: str = os.environ.get("AGENTBNB_DIR", str(Path.home() / ".agentbnb"))


# ---------------------------------------------------------------------------
# Ed25519 Auth Helper (inline -- no shared module)
# ---------------------------------------------------------------------------


class _Ed25519Auth:
    """Loads Ed25519 keys from disk and produces signed HTTP headers."""

    def __init__(self, config_dir: str) -> None:
        self._config_dir = config_dir
        self._private_key: Ed25519PrivateKey | None = None
        self._public_key_hex: str | None = None

    def _load_keys(self) -> None:
        if self._private_key is not None:
            return
        priv_path = os.path.join(self._config_dir, "private.key")
        pub_path = os.path.join(self._config_dir, "public.key")
        if not os.path.exists(priv_path) or not os.path.exists(pub_path):
            raise FileNotFoundError(
                f"AgentBnB keypair not found in {self._config_dir}. "
                "Run `agentbnb init` to generate one."
            )
        priv_der = Path(priv_path).read_bytes()
        pub_der = Path(pub_path).read_bytes()

        self._private_key = load_der_private_key(priv_der, password=None)  # type: ignore[assignment]
        self._public_key_hex = pub_der.hex()

    @property
    def owner(self) -> str:
        """Return the hex-encoded public key (agent identity)."""
        self._load_keys()
        assert self._public_key_hex is not None
        return self._public_key_hex

    def sign_headers(self, method: str, path: str) -> dict[str, str]:
        """Create the three auth headers required by the AgentBnB Registry."""
        self._load_keys()
        assert self._private_key is not None
        assert self._public_key_hex is not None

        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        payload = {
            "method": method,
            "path": path,
            "publicKey": self._public_key_hex,
            "timestamp": timestamp,
        }
        canonical = json.dumps(payload, sort_keys=True)
        signature_bytes = self._private_key.sign(canonical.encode("utf-8"))
        signature_b64url = (
            base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode("ascii")
        )

        return {
            "X-Agent-PublicKey": self._public_key_hex,
            "X-Agent-Signature": signature_b64url,
            "X-Agent-Timestamp": timestamp,
        }


# Lazily initialized auth helper
_auth = _Ed25519Auth(CONFIG_DIR)


# ---------------------------------------------------------------------------
# CrewAI Tools
# ---------------------------------------------------------------------------


@tool("agentbnb_discover")
def agentbnb_discover(query: str) -> str:
    """Search for AI agent capabilities on the AgentBnB network.

    Returns matching capability cards with name, description, and pricing.

    Args:
        query: Natural language search query (e.g., "translate text", "analyze images")
    """
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{REGISTRY_URL}/cards",
            params={"q": query, "limit": 10},
        )
        resp.raise_for_status()
        cards = resp.json()

    results = [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "description": c.get("description"),
            "pricing": c.get("pricing"),
        }
        for c in cards
    ]
    return json.dumps(results, indent=2)


@tool("agentbnb_request")
def agentbnb_request(query: str, budget: int = 10) -> str:
    """Request an AI agent capability on AgentBnB.

    Searches for matching capabilities, picks the cheapest within budget,
    and holds credits in escrow. Returns matched card info and escrow ID.

    Args:
        query: Natural language query for the capability needed
        budget: Maximum credits to spend (default: 10)
    """
    with httpx.Client(timeout=30) as client:
        # 1. Search for matching cards
        search_resp = client.get(
            f"{REGISTRY_URL}/cards",
            params={"q": query, "limit": 5},
        )
        search_resp.raise_for_status()
        cards = search_resp.json()

        if not cards:
            return json.dumps({"error": f"No capabilities found matching: {query}"})

        # 2. Pick cheapest match within budget
        affordable = [
            c for c in cards
            if c.get("pricing", {}).get("credits_per_call", 999) <= budget
        ]
        if not affordable:
            return json.dumps({
                "error": "No affordable capabilities found within budget",
                "cheapest": cards[0].get("pricing", {}).get("credits_per_call"),
                "budget": budget,
            })

        best = min(affordable, key=lambda c: c["pricing"]["credits_per_call"])
        amount = best["pricing"]["credits_per_call"]

        # 3. Hold credits in escrow
        headers = _auth.sign_headers("POST", "/api/credits/hold")
        hold_resp = client.post(
            f"{REGISTRY_URL}/api/credits/hold",
            json={"amount": amount, "cardId": best["id"]},
            headers=headers,
        )
        hold_resp.raise_for_status()
        hold_data = hold_resp.json()

    return json.dumps({
        "card": {
            "id": best.get("id"),
            "name": best.get("name"),
            "description": best.get("description"),
            "pricing": best.get("pricing"),
        },
        "escrow": hold_data,
        "note": "Credits held in escrow. Execution happens via relay/gateway separately.",
    }, indent=2)


@tool("agentbnb_status")
def agentbnb_status() -> str:
    """Check your AgentBnB agent identity and credit balance.

    No input required. Returns your agent identity (public key) and current
    credit balance from the Registry.
    """
    owner = _auth.owner
    with httpx.Client(timeout=30) as client:
        headers = _auth.sign_headers("GET", f"/api/credits/{owner}")
        resp = client.get(
            f"{REGISTRY_URL}/api/credits/{owner}",
            headers=headers,
        )
        resp.raise_for_status()
        balance_data = resp.json()

    return json.dumps({
        "owner": owner[:16] + "...",
        "public_key": owner,
        "balance": balance_data,
    }, indent=2)
