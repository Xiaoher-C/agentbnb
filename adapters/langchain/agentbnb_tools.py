"""
AgentBnB LangChain Tools -- Thin HTTP adapter for the AgentBnB Registry API.

Requirements: pip install httpx cryptography langchain-core

Copyright 2026 Cheng Wen Chen, MIT License
"""

# Requirements: pip install httpx cryptography langchain-core

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Any, Optional, Type

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_der_private_key,
    load_der_public_key,
)
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Ed25519 Auth Helper (inline -- no shared module)
# ---------------------------------------------------------------------------


class _Ed25519Auth:
    """Loads Ed25519 keys from disk and produces signed HTTP headers."""

    def __init__(self, config_dir: str | None = None) -> None:
        self._config_dir = config_dir or os.environ.get(
            "AGENTBNB_DIR", str(Path.home() / ".agentbnb")
        )
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
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        signature_bytes = self._private_key.sign(canonical.encode("utf-8"))
        signature_b64url = (
            base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode("ascii")
        )

        return {
            "X-Agent-PublicKey": self._public_key_hex,
            "X-Agent-Signature": signature_b64url,
            "X-Agent-Timestamp": timestamp,
        }


# ---------------------------------------------------------------------------
# LangChain Tools
# ---------------------------------------------------------------------------


class _DiscoverInput(BaseModel):
    query: str = Field(description="Natural language search query for capabilities")


class AgentBnBDiscover(BaseTool):
    """Search for AI agent capabilities on the AgentBnB network."""

    name: str = "agentbnb_discover"
    description: str = (
        "Search for AI agent capabilities on the AgentBnB network. "
        "Returns matching capability cards with name, description, and pricing."
    )
    args_schema: Type[BaseModel] = _DiscoverInput

    registry_url: str = "http://localhost:3000"
    config_dir: str | None = None
    _auth: _Ed25519Auth | None = None

    def __init__(self, registry_url: str = "http://localhost:3000", config_dir: str | None = None, **kwargs: Any) -> None:
        super().__init__(registry_url=registry_url, config_dir=config_dir, **kwargs)

    def _run(self, query: str) -> str:
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{self.registry_url}/cards",
                params={"q": query, "limit": 10},
            )
            resp.raise_for_status()
            data = resp.json()
            cards = data.get("items", data) if isinstance(data, dict) else data
        results = [
            {
                "id": c.get("id"),
                "name": c.get("name") or c.get("agent_name"),
                "skills": [{"id": s.get("id"), "description": s.get("description"), "pricing": s.get("pricing")} for s in c.get("skills", [])],
                "pricing": c.get("pricing"),
            }
            for c in cards
        ]
        return json.dumps(results, indent=2)

    async def _arun(self, query: str) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.registry_url}/cards",
                params={"q": query, "limit": 10},
            )
            resp.raise_for_status()
            data = resp.json()
            cards = data.get("items", data) if isinstance(data, dict) else data
        results = [
            {
                "id": c.get("id"),
                "name": c.get("name") or c.get("agent_name"),
                "skills": [{"id": s.get("id"), "description": s.get("description"), "pricing": s.get("pricing")} for s in c.get("skills", [])],
                "pricing": c.get("pricing"),
            }
            for c in cards
        ]
        return json.dumps(results, indent=2)


class _RequestInput(BaseModel):
    query: str = Field(description="Natural language query for the capability needed")
    params: dict = Field(default_factory=dict, description="Parameters to pass to the skill execution")
    budget: int = Field(default=10, description="Maximum credits to spend")


def _card_id_to_agent_id(card_id: str) -> str:
    """Derive Hub Agent ID from a card ID.

    Hub Agent card IDs are generated by padding the 16-char agent_id to 32 chars
    with zeros then formatting as a UUID. Reverse: strip hyphens, take first 16 chars.
    """
    return card_id.replace("-", "")[:16]


