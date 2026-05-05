"""Async HTTP client to the AgentBnB Hub REST surface.

Wraps the v10 endpoints implemented in
``src/registry/session-routes.ts`` plus the existing card/identity
endpoints used by ``hermes agentbnb publish``.

Authentication mirrors ``hub/src/lib/authHeaders.ts`` exactly so the Hub
can verify signatures with the same canonical-JSON + Ed25519 pipeline used
by the React Hub UI:

    payload = {method, path, timestamp, publicKey, agentId, params: body || None}
    canonical = canonical_json(payload)         # sorted keys recursively
    signature = base64url(ed25519_sign(canonical))

    headers = {
        "X-Agent-Id":        <agent_id>,
        "X-Agent-PublicKey": <hex public key>,
        "X-Agent-Signature": <base64url signature>,
        "X-Agent-Timestamp": <ISO 8601 utc>,
    }

If the canonicalization here drifts from
``src/auth/canonical-json.ts`` / ``hub/src/lib/crypto.ts``, the Hub will
reject every request — keep them in lock-step.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from agentbnb_plugin.identity import AgentBnbIdentity

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class HubClientError(Exception):
    """Base error for hub_client."""


class HubAuthError(HubClientError):
    """Raised when the hub rejects our signed request (401 / 403)."""


class HubNotFoundError(HubClientError):
    """Raised when a resource is not found (404)."""


class HubServerError(HubClientError):
    """Raised on 5xx responses or network failure."""


# ---------------------------------------------------------------------------
# DTOs (parsed responses)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CreatedSession:
    """Response from POST /api/sessions."""
    session_id: str
    share_token: str
    relay_url: str
    status: str


@dataclass(frozen=True)
class CreatedThread:
    """Response from POST /api/sessions/:id/threads."""
    thread_id: str


# ---------------------------------------------------------------------------
# Canonical JSON
# ---------------------------------------------------------------------------

def canonical_json(value: Any) -> str:
    """Serialize ``value`` to canonical JSON (sorted keys, no extra whitespace).

    Mirrors the simplified RFC 8785 implementation in
    ``hub/src/lib/crypto.ts``: primitives via ``JSON.stringify``-equivalent
    ``json.dumps``; arrays in source order; objects with keys sorted
    lexicographically at every level. Unicode escaping is disabled so the
    bytes hashed match the JS side exactly.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        # ``json.dumps`` matches JS ``JSON.stringify`` for these types
        # (booleans, numbers, strings, null).
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(x) for x in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        parts = [json.dumps(k, ensure_ascii=False) + ":" + canonical_json(value[k]) for k in keys]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"Cannot canonicalize value of type {type(value).__name__}")


