"""Memory write suppression for rental subagents (ADR-024 Layer 1).

When a rental subagent runs inside a Hermes process, its conversation MUST
NOT reach the host agent's long-term memory store. This module provides the
context manager that wraps a subagent's memory adapter so all ``write`` /
``store`` / ``index`` calls become no-ops for the duration of the rental.

Implementation note: the concrete Hermes memory plugin API surface is not
finalised yet — Hermes ships several adapters in ``plugins/memory/`` (mem0,
honcho, holographic, retaindb, supermemory, etc.) and each may have a
slightly different interface. This module exposes a generic suppression
pattern that monkey-patches well-known method names; the actual list is
extended during Phase 2 Track A dogfood once we know which adapter is in
play. The privacy invariant is that NO attempt to write to long-term
memory leaves the subagent process — if a method is missed here, the
plugin should be configured to fail closed (subagent dies on memory call)
rather than silently leaking.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

# Method names commonly used by Hermes memory adapters for write operations.
# Extend this list during dogfood as new adapters are observed.
_KNOWN_WRITE_METHODS: tuple[str, ...] = (
    "write",
    "store",
    "index",
    "remember",
    "save",
    "add",
    "upsert",
    "ingest",
)


@contextmanager
def isolated_memory(memory_adapter: Any) -> Iterator[None]:
    """Disable write operations on a memory adapter for the duration of the
    context.

    All known write methods are replaced with no-ops that log a warning if
    invoked (the warning is the audit trail proving no writes happened).
    Read methods are NOT disabled — a subagent may still consult prior
    context that the owner has explicitly exposed via RENTAL.md (rare; v0
    tools should not require this).

    Restoration is unconditional in the ``finally`` block so an exception
    inside the rental session does not leave the host agent's memory write
    path patched.

    Example::

        from agentbnb_plugin.memory_hook import isolated_memory

        with isolated_memory(host_agent.memory):
            await rental_subagent.run(message)

    """
    if memory_adapter is None:
        # No memory configured — nothing to suppress, contract trivially holds.
        yield
        return

    originals: dict[str, Callable[..., Any]] = {}
    suppressed: list[str] = []

    for method_name in _KNOWN_WRITE_METHODS:
        original = getattr(memory_adapter, method_name, None)
        if not callable(original):
            continue
        originals[method_name] = original
        setattr(
            memory_adapter,
            method_name,
            _make_blocked(method_name),
        )
        suppressed.append(method_name)

    if suppressed:
        logger.debug(
            "isolated_memory active — suppressed methods on %s: %s",
            type(memory_adapter).__name__,
            ", ".join(suppressed),
        )

    try:
        yield
    finally:
        for method_name, original in originals.items():
            setattr(memory_adapter, method_name, original)


def _make_blocked(method_name: str) -> Callable[..., None]:
    """Build a no-op callable that logs a warning when invoked.

    The warning is intentional — it serves as the audit trail for the
    privacy contract. If a rental subagent really tries to write to memory
    we want operators to see it in logs even though the call is suppressed.
    """
    def _blocked(*args: object, **kwargs: object) -> None:
        logger.warning(
            "ADR-024: rental subagent attempted memory.%s(...) — call SUPPRESSED. "
            "If this is expected behaviour for a tool, expose it via RENTAL.md "
            "instead of writing through the host agent's main memory.",
            method_name,
        )
        return None

    _blocked.__name__ = f"_isolated_{method_name}"
    return _blocked


def assert_no_writes_during(memory_adapter: Any) -> _AssertNoWritesGuard:
    """Stricter alternative that RAISES on any write attempt instead of logging.

    Use in tests and during the first-week dogfood to surface adapters /
    code paths that try to leak. Replace with ``isolated_memory`` once the
    surface is known.
    """
    return _AssertNoWritesGuard(memory_adapter)


class _AssertNoWritesGuard:
    """Context manager raising ``RuntimeError`` on any suppressed-method call.

    Internal — use the ``assert_no_writes_during`` helper.
    """

    def __init__(self, memory_adapter: Any) -> None:
        self._adapter = memory_adapter
        self._originals: dict[str, Callable[..., Any]] = {}

    def __enter__(self) -> _AssertNoWritesGuard:
        if self._adapter is None:
            return self
        for method_name in _KNOWN_WRITE_METHODS:
            original = getattr(self._adapter, method_name, None)
            if not callable(original):
                continue
            self._originals[method_name] = original
            setattr(self._adapter, method_name, self._raise_for(method_name))
        return self

    def __exit__(self, *exc: object) -> None:
        for method_name, original in self._originals.items():
            setattr(self._adapter, method_name, original)

    @staticmethod
    def _raise_for(method_name: str) -> Callable[..., None]:
        def _raise(*args: object, **kwargs: object) -> None:
            raise RuntimeError(
                f"ADR-024 violation: rental subagent attempted memory.{method_name}() "
                "but isolated_memory contract forbids it."
            )
        _raise.__name__ = f"_assert_no_{method_name}"
        return _raise
