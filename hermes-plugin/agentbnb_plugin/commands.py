"""CLI command handlers for the AgentBnB Hermes plugin.

Wires the public commands declared in ``plugin.yaml``:

    hermes agentbnb publish [--rental-md PATH]
    hermes agentbnb status
    hermes agentbnb settle <session_id>

When loaded by the Hermes plugin runtime, these handlers receive the
parsed plugin config (``hub_url``, ``rental_md``, ``identity_dir``, etc.)
and the global Hermes context.

Standalone invocation (for dev / CI) is also supported via
``python -m agentbnb_plugin.commands publish ...`` — the ``main()`` entry
point parses argv with stdlib ``argparse`` so this module has zero
runtime dependency on the Hermes CLI shell.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from agentbnb_plugin.hub_client import HubClient, HubClientError
from agentbnb_plugin.identity import (
    AgentBnbIdentity,
    IdentityError,
    ensure_identity,
    load_identity,
)
from agentbnb_plugin.rental_md_loader import (
    RentalMdError,
    RentalProfile,
    load_rental_md,
)
from agentbnb_plugin.subagent_runner import DEFAULT_MAX_CONCURRENT_SESSIONS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (resolved from plugin.yaml + env, or argv defaults in standalone)
# ---------------------------------------------------------------------------

# Single source of truth lives in subagent_runner; plugin.yaml's
# `max_concurrent_rental_sessions: 3` must stay in sync (guarded by
# `test_max_concurrent_sessions_default_matches_plugin_yaml`).
DEFAULT_MAX_CONCURRENT_RENTAL_SESSIONS = DEFAULT_MAX_CONCURRENT_SESSIONS


@dataclass(frozen=True)
class CommandConfig:
    """Resolved settings every command handler reads."""

    hub_url: str
    rental_md: Path
    identity_dir: Path
    max_concurrent_rental_sessions: int = DEFAULT_MAX_CONCURRENT_RENTAL_SESSIONS

    @classmethod
    def from_env(cls, *, hub_url: str | None = None) -> CommandConfig:
        """Resolve config from env vars with fallback defaults."""
        max_concurrent_raw = os.environ.get(
            "AGENTBNB_MAX_CONCURRENT_RENTAL_SESSIONS"
        )
        max_concurrent = DEFAULT_MAX_CONCURRENT_RENTAL_SESSIONS
        if max_concurrent_raw:
            try:
                parsed = int(max_concurrent_raw)
            except ValueError:
                logger.warning(
                    "AGENTBNB_MAX_CONCURRENT_RENTAL_SESSIONS=%r is not an int; "
                    "falling back to %d",
                    max_concurrent_raw,
                    max_concurrent,
                )
            else:
                if parsed < 1:
                    logger.warning(
                        "AGENTBNB_MAX_CONCURRENT_RENTAL_SESSIONS=%d must be >= 1; "
                        "falling back to %d",
                        parsed,
                        max_concurrent,
                    )
                else:
                    max_concurrent = parsed

        return cls(
            hub_url=(
                hub_url
                or os.environ.get("AGENTBNB_HUB_URL")
                or "https://hub.agentbnb.dev"
            ),
            rental_md=Path(
                os.environ.get("AGENTBNB_RENTAL_MD", "~/.hermes/RENTAL.md")
            ).expanduser(),
            identity_dir=Path(
                os.environ.get("AGENTBNB_IDENTITY_DIR", "~/.hermes/agentbnb")
            ).expanduser(),
            max_concurrent_rental_sessions=max_concurrent,
        )


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

async def cmd_publish(
    *,
    config: CommandConfig | None = None,
    rental_md_override: str | os.PathLike[str] | None = None,
    out=None,
) -> int:
    """Publish the current Hermes agent as a rentable AgentBnB capability.

    Steps:
      1. Ensure ~/.hermes/agentbnb/key.json exists (generate Ed25519 if absent)
      2. Validate RENTAL.md parses cleanly
      3. Push CapabilityCard payload to AgentBnB Hub via HubClient
         (Hub-side card publish endpoint reused from the existing /api/cards)

    Returns 0 on success, non-zero on any failure (printed to ``out``).
    """
    cfg = config or CommandConfig.from_env()
    rental_path = Path(rental_md_override).expanduser() if rental_md_override else cfg.rental_md
    out = out or sys.stdout

    try:
        identity = ensure_identity(cfg.identity_dir)
    except IdentityError as exc:
        print(f"❌ Could not initialize identity: {exc}", file=out)
        return 2

    try:
        profile = load_rental_md(rental_path)
    except FileNotFoundError as exc:
        print(f"❌ {exc}", file=out)
        return 3
    except RentalMdError as exc:
        print(f"❌ RENTAL.md is invalid: {exc}", file=out)
        return 3

    print(f"AgentBnB identity: {identity.did_key}", file=out)
    print(f"Agent id:          {identity.agent_id}", file=out)
    print(f"Loaded RENTAL.md:  {rental_path}", file=out)
    print(f"Allowed tools:     {', '.join(profile.allowed_tools)}", file=out)
    print(f"Hub:               {cfg.hub_url}", file=out)

    # The Hub card-publish endpoint accepts a CapabilityCardV2 payload.
    # That schema lives in src/types/index.ts; what we send here is the
    # minimum viable shape for v10 rental — the Hub will fill in defaults
    # (created_at, online status, etc.).
    card_payload = _build_card_payload(identity=identity, profile=profile)

    try:
        async with HubClient(cfg.hub_url, identity) as client:
            # POST /api/cards is the existing card publish surface (not a v10
            # addition). We pass through hub_client._request to reuse the
            # signed-headers pipeline. Direct method exposure is added in a
            # follow-up commit once the card schema in TS settles for v10.
            data = await client._request(  # type: ignore[attr-defined]
                "POST", "/api/cards", body=card_payload, expect_status=200
            )
    except HubClientError as exc:
        print(f"❌ Hub publish failed: {exc}", file=out)
        return 4

    card_id = data.get("id") or data.get("card_id") or "<unknown>"
    print(f"✅ Published. Card id: {card_id}", file=out)
    print(
        "Next: set `enabled: true` in plugin.yaml so the channel adapter "
        "starts on next gateway start.",
        file=out,
    )
    return 0


async def cmd_status(
    *,
    config: CommandConfig | None = None,
    out=None,
) -> int:
    """Print sync status — DID, balance, recent rental sessions."""
    cfg = config or CommandConfig.from_env()
    out = out or sys.stdout

    try:
        identity = load_identity(cfg.identity_dir)
    except IdentityError as exc:
        print(f"❌ {exc}", file=out)
        return 2

    print(f"DID:           {identity.did_key}", file=out)
    print(f"Agent id:      {identity.agent_id}", file=out)
    print(f"Identity dir:  {cfg.identity_dir}", file=out)
    print(f"Hub:           {cfg.hub_url}", file=out)
    print(f"RENTAL.md:     {cfg.rental_md}", file=out)

    try:
        async with HubClient(cfg.hub_url, identity) as client:
            me = await client._request(  # type: ignore[attr-defined]
                "GET", "/me", body=None, expect_status=200
            )
        balance = me.get("balance")
        if balance is not None:
            print(f"Balance:       {balance} credits", file=out)
    except HubClientError as exc:
        print(f"⚠️  Could not reach Hub: {exc}", file=out)
        return 5
    return 0


async def cmd_settle(
    session_id: str,
    *,
    config: CommandConfig | None = None,
    out=None,
) -> int:
    """Force settle escrow for a session id (recovery for stuck sessions)."""
    cfg = config or CommandConfig.from_env()
    out = out or sys.stdout

    try:
        identity = load_identity(cfg.identity_dir)
    except IdentityError as exc:
        print(f"❌ {exc}", file=out)
        return 2

    try:
        async with HubClient(cfg.hub_url, identity) as client:
            data = await client.end_session(session_id, end_reason="error")
    except HubClientError as exc:
        print(f"❌ Settlement failed: {exc}", file=out)
        return 6

    summary = data.get("outcome", {}).get("summary", {})
    refunded = summary.get("credit_refunded", "?")
    print(f"✅ Session {session_id} settled. Refunded: {refunded} credits", file=out)
    return 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_card_payload(*, identity: AgentBnbIdentity, profile: RentalProfile) -> dict:
    """Construct the CapabilityCard payload sent to /api/cards.

    Minimum viable v10 shape — the full schema continues to live in TS at
    ``src/types/index.ts``. Until the v10 rental-mode card type lands, we
    publish a single skill ``rental_session`` of type ``rental`` and let
    the Hub default everything else.
    """
    return {
        "owner": identity.agent_id,
        "did": identity.did_key,
        "name": "Rental session",
        "description": (profile.persona[:140] + "…") if len(profile.persona) > 140 else profile.persona,
        "skills": [
            {
                "id": "rental_session",
                "name": "Agent rental session",
                "description": "Rent this Hermes-running agent for a time-boxed session",
                "capability_types": ["rental"],
                "visibility": "public",
                "pricing": {
                    "credits_per_minute": int(
                        profile.pricing_hints.get("per_minute_credits", 5) or 5
                    ),
                    "credits_per_session_max": int(
                        profile.pricing_hints.get("per_session_max_credits", 300) or 300
                    ),
                },
            }
        ],
        "rental": {
            "allowed_tools": list(profile.allowed_tools),
            "forbidden_topics": list(profile.forbidden_topics),
        },
    }


# ---------------------------------------------------------------------------
# Standalone CLI entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """``python -m agentbnb_plugin.commands <subcmd>`` for dev / CI use."""
    parser = argparse.ArgumentParser(prog="agentbnb-plugin")
    sub = parser.add_subparsers(dest="cmd", required=True)

    pub = sub.add_parser("publish", help="Publish current Hermes agent as rentable")
    pub.add_argument("--rental-md", help="Path to RENTAL.md (overrides env)")
    pub.add_argument("--hub-url", help="Override hub URL")

    sub.add_parser("status", help="Show sync status, balance, sessions")

    settle = sub.add_parser("settle", help="Force settle a session escrow")
    settle.add_argument("session_id")

    args = parser.parse_args(argv)
    cfg = CommandConfig.from_env(hub_url=getattr(args, "hub_url", None))

    if args.cmd == "publish":
        return asyncio.run(
            cmd_publish(config=cfg, rental_md_override=args.rental_md)
        )
    if args.cmd == "status":
        return asyncio.run(cmd_status(config=cfg))
    if args.cmd == "settle":
        return asyncio.run(cmd_settle(args.session_id, config=cfg))
    parser.error(f"unknown command {args.cmd!r}")
    return 64


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
