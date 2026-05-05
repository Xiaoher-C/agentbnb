"""Tests for ``AgentBnbAdapter`` — the WebSocket relay consumer.

The real adapter talks to the Hub's WebSocket relay; these tests inject a
``FakeWebSocket`` that lets us script inbound frames and capture outbound
sends without spinning up a real network endpoint.
"""

from __future__ import annotations

import asyncio
import json
from collections import deque
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pytest
from websockets.exceptions import ConnectionClosed

from agentbnb_plugin.adapter import AgentBnbAdapter
from agentbnb_plugin.commands import CommandConfig
from agentbnb_plugin.identity import ensure_identity

# ---------------------------------------------------------------------------
# Fake WebSocket helpers
# ---------------------------------------------------------------------------

# Minimal RENTAL.md good enough for ``load_rental_md`` to parse.
# Section headings must match the loader (Persona / Allowed Tools / etc.).
_RENTAL_MD = """\
# Rental Profile: Test

## Persona

A test persona for verifying the adapter end-to-end.

## Allowed Tools

- echo.tool

## Forbidden Topics

- Do not leak owner data
"""


class FakeWebSocket:
    """In-process stand-in for ``websockets.client.WebSocketClientProtocol``.

    Supports the subset the adapter actually uses:
    - ``async for raw in ws:``  → yields scripted inbound frames
    - ``await ws.send(text)``   → captures outbound frames
    - ``await ws.close()``      → marks the socket closed and stops iteration
    """

    def __init__(self, inbound: Iterable[str] | None = None) -> None:
        self.sent: list[str] = []
        self._inbound: deque[str] = deque(inbound or [])
        self._next_event = asyncio.Event()
        if self._inbound:
            self._next_event.set()
        self._closed = False
        self.close_called = False

    # Inbound scripting ---------------------------------------------------
    def push(self, frame: str | dict[str, Any]) -> None:
        """Queue an inbound frame (dict serialised to JSON for convenience)."""
        text = frame if isinstance(frame, str) else json.dumps(frame)
        self._inbound.append(text)
        self._next_event.set()

    def disconnect(self) -> None:
        """Simulate the relay closing the connection."""
        self._closed = True
        self._next_event.set()

    # WebSocket protocol surface -----------------------------------------
    async def send(self, text: str) -> None:
        if self._closed:
            raise ConnectionClosed(None, None)
        self.sent.append(text)

    async def close(self) -> None:
        self.close_called = True
        self._closed = True
        self._next_event.set()

    def __aiter__(self) -> FakeWebSocket:
        return self

    async def __anext__(self) -> str:
        while True:
            if self._inbound:
                return self._inbound.popleft()
            if self._closed:
                raise StopAsyncIteration
            self._next_event.clear()
            await self._next_event.wait()


def _parsed_sent(ws: FakeWebSocket) -> list[dict[str, Any]]:
    """Decode every outbound frame as JSON for easy assertions."""
    return [json.loads(s) for s in ws.sent]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def config(tmp_path: Path) -> CommandConfig:
    """Resolve a test ``CommandConfig`` rooted under ``tmp_path``.

    Generates a fresh identity and writes a minimal RENTAL.md so the adapter
    can open sessions without depending on the user's real ``~/.hermes``.
    """
    identity_dir = tmp_path / "identity"
    rental_md = tmp_path / "RENTAL.md"
    rental_md.write_text(_RENTAL_MD, encoding="utf-8")
    ensure_identity(identity_dir)
    return CommandConfig(
        hub_url="http://localhost:7777",
        rental_md=rental_md,
        identity_dir=identity_dir,
    )


async def _start_adapter_with_ws(
    config: CommandConfig, ws: FakeWebSocket
) -> AgentBnbAdapter:
    """Start an adapter wired to a single ``FakeWebSocket``."""
    async def connector(_url: str) -> FakeWebSocket:
        return ws

    adapter = AgentBnbAdapter(config=config, ws_connect=connector)
    await adapter.start()
    # Yield control so the run loop opens the socket and sends ``register``.
    await _wait_until(lambda: adapter.is_connected, timeout=1.0)
    return adapter


