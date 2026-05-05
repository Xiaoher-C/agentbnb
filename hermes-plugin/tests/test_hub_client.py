"""Tests for ``hub_client`` — async HTTP wrapper around the Hub REST surface."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from agentbnb_plugin.hub_client import (
    CreatedSession,
    CreatedThread,
    HubAuthError,
    HubClient,
    HubClientError,
    HubNotFoundError,
    HubServerError,
    build_auth_headers,
    canonical_json,
)
from agentbnb_plugin.identity import ensure_identity

# ---------------------------------------------------------------------------
# canonical_json — must match hub/src/lib/crypto.ts canonicalJson
# ---------------------------------------------------------------------------

def test_canonical_json_primitives_match_jsonstringify() -> None:
    assert canonical_json(None) == "null"
    assert canonical_json(True) == "true"
    assert canonical_json(False) == "false"
    assert canonical_json(42) == "42"
    assert canonical_json(3.14) == "3.14"
    assert canonical_json("hello") == '"hello"'


def test_canonical_json_sorts_object_keys_recursively() -> None:
    out = canonical_json({"b": 1, "a": {"d": 2, "c": 3}})
    # Keys at every level must be sorted lexicographically
    assert out == '{"a":{"c":3,"d":2},"b":1}'


def test_canonical_json_preserves_array_order() -> None:
    out = canonical_json([3, 1, 2])
    assert out == "[3,1,2]"


def test_canonical_json_handles_nested_arrays_of_objects() -> None:
    out = canonical_json([{"z": 1, "a": 2}, {"y": 3}])
    assert out == '[{"a":2,"z":1},{"y":3}]'


def test_canonical_json_unicode_strings_pass_through_unescaped() -> None:
    out = canonical_json({"msg": "中文 zh-TW"})
    assert "中文" in out


def test_canonical_json_rejects_unsupported_types() -> None:
    with pytest.raises(TypeError):
        canonical_json({1, 2, 3})  # set is not JSON-serializable


# ---------------------------------------------------------------------------
# build_auth_headers — signature reproducibility
# ---------------------------------------------------------------------------

def test_build_auth_headers_includes_required_x_agent_fields(tmp_path: Path) -> None:
    identity = ensure_identity(tmp_path)
    headers = build_auth_headers(
        identity,
        method="POST",
        path="/api/sessions",
        body={"renter_did": "did:key:z-r"},
        now=datetime(2026, 5, 4, 12, 0, 0, tzinfo=UTC),
    )
    assert headers["X-Agent-Id"] == identity.agent_id
    assert headers["X-Agent-PublicKey"] == identity.public_key_hex
    assert headers["X-Agent-Timestamp"].startswith("2026-05-04T12:00:00")
    assert headers["X-Agent-Signature"]
    # Base64url — no padding, no '+' or '/'
    sig = headers["X-Agent-Signature"]
    assert "=" not in sig
    assert "+" not in sig
    assert "/" not in sig


def test_build_auth_headers_signature_is_deterministic_for_same_inputs(tmp_path: Path) -> None:
    identity = ensure_identity(tmp_path)
    fixed_now = datetime(2026, 5, 4, 12, 0, 0, tzinfo=UTC)
    h1 = build_auth_headers(identity, "GET", "/api/me", body=None, now=fixed_now)
    h2 = build_auth_headers(identity, "GET", "/api/me", body=None, now=fixed_now)
    assert h1["X-Agent-Signature"] == h2["X-Agent-Signature"]


def test_build_auth_headers_signature_differs_when_path_changes(tmp_path: Path) -> None:
    identity = ensure_identity(tmp_path)
    fixed_now = datetime(2026, 5, 4, 12, 0, 0, tzinfo=UTC)
    h1 = build_auth_headers(identity, "GET", "/api/me", body=None, now=fixed_now)
    h2 = build_auth_headers(identity, "GET", "/api/sessions", body=None, now=fixed_now)
    assert h1["X-Agent-Signature"] != h2["X-Agent-Signature"]


def test_build_auth_headers_signature_round_trips_with_verify_key(tmp_path: Path) -> None:
    """A signature produced here verifies with the embedded public key, which
    proves canonical_json + sign agree end-to-end. The Hub does the equivalent
    verification — if this passes, real auth will too as long as their
    canonicalization matches."""
    identity = ensure_identity(tmp_path)
    fixed_now = datetime(2026, 5, 4, 12, 0, 0, tzinfo=UTC)
    body = {"foo": "bar", "qty": 3}
    headers = build_auth_headers(identity, "POST", "/api/x?y=1", body=body, now=fixed_now)

    # Reconstruct the canonical bytes and verify
    payload = {
        "method": "POST",
        "path": "/api/x?y=1",
        "timestamp": headers["X-Agent-Timestamp"],
        "publicKey": identity.public_key_hex,
        "agentId": identity.agent_id,
        "params": body,
    }
    canonical_bytes = canonical_json(payload).encode("utf-8")

    import base64
    sig_b64 = headers["X-Agent-Signature"]
    # Restore padding for urlsafe_b64decode
    pad = "=" * (-len(sig_b64) % 4)
    raw_sig = base64.urlsafe_b64decode(sig_b64 + pad)

    identity.verify_key().verify(canonical_bytes, raw_sig)


# ---------------------------------------------------------------------------
# HubClient — request flow + error mapping (mocked transport)
# ---------------------------------------------------------------------------

@pytest.fixture
def identity(tmp_path: Path):
    return ensure_identity(tmp_path)


def _mock_transport(handler) -> httpx.MockTransport:
    """Wrap a request-handler callable as an httpx MockTransport."""
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_create_session_returns_typed_dto(identity) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["body"] = request.read().decode("utf-8")
        captured["headers"] = dict(request.headers)
        return httpx.Response(
            201,
            json={
                "session_id": "sess-1",
                "share_token": "share-1",
                "relay_url": "/ws",
                "status": "open",
            },
        )

    async with HubClient(
        "http://hub.test/", identity, transport=_mock_transport(handler)
    ) as client:
        out = await client.create_session(
            renter_did="did:key:z-r",
            owner_did="did:key:z-o",
            agent_id="agent-x",
            duration_min=30,
            budget_credits=50,
        )

    assert isinstance(out, CreatedSession)
    assert out.session_id == "sess-1"
    assert out.share_token == "share-1"
    # Body went through canonical sort? Server cares about canonical form for
    # signing not for transport — body sent as plain JSON object is fine.
    assert "renter_did" in captured["body"]
    # Signed headers attached
    assert "x-agent-id" in {k.lower() for k in captured["headers"].keys()}
    assert captured["method"] == "POST"


@pytest.mark.asyncio
async def test_get_session_404_raises_hub_not_found(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Session not found"})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        with pytest.raises(HubNotFoundError):
            await client.get_session("missing-id")


@pytest.mark.asyncio
async def test_401_raises_hub_auth_error(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad signature"})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        with pytest.raises(HubAuthError):
            await client.get_session("any")


@pytest.mark.asyncio
async def test_5xx_raises_hub_server_error(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream gone")

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        with pytest.raises(HubServerError):
            await client.get_session("any")


@pytest.mark.asyncio
async def test_open_thread_returns_thread_id(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"thread_id": "thread-1"})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        out = await client.open_thread("sess-1", "title", "desc")
    assert isinstance(out, CreatedThread)
    assert out.thread_id == "thread-1"


@pytest.mark.asyncio
async def test_complete_thread_does_not_raise_on_200(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"thread_id": "t-1", "completed_at": "now"})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        await client.complete_thread("sess-1", "t-1")  # smoke — no return value


@pytest.mark.asyncio
async def test_end_session_returns_outcome_payload(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session_id": "sess-1",
            "outcome": {"summary": {"tasks_done": 1}, "threads": []},
        })

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        out = await client.end_session("sess-1")
    assert out["outcome"]["summary"]["tasks_done"] == 1


@pytest.mark.asyncio
async def test_submit_rating_validates_stars_range(identity) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"rating_id": "rate-1"})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        with pytest.raises(HubClientError, match="stars"):
            await client.submit_rating("sess-1", rater_did="did:key:r", stars=0)
        with pytest.raises(HubClientError, match="stars"):
            await client.submit_rating("sess-1", rater_did="did:key:r", stars=6)
        rid = await client.submit_rating("sess-1", rater_did="did:key:r", stars=4, comment="ok")
    assert rid == "rate-1"


@pytest.mark.asyncio
async def test_get_public_outcome_does_not_send_auth_headers(identity) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json={"share_token": "abc", "threads": []})

    async with HubClient("http://hub.test/", identity, transport=_mock_transport(handler)) as client:
        await client.get_public_outcome("abc")

    # /o/:share_token is intentionally unauthenticated — DO NOT leak signed headers
    assert "x-agent-signature" not in {k.lower() for k in captured["headers"].keys()}


@pytest.mark.asyncio
async def test_relay_ws_url_derives_from_base_url_scheme(identity) -> None:
    async with HubClient("https://hub.agentbnb.dev", identity) as c1:
        assert c1.relay_ws_url == "wss://hub.agentbnb.dev/ws"
    async with HubClient("http://localhost:7777", identity) as c2:
        assert c2.relay_ws_url == "ws://localhost:7777/ws"
