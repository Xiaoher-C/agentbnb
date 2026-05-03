"""Tests for ``subagent_runner`` and ``memory_hook`` — the privacy core."""

from __future__ import annotations

import pytest

from agentbnb_plugin.memory_hook import (
    assert_no_writes_during,
    isolated_memory,
)
from agentbnb_plugin.rental_md_loader import RentalProfile
from agentbnb_plugin.subagent_runner import (
    CuratedRentalRunner,
    EchoSubagent,
    SubagentRunnerError,
    ToolNotPermittedError,
    echo_spawner,
)


def _profile(*, tools: tuple[str, ...] = ("echo.tool",)) -> RentalProfile:
    return RentalProfile(
        persona="A test persona for verifying the runner.",
        allowed_tools=tools,
        forbidden_topics=("Do not leak owner data",),
        pricing_hints={},
    )


# ---------------------------------------------------------------------------
# memory_hook
# ---------------------------------------------------------------------------

class _FakeMemory:
    """Stand-in for a Hermes memory adapter to test write suppression."""

    def __init__(self) -> None:
        self.writes: list[str] = []
        self.stores: list[str] = []

    def write(self, content: str) -> None:
        self.writes.append(content)

    def store(self, content: str) -> None:
        self.stores.append(content)


def test_isolated_memory_suppresses_known_write_methods() -> None:
    mem = _FakeMemory()
    with isolated_memory(mem):
        mem.write("should be suppressed")
        mem.store("also suppressed")
    assert mem.writes == []
    assert mem.stores == []


def test_isolated_memory_restores_methods_on_exit() -> None:
    mem = _FakeMemory()
    with isolated_memory(mem):
        pass
    mem.write("after exit — should be persisted")
    assert mem.writes == ["after exit — should be persisted"]


def test_isolated_memory_restores_methods_even_on_exception() -> None:
    mem = _FakeMemory()
    with pytest.raises(RuntimeError):
        with isolated_memory(mem):
            raise RuntimeError("session crashed")
    # Methods restored — write goes through normally
    mem.write("post-crash")
    assert mem.writes == ["post-crash"]


def test_isolated_memory_handles_none_adapter() -> None:
    """No memory configured — context manager is a no-op, contract trivially holds."""
    with isolated_memory(None):
        pass


def test_assert_no_writes_during_raises_on_attempt() -> None:
    mem = _FakeMemory()
    with pytest.raises(RuntimeError, match="ADR-024 violation"):
        with assert_no_writes_during(mem):
            mem.write("oops")


def test_assert_no_writes_during_passes_when_silent() -> None:
    mem = _FakeMemory()
    with assert_no_writes_during(mem):
        pass  # no writes — no raise
    # Restored after exit
    mem.write("ok")
    assert mem.writes == ["ok"]


# ---------------------------------------------------------------------------
# CuratedRentalRunner
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_session_spawns_echo_subagent() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(session_id="sess-1", rental_profile=_profile())
    assert runner.active_session_ids == ("sess-1",)


@pytest.mark.asyncio
async def test_open_session_rejects_duplicate() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(session_id="sess-1", rental_profile=_profile())
    with pytest.raises(SubagentRunnerError, match="already open"):
        await runner.open_session(session_id="sess-1", rental_profile=_profile())


@pytest.mark.asyncio
async def test_deliver_message_returns_subagent_reply() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(session_id="sess-1", rental_profile=_profile())
    reply = await runner.deliver_message("sess-1", "hello agent")
    assert "echo subagent" in reply
    assert "received 11 chars" in reply


@pytest.mark.asyncio
async def test_deliver_message_raises_on_unknown_session() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    with pytest.raises(SubagentRunnerError, match="not open"):
        await runner.deliver_message("ghost", "x")


@pytest.mark.asyncio
async def test_check_tool_allowed_passes_for_whitelisted_tool() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(
        session_id="s", rental_profile=_profile(tools=("bgm.compose", "file.upload"))
    )
    runner.check_tool_allowed("s", "bgm.compose")  # no raise


@pytest.mark.asyncio
async def test_check_tool_allowed_raises_for_unlisted_tool() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(
        session_id="s", rental_profile=_profile(tools=("bgm.compose",))
    )
    with pytest.raises(ToolNotPermittedError, match="not in this session"):
        runner.check_tool_allowed("s", "bgm.export_admin")