async def _wait_until(
    predicate, *, timeout: float = 1.0, interval: float = 0.01
) -> None:
    """Poll ``predicate`` until it returns truthy or ``timeout`` elapses."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(f"predicate not satisfied within {timeout}s")


# ---------------------------------------------------------------------------
# Test 1 — register frame on connect
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_register_frame_sent_on_connect(config: CommandConfig) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        await _wait_until(lambda: len(ws.sent) >= 1)
        frames = _parsed_sent(ws)
        register = frames[0]
        assert register["type"] == "register"
        # Identity-derived fields must be present and non-empty.
        assert register["agent_id"]
        assert register["owner"] == register["agent_id"]
        assert register["token"]  # public key hex
        # Card payload includes DID for the Hub to resolve identity.
        assert register["card"]["owner"] == register["agent_id"]
        assert register["card"]["did"].startswith("did:key:")
    finally:
        await adapter.stop()


# ---------------------------------------------------------------------------
# Test 2 — session_open routed to runner.open_session
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_open_invokes_runner(config: CommandConfig) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-open-1",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-open-1" in adapter._runner.active_session_ids
        )
        assert adapter._runner.active_session_ids == ("sess-open-1",)
    finally:
        await adapter.stop()


# ---------------------------------------------------------------------------
# Test 3 — session_message forwarded to runner.deliver_message
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_message_dispatches_to_runner(
    config: CommandConfig,
) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-msg-1",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-msg-1" in adapter._runner.active_session_ids
        )

        # Renter sends a message — adapter should deliver to runner AND
        # forward the reply as a ``session_message`` frame.
        ws.push(
            {
                "type": "session_message",
                "session_id": "sess-msg-1",
                "sender": "requester",
                "content": "hi there",
            }
        )

        # Wait until adapter has emitted the provider reply (one register
        # frame, then the provider reply).
        await _wait_until(lambda: len(ws.sent) >= 2)
        frames = _parsed_sent(ws)
        provider_reply = frames[-1]
        assert provider_reply["type"] == "session_message"
        assert provider_reply["session_id"] == "sess-msg-1"
        assert provider_reply["sender"] == "provider"
        # Echo subagent embeds the input length — proves runner ran.
        assert "received" in provider_reply["content"]
    finally:
        await adapter.stop()


@pytest.mark.asyncio
async def test_session_message_from_provider_is_ignored(
    config: CommandConfig,
) -> None:
    """Provider-side echoes from the relay must not trigger a reply loop."""
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-loop",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-loop" in adapter._runner.active_session_ids
        )

        before = len(ws.sent)
        ws.push(
            {
                "type": "session_message",
                "session_id": "sess-loop",
                "sender": "provider",  # our own echo — ignore
                "content": "self echo",
            }
        )
        # Give the run loop a couple of ticks to (incorrectly) react.
        await asyncio.sleep(0.05)
        assert len(ws.sent) == before
    finally:
        await adapter.stop()


# ---------------------------------------------------------------------------
# Test 4 — send() forwards as session_message frame
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_forwards_session_message_frame(
    config: CommandConfig,
) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        result = await adapter.send(
            "agentbnb://session/abc-123", "hello renter"
        )
        assert result == {
            "ok": True,
            "target": "agentbnb://session/abc-123",
            "session_id": "abc-123",
        }
        # First frame is register (sent on connect); the new frame is ours.
        outbound = _parsed_sent(ws)[-1]
        assert outbound == {
            "type": "session_message",
            "session_id": "abc-123",
            "sender": "provider",
            "content": "hello renter",
        }
    finally:
        await adapter.stop()


@pytest.mark.asyncio
async def test_send_rejects_invalid_target(config: CommandConfig) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        result = await adapter.send("not-a-valid-target", "hi")
        assert result["ok"] is False
        assert result["error"] == "invalid_target"
    finally:
        await adapter.stop()


# ---------------------------------------------------------------------------
# Test 5 — reconnect with backoff after disconnect
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reconnect_after_disconnect(
    config: CommandConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the WebSocket closes, the adapter should re-open a new one."""
    # Patch the backoff schedule to keep the test fast — the run loop sleeps
    # for the configured interval between attempts.
    monkeypatch.setattr("agentbnb_plugin.adapter._INITIAL_BACKOFF_S", 0.01)
    monkeypatch.setattr("agentbnb_plugin.adapter._MAX_BACKOFF_S", 0.05)

    sockets: list[FakeWebSocket] = []

    async def connector(_url: str) -> FakeWebSocket:
        ws = FakeWebSocket()
        sockets.append(ws)
        return ws

    adapter = AgentBnbAdapter(config=config, ws_connect=connector)
    await adapter.start()
    try:
        await _wait_until(lambda: len(sockets) >= 1)
        await _wait_until(lambda: len(sockets[0].sent) >= 1)
        # Force a disconnect on the first socket — adapter should reopen.
        sockets[0].disconnect()
        await _wait_until(lambda: len(sockets) >= 2, timeout=2.0)
        # Second socket should also receive a register frame.
        await _wait_until(lambda: len(sockets[1].sent) >= 1, timeout=2.0)
        register = json.loads(sockets[1].sent[0])
        assert register["type"] == "register"
    finally:
        await adapter.stop()


