"""FastAPI routes mounted at ``/api/plugins/agentbnb/*`` by Hermes.

Provides a small status surface for the Hermes dashboard sidebar so users
can see at a glance:

- whether their agent is published / enabled on AgentBnB
- their DID and current balance
- active rental sessions

Mirrors the plugin_api convention used by ``plugins/example-dashboard``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from agentbnb_plugin.commands import CommandConfig
from agentbnb_plugin.hub_client import HubClient, HubClientError
from agentbnb_plugin.identity import IdentityError, load_identity

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/status")
async def get_status() -> dict[str, Any]:
    """Return DID + enabled + balance + active session ids.

    The Hermes dashboard renders this in the sidebar. Soft-fail (return
    structured error fields) instead of HTTP 5xx so the UI doesn't break
    when the Hub is briefly unreachable.
    """
    cfg = CommandConfig.from_env()
    try:
        identity = load_identity(cfg.identity_dir)
    except IdentityError as exc:
        return {
            "configured": False,
            "error": str(exc),
            "hub_url": cfg.hub_url,
        }

    out: dict[str, Any] = {
        "configured": True,
        "did_key": identity.did_key,
        "agent_id": identity.agent_id,
        "hub_url": cfg.hub_url,
        "balance": None,
        "balance_error": None,
    }

    try:
        async with HubClient(cfg.hub_url, identity) as client:
            me = await client._request(  # type: ignore[attr-defined]
                "GET", "/me", body=None, expect_status=200
            )
        out["balance"] = me.get("balance")
    except HubClientError as exc:
        out["balance_error"] = str(exc)
    return out


@router.get("/sessions")
async def list_sessions() -> dict[str, Any]:
    """List active and recent rental sessions for this owner.

    Until the Hub exposes a per-owner sessions index, this returns whatever
    the local plugin runtime knows about (populated by the channel adapter
    once it lands in Phase 2A.7). For now this is a stub so the dashboard
    can render an empty state.
    """
    return {"active": [], "recent": []}


@router.post("/test_connection")
async def test_connection() -> dict[str, Any]:
    """Health check against the configured Hub. Returns ``{ok: bool, ...}``."""
    cfg = CommandConfig.from_env()
    try:
        identity = load_identity(cfg.identity_dir)
    except IdentityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        async with HubClient(cfg.hub_url, identity) as client:
            await client._request(  # type: ignore[attr-defined]
                "GET", "/health", body=None, expect_status=200
            )
    except HubClientError as exc:
        return {"ok": False, "hub_url": cfg.hub_url, "error": str(exc)}
    return {"ok": True, "hub_url": cfg.hub_url}
