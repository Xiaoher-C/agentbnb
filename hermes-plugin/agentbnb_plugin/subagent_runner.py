"""Curated Rental Runner — privacy-preserving subagent runtime.

This is the core of ADR-024 Layer 1 architectural privacy enforcement on
the supply side. For every incoming rental session, the runner spawns an
isolated Hermes subagent loaded with the owner-curated ``RentalProfile``
(persona + tool whitelist + forbidden topics) — NOT the host agent's main
SOUL/SPIRIT — wrapped in a memory-isolation context so no rental
conversation reaches the host's long-term memory.

The Hermes subagent spawn API is referenced in the Hermes README ("Spawn
isolated subagents for parallel workstreams") but the concrete Python
function path is being resolved during the first dogfood week. Until then,
this module exposes a ``SubagentSpawner`` Protocol so callers can inject
the actual spawn entry point at runtime, and ships an ``EchoSubagent``
fallback that proves the rest of the pipeline (RENTAL.md loading, tool
whitelist, memory hook) end-to-end without depending on a real Hermes
process.

When the Hermes API is wired in, the only change required is to swap the
``EchoSubagent`` factory for the real one — this module's privacy
contract holds regardless of the subagent implementation.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from agentbnb_plugin.memory_hook import isolated_memory
from agentbnb_plugin.rental_md_loader import RentalProfile

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class SubagentRunnerError(Exception):
    """Base error for subagent_runner."""


class ToolNotPermittedError(SubagentRunnerError):
    """Raised when a subagent attempts to call a tool not in the RENTAL whitelist."""


# ---------------------------------------------------------------------------
# Subagent contract
# ---------------------------------------------------------------------------

class Subagent(Protocol):
    """Minimum interface a rental subagent must satisfy.

    Concrete Hermes subagents will likely expose richer functionality;
    the runner only needs the three operations below. Keep this Protocol
    narrow so swapping implementations remains cheap.
    """

    async def respond(self, user_message: str) -> str:
        """Process a single renter message and return the assistant reply."""
        ...

    async def shutdown(self) -> None:
        """Tear down all subagent state. Called once when the session ends."""
        ...


class SubagentSpawner(Protocol):
    """Factory injected at runtime to create a fresh subagent per session.

    The spawner receives the parsed RENTAL profile and the session id so it
    can attribute log lines and route any tool calls through the correct
    audit trail. It must NOT touch the host agent's main memory or expose
    any host SOUL/SPIRIT data — the runner enforces memory isolation but
    cannot stop a misbehaving spawner from leaking SOUL into the prompt.
    """

    async def __call__(
        self,
        *,
        session_id: str,
        rental_profile: RentalProfile,
    ) -> Subagent:
        ...


# ---------------------------------------------------------------------------
# Reference implementation — EchoSubagent
# ---------------------------------------------------------------------------

class EchoSubagent:
    """Minimal Subagent that echoes the renter's message prefixed with persona.

    Used until the Hermes spawn API integration lands. Lets the rest of the
    plugin (adapter / hub_client / memory_hook / rental_md_loader) be
    integration-tested end-to-end without a Hermes process.

    NOT for production rental traffic — produces no real value.
    """

    def __init__(self, *, session_id: str, rental_profile: RentalProfile) -> None:
        self._session_id = session_id
        self._profile = rental_profile
        self._closed = False

    async def respond(self, user_message: str) -> str:
        if self._closed:
            raise SubagentRunnerError("subagent already shut down")
        # Cheap deterministic echo — the persona is referenced so tests can
        # assert the right RENTAL.md is loaded, and the message length so
        # we know the body wasn't truncated.
        persona_summary = self._profile.persona.split("\n", 1)[0][:60]
        return (
            f"[echo subagent · session {self._session_id} · persona: {persona_summary!r}] "
            f"received {len(user_message)} chars"
        )

    async def shutdown(self) -> None:
        self._closed = True


async def echo_spawner(
    *, session_id: str, rental_profile: RentalProfile
) -> EchoSubagent:
    """Default SubagentSpawner — produces an EchoSubagent. Wire your real
    Hermes subagent factory by passing it to ``CuratedRentalRunner`` as
    ``spawner`` instead.
    """
    return EchoSubagent(session_id=session_id, rental_profile=rental_profile)


# ---------------------------------------------------------------------------
# Curated Rental Runner
# ---------------------------------------------------------------------------

@dataclass
class _RunningSession:
    """Per-session bookkeeping kept inside the runner."""

    session_id: str
    profile: RentalProfile
    subagent: Subagent
    message_count: int = 0
    forbidden_attempts: int = 0
    tool_rejections: int = 0
    tools_used: set[str] = field(default_factory=set)
    transcript: list[tuple[str, str]] = field(default_factory=list)


DEFAULT_MAX_CONCURRENT_SESSIONS = 3


class CuratedRentalRunner:
    """Privacy-preserving runtime for AgentBnB rental sessions.

    Each session gets:
    - A fresh subagent spawned via the injected ``spawner``
    - The subagent's memory wrapped in an ``isolated_memory`` context so
      no write reaches the host agent's main memory store
    - A tool dispatch wrapper that rejects any tool not in the owner's
      ``RentalProfile.allowed_tools`` whitelist
    - In-memory transcript that lives ONLY for the duration of the session
      and is discarded on ``end_session``

    The runner enforces ``max_concurrent_sessions`` so a single owner cannot
    be overwhelmed by concurrent rentals. The default mirrors
    ``plugin.yaml`` (``max_concurrent_rental_sessions: 3``); the adapter
    passes the resolved value from ``CommandConfig`` so user overrides win.

    The runner does NOT persist anything. Persistence (escrow, outcome,
    rating) is the Hub's responsibility — the runner only handles message
    flow and privacy boundary enforcement.
    """

    def __init__(
        self,
        *,
        spawner: SubagentSpawner = echo_spawner,
        memory_adapter: Any | None = None,
        max_concurrent_sessions: int = DEFAULT_MAX_CONCURRENT_SESSIONS,
    ) -> None:
        if max_concurrent_sessions < 1:
            raise ValueError(
                "max_concurrent_sessions must be >= 1; "
                f"got {max_concurrent_sessions}"
            )
        self._spawner = spawner
        self._memory_adapter = memory_adapter
        self._max_concurrent_sessions = max_concurrent_sessions
        self._sessions: dict[str, _RunningSession] = {}
        self._lock = asyncio.Lock()

    @property
    def active_session_ids(self) -> tuple[str, ...]:
        return tuple(self._sessions.keys())

    @property
    def max_concurrent_sessions(self) -> int:
        return self._max_concurrent_sessions

    async def open_session(
        self,
        *,
        session_id: str,
        rental_profile: RentalProfile,
    ) -> None:
        """Spawn the rental subagent for ``session_id``.

        Idempotent — calling twice with the same id raises so the caller
        can detect duplicate session_open events from the relay.

        Raises ``RuntimeError`` when the active session count is already at
        ``max_concurrent_sessions``. The check happens while holding the
        runner lock so two concurrent ``open_session`` calls cannot both
        slip past the limit (TOCTOU safe).
        """
        async with self._lock:
            if session_id in self._sessions:
                raise SubagentRunnerError(f"session {session_id} already open")
            if len(self._sessions) >= self._max_concurrent_sessions:
                raise RuntimeError(
                    "max concurrent rental sessions reached: "
                    f"{self._max_concurrent_sessions}"
                )
            subagent = await self._spawner(
                session_id=session_id, rental_profile=rental_profile
            )
            self._sessions[session_id] = _RunningSession(
                session_id=session_id,
                profile=rental_profile,
                subagent=subagent,
            )
            logger.info(
                "rental session %s opened — allowed_tools=%s",
                session_id,
                list(rental_profile.allowed_tools),
            )

    async def deliver_message(self, session_id: str, user_message: str) -> str:
        """Forward a renter message to the subagent and return its reply.

        Wrapped in ``isolated_memory`` so any subagent attempt to write to
        the host's main memory is suppressed (and warned about).
        """
        session = self._require_session(session_id)
        session.message_count += 1
        with isolated_memory(self._memory_adapter):
            reply = await session.subagent.respond(user_message)
        session.transcript.append((user_message, reply))
        return reply

    def check_tool_allowed(self, session_id: str, tool_name: str) -> None:
        """Raise ``ToolNotPermittedError`` if ``tool_name`` is not whitelisted.

        Call this from the tool dispatch layer of the subagent BEFORE
        executing the tool. If the subagent runtime lets you intercept
        tool dispatch, plug this in there. If it doesn't, the runner can't
        enforce the whitelist by itself — flag this with operators during
        Phase 2 dogfood.
        """
        session = self._require_session(session_id)
        if not session.profile.is_tool_allowed(tool_name):
            session.tool_rejections += 1
            raise ToolNotPermittedError(
                f"Tool {tool_name!r} is not in this session's RENTAL.md "
                f"Allowed Tools whitelist. Owner-declared whitelist: "
                f"{list(session.profile.allowed_tools)}"
            )
        session.tools_used.add(tool_name)

    async def end_session(self, session_id: str) -> dict[str, Any]:
        """Tear down the subagent and return a summary for the Hub.

        Returns ``{message_count, tools_used, forbidden_attempts, tool_rejections}``
        so the caller (adapter) can include it in the SessionEnd payload to
        the Hub. Transcript is intentionally NOT returned — it never leaves
        this process.
        """
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            raise SubagentRunnerError(f"session {session_id} not open")
        try:
            await session.subagent.shutdown()
        except Exception as exc:
            logger.warning("subagent shutdown raised for %s: %s", session_id, exc)
        return {
            "message_count": session.message_count,
            "tools_used": sorted(session.tools_used),
            "forbidden_attempts": session.forbidden_attempts,
            "tool_rejections": session.tool_rejections,
        }

    async def end_all(self) -> None:
        """Tear down every active session — used on plugin shutdown."""
        ids = list(self._sessions.keys())
        for sid in ids:
            try:
                await self.end_session(sid)
            except SubagentRunnerError:
                pass  # already gone

    def _require_session(self, session_id: str) -> _RunningSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise SubagentRunnerError(
                f"session {session_id} is not open in this runner"
            )
        return session