@pytest.mark.asyncio
async def test_reconnect_backoff_grows_then_caps(
    config: CommandConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Successive connect failures grow the backoff up to the cap."""
    monkeypatch.setattr("agentbnb_plugin.adapter._INITIAL_BACKOFF_S", 0.01)
    monkeypatch.setattr("agentbnb_plugin.adapter._MAX_BACKOFF_S", 0.04)
    monkeypatch.setattr("agentbnb_plugin.adapter._BACKOFF_MULTIPLIER", 2.0)

    attempt_times: list[float] = []

    async def failing_connector(_url: str) -> FakeWebSocket:
        attempt_times.append(asyncio.get_event_loop().time())
        raise OSError("simulated relay down")

    adapter = AgentBnbAdapter(config=config, ws_connect=failing_connector)
    await adapter.start()
    try:
        # Let several attempts accumulate before stopping.
        await _wait_until(lambda: len(attempt_times) >= 4, timeout=2.0)
    finally:
        await adapter.stop()

    # Gaps grow until they hit the cap.
    gaps = [
        round(attempt_times[i + 1] - attempt_times[i], 4)
        for i in range(len(attempt_times) - 1)
    ]
    # First gap close to the initial backoff, eventually plateauing at cap.
    assert gaps[0] >= 0.005, f"first gap too small: {gaps}"
    assert max(gaps) <= 0.06, f"backoff exceeded cap: {gaps}"


# ---------------------------------------------------------------------------
# Test 6 — stop() closes WebSocket cleanly
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stop_closes_socket_and_drains_sessions(
    config: CommandConfig,
) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)

    # Open one rental session so we can verify it's torn down by stop().
    ws.push(
        {
            "type": "session_open",
            "session_id": "sess-stop-1",
            "requester_id": "did:key:z-renter",
        }
    )
    await _wait_until(lambda: "sess-stop-1" in adapter._runner.active_session_ids)

    await adapter.stop()
    assert ws.close_called is True
    # Runner should be drained.
    assert adapter._runner.active_session_ids == ()
    # Run-loop task is done.
    assert adapter._ws_task is None


@pytest.mark.asyncio
async def test_stop_without_start_is_noop(config: CommandConfig) -> None:
    adapter = AgentBnbAdapter(config=config)
    # Should not raise even though start() was never called.
    await adapter.stop()


# ---------------------------------------------------------------------------
# Test 7 — session_end + terminal frames clean up runner state
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_end_frame_tears_down_runner(
    config: CommandConfig,
) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-end-1",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-end-1" in adapter._runner.active_session_ids
        )
        ws.push({"type": "session_end", "session_id": "sess-end-1"})
        await _wait_until(
            lambda: adapter._runner.active_session_ids == ()
        )
    finally:
        await adapter.stop()


@pytest.mark.asyncio
async def test_session_settled_frame_cleans_up(config: CommandConfig) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-settled-1",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-settled-1" in adapter._runner.active_session_ids
        )
        ws.push(
            {
                "type": "session_settled",
                "session_id": "sess-settled-1",
                "total_cost": 12,
                "messages_count": 1,
                "duration_seconds": 30,
                "refunded": 0,
            }
        )
        await _wait_until(
            lambda: adapter._runner.active_session_ids == ()
        )
    finally:
        await adapter.stop()


# ---------------------------------------------------------------------------
# Test 8 — malformed frames are ignored, not fatal
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_malformed_frames_are_ignored(config: CommandConfig) -> None:
    ws = FakeWebSocket()
    adapter = await _start_adapter_with_ws(config, ws)
    try:
        ws.push("not json at all")
        ws.push(json.dumps([1, 2, 3]))  # array, not object
        ws.push({"type": "unknown_type", "session_id": "x"})
        # Push a valid frame after the noise — it must still be processed.
        ws.push(
            {
                "type": "session_open",
                "session_id": "sess-after-noise",
                "requester_id": "did:key:z-renter",
            }
        )
        await _wait_until(
            lambda: "sess-after-noise" in adapter._runner.active_session_ids
        )
    finally:
        await adapter.stop()
