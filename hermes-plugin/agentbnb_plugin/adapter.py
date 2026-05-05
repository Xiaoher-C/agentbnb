"""Hermes channel adapter — registers the AgentBnB rental session as a
first-class Hermes channel.

This adapter is the bridge between the Hermes runtime (which delivers
inbound channel events and routes outbound replies) and the
``CuratedRentalRunner`` (which spawns isolated subagents per session and
enforces the privacy contract).

The adapter:
  1. Connects to the Hub's WebSocket relay (``HubClient.relay_ws_url``).
  2. Sends a ``register`` frame matching the schema in
     ``src/relay/types.ts`` / ``src/cli/session-action.ts``.
  3. Routes inbound session frames to the runner:
        ``session_open``    → ``runner.open_session(...)``
        ``session_message`` → ``runner.deliver_message(...)`` and forwards
                              the reply as a ``session_message`` frame
        ``session_end``     → ``runner.end_session(...)``
        ``session_settled`` / ``session_error`` → log + clean up
  4. Reconnects with exponential backoff on disconnect (1 → 2 → 4 → 8 →
     16 → 30s cap) until ``stop()`` is called.

Reference patterns:
- ``plugins/platforms/irc/adapter.py`` — IRC channel adapter (architecture model)
- ``gateway/channel_directory.py``     — how channels surface in the directory
- ``gateway/platforms/base.py``        — the BasePlatformAdapter Protocol

When the Hermes ``BasePlatformAdapter`` binding lands, this class can
inherit from it directly — the public method names already align.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

from agentbnb_plugin.commands import CommandConfig
from agentbnb_plugin.hub_client import HubClient
from agentbnb_plugin.identity import (
    AgentBnbIdentity,
    IdentityError,
    load_identity,
)
from agentbnb_plugin.rental_md_loader import RentalMdError, load_rental_md
from agentbnb_plugin.subagent_runner import (
    CuratedRentalRunner,
    SubagentRunnerError,
    SubagentSpawner,
    echo_spawner,
)

logger = logging.getLogger(__name__)


PLATFORM_NAME = "agentbnb"

# Reconnect backoff schedule: 1s → 2s → 4s → 8s → 16s → 30s (then capped).
_INITIAL_BACKOFF_S = 1.0
_MAX_BACKOFF_S = 30.0
_BACKOFF_MULTIPLIER = 2.0


class AgentBnbAdapter:
    """Hermes channel adapter for AgentBnB rental sessions.

    Until the BasePlatformAdapter binding lands, this class is a standalone
    coordinator that the plugin entry point can ``start()`` / ``stop()``.
    Methods are named to align with the Hermes ``BasePlatformAdapter``
    contract so the eventual subclassing is mechanical.

    Wires three components:
    - ``HubClient``           — REST + WebSocket URL helper
    - ``CuratedRentalRunner`` — privacy-enforcing subagent runtime
    - WebSocket relay         — inbound session frames + outbound replies
    """

    def __init__(
        self,
        *,
        config: CommandConfig | None = None,
        spawner: SubagentSpawner | None = None,
        memory_adapter: Any | None = None,
        ws_connect: Any | None = None,
    ) -> None:
        self._config = config or CommandConfig.from_env()
        self._runner = CuratedRentalRunner(
            spawner=spawner or echo_spawner,
            memory_adapter=memory_adapter,
            max_concurrent_sessions=self._config.max_concurrent_rental_sessions,
        )
        self._hub_client: HubClient | None = None
        self._identity: AgentBnbIdentity | None = None
        # ``Any`` instead of ``ClientConnection`` so tests can inject a fake.
        self._ws: Any | None = None
        self._ws_task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()
        self._ws_connect = ws_connect or websockets.connect

    # -----------------------------------------------------------------
    # Lifecycle (BasePlatformAdapter shape)
    # -----------------------------------------------------------------

    async def start(self) -> None:
        """Open the relay WebSocket and begin processing incoming sessions.

        Returns once the connector task has been scheduled — does NOT block
        until the WebSocket is open. Callers that need to wait for the first
        successful registration should poll ``is_connected``.
        """
        try:
            self._identity = load_identity(self._config.identity_dir)
        except IdentityError as exc:
            logger.warning("AgentBnB plugin disabled — no identity: %s", exc)
            return

        self._hub_client = HubClient(self._config.hub_url, self._identity)
        logger.info(
            "AgentBnB adapter starting — DID=%s relay=%s",
            self._identity.did_key,
            self._hub_client.relay_ws_url,
        )
        self._stopped.clear()
        self._ws_task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        """Close all active sessions and tear down the relay connection."""
        self._stopped.set()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # pragma: no cover — defensive cleanup
                pass
            self._ws = None
        if self._ws_task is not None:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
            self._ws_task = None
        await self._runner.end_all()
        if self._hub_client is not None:
            await self._hub_client.aclose()
            self._hub_client = None
        logger.info("AgentBnB adapter stopped")

    @property
    def is_connected(self) -> bool:
        """``True`` while a WebSocket is open and registered with the relay."""
        return self._ws is not None

    # -----------------------------------------------------------------
    # Outbound (called by Hermes when subagent emits a message)
    # -----------------------------------------------------------------

    async def send(self, target: str, content: str, **_kwargs: Any) -> dict[str, Any]:
        """Send a message back to the renter over the relay WebSocket.

        ``target`` is the AgentBnB session URI: ``agentbnb://session/<id>``.
        The session id is parsed out and the content is forwarded as a
        ``session_message`` frame matching ``SessionMessageMessageSchema``
        in ``src/session/session-types.ts``.

        Returns ``{ok: bool, target, ...}``. ``ok=False`` when the relay is
        not currently connected — the caller can decide to retry or drop.
        """
        session_id = _parse_session_target(target)
        if session_id is None:
            return {"ok": False, "target": target, "error": "invalid_target"}

        attachments = _kwargs.get("attachments")
        frame: dict[str, Any] = {
            "type": "session_message",
            "session_id": session_id,
            "sender": "provider",
            "content": content,
        }
        if attachments is not None:
            frame["attachments"] = attachments

        if not await self._send_frame(frame):
            return {"ok": False, "target": target, "error": "not_connected"}
        return {"ok": True, "target": target, "session_id": session_id}

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
    # Inbound dispatch (called by the WebSocket consumer below)
    # -----------------------------------------------------------------

    async def handle_session_open(
        self,
        *,
        session_id: str,
        renter_did: str,
    ) -> None:
        """Spawn a rental subagent for ``session_id`` per the local RENTAL.md."""
        try:
            profile = load_rental_md(self._config.rental_md)
        except (FileNotFoundError, RentalMdError) as exc:
            logger.error(
                "Cannot open rental session %s — RENTAL.md error: %s",
                session_id,
                exc,
            )
            await self._send_session_error(
                session_id,
                code="rental_md_invalid",
                message=str(exc),
            )
            return
        try:
            await self._runner.open_session(
                session_id=session_id, rental_profile=profile
            )
            logger.info(
                "Rental session %s opened for renter %s", session_id, renter_did
            )
        except SubagentRunnerError as exc:
            logger.warning("Could not open session %s: %s", session_id, exc)
            await self._send_session_error(
                session_id, code="open_failed", message=str(exc)
            )

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

    async def handle_session_end(
        self, *, session_id: str
    ) -> dict[str, Any] | None:
        """Tear down the subagent and return the runner's session summary."""
        try:
            return await self._runner.end_session(session_id)
        except SubagentRunnerError as exc:
            logger.info("Session %s already ended: %s", session_id, exc)
            return None

    # -----------------------------------------------------------------
    # WebSocket consumer + reconnect loop
    # -----------------------------------------------------------------

    async def _run_loop(self) -> None:
        """Connect, consume frames, reconnect with backoff until ``stop()``.

        Each iteration:
          1. Open WebSocket to ``hub_client.relay_ws_url``.
          2. Send ``register`` frame.
          3. Block on ``async for frame in ws`` until disconnect.
          4. On disconnect (or connect error), wait with exponential backoff
             before the next attempt — unless ``self._stopped`` is set.
        """
        backoff = _INITIAL_BACKOFF_S
        while not self._stopped.is_set():
            try:
                await self._connect_and_consume()
                # Clean disconnect — reset backoff before the next attempt.
                backoff = _INITIAL_BACKOFF_S
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "AgentBnB relay connection error: %s (reconnect in %.1fs)",
                    exc,
                    backoff,
                )

            if self._stopped.is_set():
                break

            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=backoff)
                # ``stopped`` triggered during wait — exit loop.
                break
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * _BACKOFF_MULTIPLIER, _MAX_BACKOFF_S)

    async def _connect_and_consume(self) -> None:
        """Open one WebSocket, register, and drain frames until close."""
        assert self._hub_client is not None
        assert self._identity is not None

        ws = await self._ws_connect(self._hub_client.relay_ws_url)
        self._ws = ws
        try:
            await self._send_register()
            async for raw in ws:
                if self._stopped.is_set():
                    break
                await self._dispatch_frame(raw)
        except ConnectionClosed:
            logger.info("AgentBnB relay connection closed")
        finally:
            self._ws = None
            try:
                await ws.close()
            except Exception:  # pragma: no cover — already closed
                pass

    async def _send_register(self) -> None:
        """Send the ``register`` frame matching ``RegisterMessageSchema``."""
        assert self._identity is not None
        identity = self._identity
        frame = {
            "type": "register",
            "owner": identity.agent_id,
            "agent_id": identity.agent_id,
            "token": identity.public_key_hex,
            "card": {
                "id": f"hermes-rental-{identity.agent_id}",
                "owner": identity.agent_id,
                "name": "Hermes rental adapter",
                "did": identity.did_key,
            },
        }
        await self._send_frame(frame)

    async def _dispatch_frame(self, raw: str | bytes) -> None:
        """Parse one inbound frame and route by ``type``."""
        try:
            text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
            msg = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            logger.debug("Ignoring non-JSON relay frame: %s", exc)
            return
        if not isinstance(msg, dict):
            logger.debug("Ignoring non-object relay frame: %r", type(msg).__name__)
            return

        msg_type = msg.get("type")
        if msg_type == "session_open":
            await self._on_session_open(msg)
        elif msg_type == "session_message":
            await self._on_session_message(msg)
        elif msg_type == "session_end":
            await self._on_session_end(msg)
        elif msg_type in {"session_settled", "session_error"}:
            await self._on_session_terminal(msg)
        elif msg_type in {"registered", "session_ack"}:
            logger.debug("relay ack: %s", msg_type)
        else:
            logger.debug("Ignoring unsupported relay frame type: %r", msg_type)

    async def _on_session_open(self, msg: dict[str, Any]) -> None:
        session_id = _str_or_none(msg.get("session_id"))
        renter_did = (
            _str_or_none(msg.get("requester_id"))
            or _str_or_none(msg.get("renter_did"))
            or "<unknown>"
        )
        if not session_id:
            logger.debug("session_open missing session_id — ignored")
            return
        await self.handle_session_open(session_id=session_id, renter_did=renter_did)

    async def _on_session_message(self, msg: dict[str, Any]) -> None:
        session_id = _str_or_none(msg.get("session_id"))
        content = _str_or_none(msg.get("content"))
        sender = _str_or_none(msg.get("sender"))
        # Only react to messages from the renter — the relay echoes every
        # frame to both parties, so dropping our own ``provider`` replies is
        # how we avoid an infinite loop.
        if not session_id or not content or sender == "provider":
            return
        reply = await self.handle_session_message(
            session_id=session_id, content=content
        )
        await self.send(f"agentbnb://session/{session_id}", reply)

    async def _on_session_end(self, msg: dict[str, Any]) -> None:
        session_id = _str_or_none(msg.get("session_id"))
        if not session_id:
            return
        await self.handle_session_end(session_id=session_id)

    async def _on_session_terminal(self, msg: dict[str, Any]) -> None:
        session_id = _str_or_none(msg.get("session_id"))
        msg_type = _str_or_none(msg.get("type"))
        if not session_id:
            return
        logger.info(
            "Relay reported %s for session %s — cleaning up local state",
            msg_type,
            session_id,
        )
        try:
            await self._runner.end_session(session_id)
        except SubagentRunnerError:
            # Already ended locally — fine.
            pass

    # -----------------------------------------------------------------
    # WebSocket send helpers
    # -----------------------------------------------------------------

    async def _send_frame(self, frame: dict[str, Any]) -> bool:
        """Serialize and send ``frame`` over the active WebSocket.

        Returns ``True`` on success, ``False`` if no socket is currently
        open (caller decides retry policy).
        """
        ws = self._ws
        if ws is None:
            return False
        try:
            await ws.send(json.dumps(frame))
            return True
        except ConnectionClosed:
            return False

    async def _send_session_error(
        self, session_id: str, *, code: str, message: str
    ) -> None:
        """Best-effort send of a ``session_error`` frame to the renter."""
        await self._send_frame(
            {
                "type": "session_error",
                "session_id": session_id,
                "code": code,
                "message": message,
            }
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_session_target(target: str) -> str | None:
    """Extract the session id from an ``agentbnb://session/<id>`` URI."""
    prefix = "agentbnb://session/"
    if not target.startswith(prefix):
        return None
    sid = target[len(prefix):].strip()
    return sid or None


def _str_or_none(value: Any) -> str | None:
    """Return ``value`` if it's a non-empty string, otherwise ``None``."""
    if isinstance(value, str) and value:
        return value
    return None
