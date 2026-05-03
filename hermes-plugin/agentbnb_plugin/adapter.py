"""Hermes channel adapter — registers the AgentBnB rental session as a
first-class Hermes channel.

This adapter is the bridge between the Hermes runtime (which delivers
inbound channel events and routes outbound replies) and the
``CuratedRentalRunner`` (which spawns isolated subagents per session and
enforces the privacy contract).

Status: **skeleton**. The concrete ``BasePlatformAdapter`` interface lives
inside ``hermes/gateway/platforms/base.py`` and the surface is still being
finalised by Nous Research. Until we resolve the exact import path during
the first dogfood week, this module documents the integration shape and
exposes a callable ``AgentBnbAdapter`` that the runtime can introspect.
The lifecycle methods (``start`` / ``stop`` / ``send`` / ``list_channels``)
have well-defined behaviour against the AgentBnB Hub and only need a thin
glue layer to satisfy the Hermes ``BasePlatformAdapter`` contract.

Reference patterns:
- ``plugins/platforms/irc/adapter.py`` — IRC channel adapter (architecture model)
- ``gateway/channel_directory.py``     — how channels surface in the directory
- ``gateway/platforms/base.py``        — the BasePlatformAdapter Protocol

When the integration is wired:
1. Inherit from ``BasePlatformAdapter`` (lazy import to avoid circular)
2. In ``start()``: open WebSocket to ``HubClient.relay_ws_url``, register
   the agent's DID, attach incoming-message handler that calls
   ``CuratedRentalRunner.open_session`` / ``deliver_message`` /
   ``end_session`` based on the relay frame type
3. In ``send(target, content)``: post message back to relay over the
   WebSocket so the renter sees it
4. In ``list_channels()``: return one ``ChannelInfo`` per active rental
   so the channel directory can show "Rental from <renter> · 47m left"
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from agentbnb_plugin.commands import CommandConfig
from agentbnb_plugin.hub_client import HubClient
from agentbnb_plugin.identity import IdentityError, load_identity
from agentbnb_plugin.rental_md_loader import load_rental_md
from agentbnb_plugin.subagent_runner import (
    CuratedRentalRunner,
    SubagentRunnerError,
    SubagentSpawner,
    echo_spawner,
)

logger = logging.getLogger(__name__)


PLATFORM_NAME = "agentbnb"


class AgentBnbAdapter:
    """Hermes channel adapter for AgentBnB rental sessions.

    Until the BasePlatformAdapter binding lands, this class is a standalone
    coordinator that the plugin entry point can ``start()`` / ``stop()``.
    Methods named to align with the Hermes ``BasePlatformAdapter`` contract
    so the eventual subclassing is mechanical.

    Wires three components:
    - ``HubClient``                   — REST + WebSocket URL helper
    - ``CuratedRentalRunner``         — privacy-enforcing subagent runtime
    - Hermes runtime (injected later) — channel directory + outbound dispatch
    """

    def __init__(
        self,
        *,
        config: CommandConfig | None = None,
        spawner: SubagentSpawner | None = None,
        memory_adapter: Any | None = None,
    ) -> None:
        self._config = config or CommandConfig.from_env()
        self._runner = CuratedRentalRunner(
            spawner=spawner or echo_spawner,
            memory_adapter=memory_adapter,
        )
        self._hub_client: HubClient | None = None
        self._ws_task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()

    # -----------------------------------------------------------------
    # Lifecycle (BasePlatformAdapter shape)
    # -----------------------------------------------------------------

    async def start(self) -> None:
        """Open the relay WebSocket and begin processing incoming sessions.

        TODO (Phase 2A dogfood): replace the stub run loop with the real
        WebSocket consumer that mirrors ``src/cli/session-action.ts``
        message routing.
        """
        try:
            identity = load_identity(self._config.identity_dir)
        except IdentityError as exc:
            logger.warning("AgentBnB plugin disabled — no identity: %s", exc)
            return

        self._hub_client = HubClient(self._config.hub_url, identity)
        logger.info(
            "AgentBnB adapter starting — DID=%s relay=%s",
            identity.did_key,
            self._hub_client.relay_ws_url,
        )
        # Stub until WebSocket consumer is wired
        self._ws_task = asyncio.create_task(self._stub_run_loop())

    async def stop(self) -> None:
        """Close all active sessions and tear down the relay connection."""
        self._stopped.set()
        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
            self._ws_task = None
        await self._runner.end_all()
        if self._hub_client:
            await self._hub_client.aclose()
            self._hub_client = None
        logger.info("AgentBnB adapter stopped")

    # -----------------------------------------------------------------
    # Outbound (called by Hermes when subagent emits a message)
    # -----------------------------------------------------------------

    async def send(self, target: str, content: str, **_kwargs: Any) -> dict[str, Any]:
        """Send a message back to the renter over the relay WebSocket.

        ``target`` is the AgentBnB session URI: ``agentbnb://session/<id>``.

        TODO (dogfood): forward via the WebSocket message frame schema
        defined in ``src/relay/types.ts:195-214`` (SessionMessage).
        """
        logger.debug("send -> %s: %d chars", target, len(content))
        return {"ok": True, "target": target, "stub": True}

    async def list_channels(self) -> list[dict[str, Any]]:
        """Expose active rentals as channels in the Hermes channel directory."""
        return [
            {
                "platform": PLATFORM_NAME,
                "target": f"agentbnb://session/{sid}",
                "name": f"Rental session {sid}",
                "type": "rental_session",
            }
            for sid in self._runner.active_session_ids
        ]

    # -----------------------------------------------------------------
    # Inbound dispatch (called by the WebSocket consumer once wired)
    # -----------------------------------------------------------------

    async def handle_session_open(
        self,
        *,
        session_id: str,
        renter_did: str,
    ) -> None:
        """Spawn a rental subagent for ``session_id`` per the local RENTAL.md.

        Called by the WebSocket consumer when a ``session_open`` frame
        arrives from the relay.
        """
        try:
            profile = load_rental_md(self._config.rental_md)
        except Exception as exc:
            logger.error("Cannot open rental session %s — RENTAL.md error: %s", session_id, exc)
            return
        try:
            await self._runner.open_session(session_id=session_id, rental_profile=profile)
            logger.info("Rental session %s opened for renter %s", session_id, renter_did)
        except SubagentRunnerError as exc:
            logger.warning("Could not open session %s: %s", session_id, exc)

    async def handle_session_message(
        self,
        *,
        session_id: str,
        content: str,
    ) -> str:
        """Forward an inbound message to the subagent and return the reply."""
        try:
            return await self._runner.deliver_message(session_id, content)
        except SubagentRunnerError as exc:
            logger.warning("Could not deliver message to %s: %s", session_id, exc)
            return f"[adapter error: {exc}]"

    async def handle_session_end(self, *, session_id: str) -> dict[str, Any] | None:
        """Tear down the subagent and return the runner's session summary."""
        try:
            return await self._runner.end_session(session_id)
        except SubagentRunnerError as exc:
            logger.info("Session %s already ended: %s", session_id, exc)
            return None

    # -----------------------------------------------------------------
    # Internal stub loop (replaced by WebSocket consumer)
    # -----------------------------------------------------------------

    async def _stub_run_loop(self) -> None:
        """Placeholder coroutine that just waits for ``stop()``.

        The real implementation will:
          1. Open ``self._hub_client.relay_ws_url`` with ``websockets.connect``
          2. Send a register frame (DID + signed challenge)
          3. Loop ``async for frame in ws`` and dispatch by ``frame['type']``
        """
        await self._stopped.wait()