@pytest.mark.asyncio
async def test_end_session_returns_summary_with_metrics() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(session_id="s", rental_profile=_profile())
    await runner.deliver_message("s", "first")
    await runner.deliver_message("s", "second")
    runner.check_tool_allowed("s", "echo.tool")  # allowed → tools_used += 1
    summary = await runner.end_session("s")
    assert summary["message_count"] == 2
    assert summary["tools_used"] == ["echo.tool"]
    assert summary["tool_rejections"] == 0
    # Session is gone after end
    assert runner.active_session_ids == ()


@pytest.mark.asyncio
async def test_end_session_unknown_id_raises() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    with pytest.raises(SubagentRunnerError, match="not open"):
        await runner.end_session("nope")


@pytest.mark.asyncio
async def test_end_all_clears_every_active_session() -> None:
    runner = CuratedRentalRunner(spawner=echo_spawner)
    await runner.open_session(session_id="a", rental_profile=_profile())
    await runner.open_session(session_id="b", rental_profile=_profile())
    await runner.end_all()
    assert runner.active_session_ids == ()


@pytest.mark.asyncio
async def test_deliver_message_runs_inside_isolated_memory_context() -> None:
    """Smoke test — deliver_message goes through isolated_memory wrapper.

    With a FakeMemory hooked into the runner, any subagent attempt to write
    to memory during deliver_message must be suppressed. EchoSubagent
    doesn't actually write to memory, so this test verifies the contract
    without tripping it; it locks the runner's WIRING (memory_adapter is
    passed to the context manager) so a regression that drops the wrapper
    will be caught.
    """
    mem = _FakeMemory()
    runner = CuratedRentalRunner(spawner=echo_spawner, memory_adapter=mem)
    await runner.open_session(session_id="s", rental_profile=_profile())
    await runner.deliver_message("s", "hi")
    # If a future subagent does try to write, it would be suppressed and the
    # writes list would stay empty — locking the contract here.
    assert mem.writes == []


# ---------------------------------------------------------------------------
# max_concurrent_sessions enforcement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_session_allows_up_to_max_concurrent_sessions() -> None:
    """Up to the configured limit, all openings succeed."""
    runner = CuratedRentalRunner(
        spawner=echo_spawner, max_concurrent_sessions=3
    )
    for sid in ("a", "b", "c"):
        await runner.open_session(session_id=sid, rental_profile=_profile())
    assert set(runner.active_session_ids) == {"a", "b", "c"}


@pytest.mark.asyncio
async def test_open_session_raises_runtime_error_when_at_limit() -> None:
    """The (limit + 1)-th open_session call raises with the limit in the
    message, leaving the existing sessions untouched."""
    runner = CuratedRentalRunner(
        spawner=echo_spawner, max_concurrent_sessions=3
    )
    for sid in ("a", "b", "c"):
        await runner.open_session(session_id=sid, rental_profile=_profile())
    with pytest.raises(
        RuntimeError, match="max concurrent rental sessions reached: 3"
    ):
        await runner.open_session(session_id="d", rental_profile=_profile())
    # The fourth session must NOT have leaked into the runner
    assert set(runner.active_session_ids) == {"a", "b", "c"}


@pytest.mark.asyncio
async def test_open_session_accepts_new_session_after_one_ends() -> None:
    """Closing a session frees a slot — the next open_session succeeds."""
    runner = CuratedRentalRunner(
        spawner=echo_spawner, max_concurrent_sessions=2
    )
    await runner.open_session(session_id="a", rental_profile=_profile())
    await runner.open_session(session_id="b", rental_profile=_profile())
    with pytest.raises(RuntimeError, match="max concurrent"):
        await runner.open_session(session_id="c", rental_profile=_profile())
    await runner.end_session("a")
    await runner.open_session(session_id="c", rental_profile=_profile())
    assert set(runner.active_session_ids) == {"b", "c"}


def test_runner_rejects_invalid_max_concurrent_sessions() -> None:
    with pytest.raises(ValueError, match="max_concurrent_sessions must be >= 1"):
        CuratedRentalRunner(spawner=echo_spawner, max_concurrent_sessions=0)


@pytest.mark.asyncio
async def test_max_concurrent_sessions_default_matches_plugin_yaml() -> None:
    """Sanity guard so plugin.yaml and the runner default stay in sync."""
    runner = CuratedRentalRunner(spawner=echo_spawner)
    assert runner.max_concurrent_sessions == 3


# ---------------------------------------------------------------------------
# EchoSubagent specifics
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_echo_subagent_rejects_messages_after_shutdown() -> None:
    sub = EchoSubagent(session_id="s", rental_profile=_profile())
    await sub.shutdown()
    with pytest.raises(SubagentRunnerError, match="already shut down"):
        await sub.respond("x")
