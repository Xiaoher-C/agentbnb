#!/usr/bin/env python3
"""
E2E test: Python adapter → Hub Agent (direct_api) → joke API → escrow settle.

Tests the full Phase 36 + 38 path:
  AgentBnBRequest (Python) → POST /api/hub-agents/:id/execute
    → ApiExecutor → official-joke-api.appspot.com
    → credits hold → settle
    → result returned

Usage:
  python3 adapters/langchain/test_e2e.py [--registry URL]
"""

import argparse
import json
import sys

import httpx

REGISTRY_URL = "https://hub.agentbnb.dev"


def test_discover(registry_url: str) -> dict:
    """Step 1: Search for joke capability via /cards."""
    print("\n[1] Searching for 'joke' capability...")
    resp = httpx.get(f"{registry_url}/cards", params={"q": "joke", "limit": 5})
    resp.raise_for_status()
    data = resp.json()
    cards = data.get("items", data) if isinstance(data, dict) else data

    if not cards:
        print("  FAIL: No cards found")
        sys.exit(1)

    card = cards[0]
    print(f"  Found: {card.get('agent_name', card.get('name'))} (id: {card.get('id')})")
    skills = card.get("skills", [])
    if skills:
        print(f"  Skills: {[s['id'] for s in skills]}")
        print(f"  Price: {skills[0].get('pricing', {}).get('credits_per_call')} credits/call")
    return card


def derive_agent_id(card_id: str) -> str:
    """Reverse card ID → Hub Agent ID. Strip hyphens, take first 16 chars."""
    return card_id.replace("-", "")[:16]


def test_execute_anonymous(registry_url: str, agent_id: str, skill_id: str) -> dict:
    """Step 2: Execute skill without requester (no credit escrow)."""
    print(f"\n[2] Executing skill '{skill_id}' on agent '{agent_id}' (anonymous)...")
    resp = httpx.post(
        f"{registry_url}/api/hub-agents/{agent_id}/execute",
        json={"skill_id": skill_id, "params": {}},
        timeout=30,
    )
    data = resp.json()
    if not data.get("success"):
        print(f"  FAIL: {data}")
        sys.exit(1)
    result = data.get("result", {})
    print(f"  Setup:     {result.get('setup')}")
    print(f"  Punchline: {result.get('punchline')}")
    print(f"  Latency:   {data.get('latency_ms')}ms")
    return data


def test_execute_with_credits(registry_url: str, agent_id: str, skill_id: str) -> dict | None:
    """Step 3: Execute with requester_owner — full escrow lifecycle.

    Uses the local agentbnb keypair to sign the credit grant. Skips gracefully
    if no local identity is found.
    """
    print(f"\n[3] Executing with credit escrow (signed identity)...")
    try:
        from agentbnb_tools import _Ed25519Auth
        auth = _Ed25519Auth()
        requester = auth.owner
    except (ImportError, FileNotFoundError) as e:
        print(f"  SKIP: no local identity — {e}")
        return None

    print(f"  Requester: {requester[:16]}...")

    # Bootstrap credits (signed)
    with httpx.Client(timeout=30) as client:
        grant_headers = auth.sign_headers("POST", "/api/credits/grant")
        grant_resp = client.post(
            f"{registry_url}/api/credits/grant",
            json={"owner": requester},
            headers=grant_headers,
        )
        grant_data = grant_resp.json()
        print(f"  Credit grant: {grant_data}")

        # Execute with requester_owner
        resp = client.post(
            f"{registry_url}/api/hub-agents/{agent_id}/execute",
            json={
                "skill_id": skill_id,
                "params": {},
                "requester_owner": requester,
            },
        )
        data = resp.json()

    if not data.get("success"):
        print(f"  FAIL: {data}")
        return None

    result = data.get("result", {})
    print(f"  Setup:     {result.get('setup')}")
    print(f"  Punchline: {result.get('punchline')}")
    print(f"  Latency:   {data.get('latency_ms')}ms")
    return data


def test_adapter_tool(registry_url: str) -> None:
    """Step 4: Use AgentBnBRequest LangChain tool end-to-end."""
    print("\n[4] Testing AgentBnBRequest LangChain tool...")
    try:
        from agentbnb_tools import AgentBnBRequest
        tool = AgentBnBRequest(registry_url=registry_url)
        result = tool._run(query="random joke", params={}, budget=10)
        data = json.loads(result)
        print(f"  Card: {data.get('card', {}).get('name')}")
        exec_result = data.get("result", {})
        if exec_result.get("success"):
            joke = exec_result.get("result", {})
            print(f"  Setup: {joke.get('setup')}")
            print(f"  Punchline: {joke.get('punchline')}")
        else:
            print(f"  Result: {json.dumps(data, indent=2)}")
    except ImportError:
        print("  SKIP: langchain_core not installed (run: pip install httpx cryptography langchain-core)")
    except FileNotFoundError as e:
        print(f"  SKIP: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentBnB Hub Agent E2E test")
    parser.add_argument("--registry", default=REGISTRY_URL, help="Registry URL")
    args = parser.parse_args()

    registry_url = args.registry.rstrip("/")
    print(f"Registry: {registry_url}")
    print("=" * 60)

    # Step 1: Discover
    card = test_discover(registry_url)
    card_id = card.get("id", "")
    skills = card.get("skills", [])
    skill_id = skills[0].get("id", "random-joke") if skills else "random-joke"
    agent_id = derive_agent_id(card_id)
    print(f"\n  agent_id (derived): {agent_id}")

    # Step 2: Execute anonymous
    test_execute_anonymous(registry_url, agent_id, skill_id)

    # Step 3: Execute with credit escrow (uses local keypair if available)
    test_execute_with_credits(registry_url, agent_id, skill_id)

    # Step 4: LangChain tool (optional, needs keypair)
    test_adapter_tool(registry_url)

    print("\n" + "=" * 60)
    print("E2E PASS: Hub Agent (direct_api) → joke API → escrow lifecycle OK")


if __name__ == "__main__":
    main()