def _base64url_encode(data: bytes) -> str:
    """RFC 4648 §5 base64url, no padding (matches JS btoa-based implementation)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ---------------------------------------------------------------------------
# Auth headers
# ---------------------------------------------------------------------------

def build_auth_headers(
    identity: AgentBnbIdentity,
    method: str,
    path: str,
    body: Any | None,
    *,
    now: datetime | None = None,
) -> dict[str, str]:
    """Build the X-Agent-* signed headers for a single request.

    The ``path`` argument MUST be the request path including any query string
    (e.g. ``/api/sessions/abc?cursor=10``) — NOT the full URL. This matches
    the JS client; signing the full URL would tie signatures to a specific
    deployment host.

    ``body`` should be the JSON-decoded request payload, or ``None`` when
    there is no body. Pass the SAME object you serialize as the request body
    so the canonical form matches.

    ``now`` is injectable for deterministic tests.
    """
    timestamp = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"
    payload = {
        "method": method.upper(),
        "path": path,
        "timestamp": timestamp,
        "publicKey": identity.public_key_hex,
        "agentId": identity.agent_id,
        "params": body if body is not None else None,
    }
    canonical = canonical_json(payload)
    signature_bytes = identity.sign(canonical.encode("utf-8"))
    return {
        "X-Agent-Id": identity.agent_id,
        "X-Agent-PublicKey": identity.public_key_hex,
        "X-Agent-Signature": _base64url_encode(signature_bytes),
        "X-Agent-Timestamp": timestamp,
    }


# ---------------------------------------------------------------------------
# Hub client
# ---------------------------------------------------------------------------

class HubClient:
    """Async HTTP client for the AgentBnB Hub.

    Construct with the Hub base URL (e.g. ``https://hub.agentbnb.dev`` or
    ``http://localhost:7777`` for local dev) and an ``AgentBnbIdentity`` for
    DID-signed auth. Use as an async context manager so connections are
    pooled and reused:

        async with HubClient(base_url, identity) as client:
            session = await client.create_session(...)
            thread  = await client.open_thread(session.session_id, "task A")
            ...
            await client.end_session(session.session_id)
    """

    def __init__(
        self,
        base_url: str,
        identity: AgentBnbIdentity,
        *,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not base_url:
            raise HubClientError("base_url is required")
        # Ensure trailing slash so urljoin('/api/sessions') works as expected
        self._base_url = base_url if base_url.endswith("/") else base_url + "/"
        self._identity = identity
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
            transport=transport,
        )

    async def __aenter__(self) -> HubClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def relay_ws_url(self) -> str:
        """Derive the WebSocket relay URL from the Hub base URL.

        ``https://hub.agentbnb.dev`` → ``wss://hub.agentbnb.dev/ws``
        ``http://localhost:7777``    → ``ws://localhost:7777/ws``
        """
        parsed = urlparse(self._base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return f"{scheme}://{parsed.netloc}/ws"

    # -----------------------------------------------------------------
    # v10 rental session lifecycle
    # -----------------------------------------------------------------

    async def create_session(
        self,
        *,
        renter_did: str,
        owner_did: str,
        agent_id: str,
        duration_min: int,
        budget_credits: int,
        card_id: str | None = None,
        current_mode: Literal["direct", "proxy"] = "direct",
    ) -> CreatedSession:
        """POST /api/sessions — create a rental session record."""
        body: dict[str, Any] = {
            "renter_did": renter_did,
            "owner_did": owner_did,
            "agent_id": agent_id,
            "duration_min": duration_min,
            "budget_credits": budget_credits,
            "current_mode": current_mode,
        }
        if card_id is not None:
            body["card_id"] = card_id
        data = await self._request("POST", "/api/sessions", body=body, expect_status=201)
        return CreatedSession(
            session_id=data["session_id"],
            share_token=data["share_token"],
            relay_url=data["relay_url"],
            status=data["status"],
        )

    async def get_session(self, session_id: str) -> dict[str, Any]:
        """GET /api/sessions/:id — read session metadata."""
        return await self._request("GET", f"/api/sessions/{session_id}", body=None)

    async def open_thread(
        self,
        session_id: str,
        title: str,
        description: str = "",
    ) -> CreatedThread:
        """POST /api/sessions/:id/threads — open a task thread."""
        body = {"title": title, "description": description}
        data = await self._request(
            "POST", f"/api/sessions/{session_id}/threads", body=body, expect_status=201
        )
        return CreatedThread(thread_id=data["thread_id"])

    async def complete_thread(self, session_id: str, thread_id: str) -> None:
        """POST /api/sessions/:id/threads/:tid/complete."""
        await self._request(
            "POST",
            f"/api/sessions/{session_id}/threads/{thread_id}/complete",
            body=None,
        )

    async def end_session(
        self,
        session_id: str,
        end_reason: Literal["completed", "timeout", "budget_exhausted", "error", "cancelled"] = "completed",
    ) -> dict[str, Any]:
        """POST /api/sessions/:id/end — terminate + persist outcome.

        Returns the response body (``{session_id, outcome}``).
        """
        return await self._request(
            "POST",
            f"/api/sessions/{session_id}/end",
            body={"end_reason": end_reason},
        )

    async def get_outcome(self, session_id: str) -> dict[str, Any]:
        """GET /api/sessions/:id/outcome — outcome snapshot (auth required)."""
        return await self._request("GET", f"/api/sessions/{session_id}/outcome", body=None)

    async def submit_rating(
        self,
        session_id: str,
        *,
        rater_did: str,
        stars: int,
        comment: str = "",
    ) -> str:
        """POST /api/sessions/:id/rating — submit renter rating.

        Returns the new rating id.
        """
        if not 1 <= stars <= 5:
            raise HubClientError(f"stars must be 1..5, got {stars}")
        body = {"rater_did": rater_did, "stars": stars, "comment": comment}
        data = await self._request(
            "POST",
            f"/api/sessions/{session_id}/rating",
            body=body,
            expect_status=201,
        )
        return str(data["rating_id"])

    async def get_public_outcome(self, share_token: str) -> dict[str, Any]:
        """GET /o/:share_token — public outcome read, NO auth.

        Used to fetch the same outcome page anyone can see — useful for
        previewing how a session will surface in the Hub gallery before
        sharing the link.
        """
        return await self._request_unauthenticated(
            "GET", f"/o/{share_token}", expect_status=200
        )

    # -----------------------------------------------------------------
    # Internal request plumbing
    # -----------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        body: Any | None,
        expect_status: int = 200,
    ) -> dict[str, Any]:
        """Send an authenticated request and parse the JSON response."""
        headers = build_auth_headers(self._identity, method, path, body)
        try:
            response = await self._client.request(
                method,
                path,
                json=body if body is not None else None,
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise HubServerError(f"Network error calling {method} {path}: {exc}") from exc
        return self._parse_response(response, expect_status, path)

    async def _request_unauthenticated(
        self,
        method: str,
        path: str,
        *,
        expect_status: int = 200,
    ) -> dict[str, Any]:
        """Send a request without auth headers — for /o/:share_token style routes."""
        try:
            response = await self._client.request(method, path)
        except httpx.HTTPError as exc:
            raise HubServerError(f"Network error calling {method} {path}: {exc}") from exc
        return self._parse_response(response, expect_status, path)

    @staticmethod
    def _parse_response(
        response: httpx.Response,
        expect_status: int,
        path: str,
    ) -> dict[str, Any]:
        """Translate HTTP errors to typed exceptions; return JSON body on success."""
        status = response.status_code
        if status == 401 or status == 403:
            raise HubAuthError(
                f"Hub rejected request to {path} ({status}): {response.text[:200]}"
            )
        if status == 404:
            raise HubNotFoundError(f"Not found: {path}")
        if status >= 500:
            raise HubServerError(f"Hub server error on {path} ({status}): {response.text[:200]}")
        if status != expect_status:
            raise HubClientError(
                f"Unexpected status {status} from {path} (expected {expect_status}): "
                f"{response.text[:200]}"
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise HubClientError(f"Hub returned non-JSON response from {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise HubClientError(f"Hub response from {path} was not a JSON object")
        return data