class AgentBnBRequest(BaseTool):
    """Request an AI agent capability execution on AgentBnB.

    Searches for matching Hub Agent capabilities, executes the skill with full
    escrow lifecycle (hold → execute → settle), and returns the result.
    """

    name: str = "agentbnb_request"
    description: str = (
        "Request and execute an AI agent capability on AgentBnB. "
        "Searches for matching Hub Agent skills, executes with credit escrow, "
        "and returns the skill result directly."
    )
    args_schema: Type[BaseModel] = _RequestInput

    registry_url: str = "http://localhost:3000"
    config_dir: str | None = None

    def __init__(self, registry_url: str = "http://localhost:3000", config_dir: str | None = None, **kwargs: Any) -> None:
        super().__init__(registry_url=registry_url, config_dir=config_dir, **kwargs)
        self._auth_helper = _Ed25519Auth(config_dir)

    def _bootstrap_credits(self, client: httpx.Client, requester_owner: str) -> None:
        """Best-effort credit bootstrap grant (once per identity). Silently ignores errors."""
        try:
            headers = self._auth_helper.sign_headers("POST", "/api/credits/grant")
            client.post(
                f"{self.registry_url}/api/credits/grant",
                json={"owner": requester_owner},
                headers=headers,
                timeout=10,
            )
        except Exception:
            pass

    def _run(self, query: str, params: dict | None = None, budget: int = 10) -> str:
        params = params or {}
        with httpx.Client(timeout=60) as client:
            # 1. Search for matching cards
            search_resp = client.get(
                f"{self.registry_url}/cards",
                params={"q": query, "limit": 5},
            )
            search_resp.raise_for_status()
            search_data = search_resp.json()
            cards = search_data.get("items", search_data) if isinstance(search_data, dict) else search_data

            if not cards:
                return json.dumps({"error": f"No capabilities found matching: {query}"})

            # 2. Pick cheapest skill within budget (check card-level and skill-level pricing)
            def get_price(card: dict) -> int:
                skills = card.get("skills", [])
                if skills:
                    return min(s.get("pricing", {}).get("credits_per_call", 999) for s in skills)
                return card.get("pricing", {}).get("credits_per_call", 999)

            affordable = [c for c in cards if get_price(c) <= budget]
            if not affordable:
                return json.dumps({
                    "error": "No affordable capabilities found within budget",
                    "cheapest": get_price(cards[0]),
                    "budget": budget,
                })

            best = min(affordable, key=get_price)
            card_id = best.get("id", "")

            # 3. Resolve skill_id (first skill on the card)
            skills = best.get("skills", [])
            skill_id = skills[0].get("id", "default") if skills else "default"

            # 4. Derive Hub Agent ID from card ID
            agent_id = _card_id_to_agent_id(card_id)

            # 5. Bootstrap credits for requester (best-effort, once per identity)
            requester_owner = self._auth_helper.owner
            self._bootstrap_credits(client, requester_owner)

            # 6. Execute skill via Hub Agent (hold → execute → settle)
            exec_resp = client.post(
                f"{self.registry_url}/api/hub-agents/{agent_id}/execute",
                json={
                    "skill_id": skill_id,
                    "params": params,
                    "requester_owner": requester_owner,
                },
            )
            exec_data = exec_resp.json()

        return json.dumps({
            "card": {
                "id": card_id,
                "name": best.get("name") or best.get("agent_name"),
                "skill_id": skill_id,
                "pricing": best.get("pricing") or (skills[0].get("pricing") if skills else {}),
            },
            "result": exec_data,
        }, indent=2)

    async def _arun(self, query: str, params: dict | None = None, budget: int = 10) -> str:
        params = params or {}
        async with httpx.AsyncClient(timeout=60) as client:
            # 1. Search for matching cards
            search_resp = await client.get(
                f"{self.registry_url}/cards",
                params={"q": query, "limit": 5},
            )
            search_resp.raise_for_status()
            search_data = search_resp.json()
            cards = search_data.get("items", search_data) if isinstance(search_data, dict) else search_data

            if not cards:
                return json.dumps({"error": f"No capabilities found matching: {query}"})

            def get_price(card: dict) -> int:
                skills = card.get("skills", [])
                if skills:
                    return min(s.get("pricing", {}).get("credits_per_call", 999) for s in skills)
                return card.get("pricing", {}).get("credits_per_call", 999)

            affordable = [c for c in cards if get_price(c) <= budget]
            if not affordable:
                return json.dumps({
                    "error": "No affordable capabilities found within budget",
                    "cheapest": get_price(cards[0]),
                    "budget": budget,
                })

            best = min(affordable, key=get_price)
            card_id = best.get("id", "")
            skills = best.get("skills", [])
            skill_id = skills[0].get("id", "default") if skills else "default"
            agent_id = _card_id_to_agent_id(card_id)

            # Bootstrap credits (best-effort)
            requester_owner = self._auth_helper.owner
            try:
                headers = self._auth_helper.sign_headers("POST", "/api/credits/grant")
                await client.post(
                    f"{self.registry_url}/api/credits/grant",
                    json={"owner": requester_owner},
                    headers=headers,
                    timeout=10,
                )
            except Exception:
                pass

            # Execute via Hub Agent
            exec_resp = await client.post(
                f"{self.registry_url}/api/hub-agents/{agent_id}/execute",
                json={
                    "skill_id": skill_id,
                    "params": params,
                    "requester_owner": requester_owner,
                },
            )
            exec_data = exec_resp.json()

        return json.dumps({
            "card": {
                "id": card_id,
                "name": best.get("name") or best.get("agent_name"),
                "skill_id": skill_id,
                "pricing": best.get("pricing") or (skills[0].get("pricing") if skills else {}),
            },
            "result": exec_data,
        }, indent=2)


class AgentBnBStatus(BaseTool):
    """Check your AgentBnB credit balance and identity."""

    name: str = "agentbnb_status"
    description: str = (
        "Check your AgentBnB agent identity and credit balance. "
        "No input required."
    )

    registry_url: str = "http://localhost:3000"
    config_dir: str | None = None

    def __init__(self, registry_url: str = "http://localhost:3000", config_dir: str | None = None, **kwargs: Any) -> None:
        super().__init__(registry_url=registry_url, config_dir=config_dir, **kwargs)
        self._auth_helper = _Ed25519Auth(config_dir)

    def _run(self) -> str:
        owner = self._auth_helper.owner
        with httpx.Client(timeout=30) as client:
            headers = self._auth_helper.sign_headers("GET", f"/api/credits/{owner}")
            resp = client.get(
                f"{self.registry_url}/api/credits/{owner}",
                headers=headers,
            )
            resp.raise_for_status()
            balance_data = resp.json()

        return json.dumps({
            "owner": owner[:16] + "...",
            "public_key": owner,
            "balance": balance_data,
        }, indent=2)

    async def _arun(self) -> str:
        owner = self._auth_helper.owner
        async with httpx.AsyncClient(timeout=30) as client:
            headers = self._auth_helper.sign_headers("GET", f"/api/credits/{owner}")
            resp = await client.get(
                f"{self.registry_url}/api/credits/{owner}",
                headers=headers,
            )
            resp.raise_for_status()
            balance_data = resp.json()

        return json.dumps({
            "owner": owner[:16] + "...",
            "public_key": owner,
            "balance": balance_data,
        }, indent=2)
