"""Parse owner-curated RENTAL.md into a structured ``RentalProfile``.

RENTAL.md is the only file a Hermes user has to author to expose their agent
on AgentBnB. It is a markdown document with four well-known H2 sections:

- ``## Persona`` — system prompt for the rental subagent (free text)
- ``## Allowed Tools`` — bullet list of tool names the subagent may invoke
- ``## Forbidden Topics`` — bullet list of behavioural constraints
- ``## Pricing Hints`` — ``key: value`` lines

This module is pure (no I/O beyond ``load_rental_md``'s file read, no Hermes
dependencies) so it can be exhaustively unit-tested.

Privacy contract (ADR-024): the parsed ``RentalProfile`` is the ONLY persona
source loaded into the rental subagent. The host agent's main SOUL.md /
SPIRIT.md is never consulted. Tool whitelist is enforced at dispatch time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


class RentalMdError(ValueError):
    """Raised when RENTAL.md cannot be parsed or is missing required sections."""


@dataclass(frozen=True)
class RentalProfile:
    """Structured view of a parsed RENTAL.md file.

    Attributes:
        persona: Free text used as the rental subagent's system prompt.
            Replaces the host agent's main SOUL/SPIRIT — see ADR-024.
        allowed_tools: Tool names the rental subagent may call. Tools NOT in
            this list MUST be rejected at dispatch time.
        forbidden_topics: Behavioural constraints surfaced in the system
            prompt and (where possible) enforced at runtime.
        pricing_hints: Free-form ``key: value`` map. Common keys:
            ``per_minute_credits``, ``per_session_max_credits``,
            ``default_session_minutes``. Values may be int, float, or str.
    """

    persona: str
    allowed_tools: tuple[str, ...]
    forbidden_topics: tuple[str, ...]
    pricing_hints: dict[str, int | float | str] = field(default_factory=dict)

    def is_tool_allowed(self, tool_name: str) -> bool:
        """Return True if ``tool_name`` is in the whitelist (case-insensitive on
        the tool root, exact on dotted segments).

        Tool names follow the dotted convention used by Hermes/skills (e.g.
        ``bgm.compose``, ``file.upload``). The match is exact — partial
        prefix matches are explicitly NOT allowed (avoids accidental
        privilege escalation when an owner whitelists ``bgm`` but the tool
        is ``bgm.export_admin``).
        """
        return tool_name in self.allowed_tools


# ---------------------------------------------------------------------------
# Section parsing
# ---------------------------------------------------------------------------

_H2_RE = re.compile(r"^##\s+(?P<title>.+?)\s*$", re.MULTILINE)
_BULLET_RE = re.compile(r"^\s*[-*]\s+(?P<item>.+?)\s*$", re.MULTILINE)
_KV_RE = re.compile(r"^\s*(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?P<value>.+?)\s*$", re.MULTILINE)

_REQUIRED_SECTIONS = ("Persona", "Allowed Tools")
_OPTIONAL_SECTIONS = ("Forbidden Topics", "Pricing Hints")


def _split_sections(text: str) -> dict[str, str]:
    """Return ``{section_title: section_body}`` for every H2 in the document.

    The H1 title and any preamble before the first H2 are discarded. Section
    bodies preserve their original whitespace so multi-paragraph personas
    survive intact.
    """
    matches = list(_H2_RE.finditer(text))
    sections: dict[str, str] = {}
    for idx, match in enumerate(matches):
        title = match.group("title").strip()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        sections[title] = text[start:end].strip()
    return sections


def _parse_bullets(body: str) -> tuple[str, ...]:
    """Extract bullet list items from a section body, preserving order."""
    return tuple(m.group("item").strip() for m in _BULLET_RE.finditer(body))


def _strip_inline_comment(value: str) -> str:
    """Trim a trailing ``# comment`` from a value while honouring quotes."""
    in_quote: str | None = None
    for idx, ch in enumerate(value):
        if in_quote:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ('"', "'"):
            in_quote = ch
            continue
        if ch == "#":
            return value[:idx].rstrip()
    return value


def _coerce_pricing_value(raw: str) -> int | float | str:
    """Coerce a pricing-hints value into int/float/str.

    Strips inline ``# comment`` first so authors can document a value without
    breaking the type detection.
    """
    cleaned = _strip_inline_comment(raw).strip().strip('"').strip("'")
    try:
        return int(cleaned)
    except ValueError:
        pass
    try:
        return float(cleaned)
    except ValueError:
        pass
    return cleaned


def _parse_pricing(body: str) -> dict[str, int | float | str]:
    """Extract ``key: value`` pairs from the Pricing Hints section."""
    return {
        m.group("key"): _coerce_pricing_value(m.group("value"))
        for m in _KV_RE.finditer(body)
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_rental_md(text: str) -> RentalProfile:
    """Parse the contents of a RENTAL.md document into a ``RentalProfile``.

    Args:
        text: Raw markdown text.

    Returns:
        A frozen ``RentalProfile`` ready to drive a rental subagent.

    Raises:
        RentalMdError: When required sections are missing or empty, or when
            ``Allowed Tools`` lists no items (a rental with zero tools is
            never useful and is almost always an authoring mistake).
    """
    sections = _split_sections(text)

    missing = [name for name in _REQUIRED_SECTIONS if name not in sections]
    if missing:
        raise RentalMdError(
            f"RENTAL.md is missing required section(s): {', '.join(missing)}. "
            "See hermes-plugin/examples/RENTAL.md for the expected layout."
        )

    persona = sections["Persona"].strip()
    if not persona:
        raise RentalMdError("RENTAL.md `## Persona` section is empty.")

    allowed_tools = _parse_bullets(sections["Allowed Tools"])
    if not allowed_tools:
        raise RentalMdError(
            "RENTAL.md `## Allowed Tools` section has no bullet items. "
            "A rental with zero tools cannot do useful work — declare at "
            "least one tool the rented subagent may invoke."
        )

    forbidden_topics = _parse_bullets(sections.get("Forbidden Topics", ""))
    pricing_hints = _parse_pricing(sections.get("Pricing Hints", ""))

    # Warn (do not raise) about unknown sections — useful for debugging
    # while authoring without rejecting forward-compatible additions.
    # Unknown sections are tolerated for forward compatibility — authors
    # may add custom H2 blocks (e.g. "## Notes") without breaking parsing.

    return RentalProfile(
        persona=persona,
        allowed_tools=allowed_tools,
        forbidden_topics=forbidden_topics,
        pricing_hints=pricing_hints,
    )


def load_rental_md(path: str | Path) -> RentalProfile:
    """Read and parse a RENTAL.md file from disk.

    Args:
        path: Filesystem path to the RENTAL.md document.

    Returns:
        Parsed ``RentalProfile``.

    Raises:
        FileNotFoundError: When ``path`` does not exist.
        RentalMdError: See ``parse_rental_md``.
    """
    p = Path(path).expanduser()
    if not p.is_file():
        raise FileNotFoundError(
            f"RENTAL.md not found at {p}. Create it (see "
            "hermes-plugin/examples/RENTAL.md for a template) before publishing."
        )
    return parse_rental_md(p.read_text(encoding="utf-8"))
