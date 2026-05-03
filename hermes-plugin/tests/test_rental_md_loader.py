"""Tests for ``rental_md_loader`` — pure-text parser, no I/O dependencies."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from agentbnb_plugin.rental_md_loader import (
    RentalMdError,
    RentalProfile,
    load_rental_md,
    parse_rental_md,
)


def _md(*sections: str) -> str:
    """Helper to build a RENTAL.md test fixture from sections."""
    return "# Agent Rental Profile\n\n" + "\n\n".join(sections) + "\n"


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_parses_minimum_valid_document() -> None:
    text = _md(
        "## Persona\nA brief persona.",
        "## Allowed Tools\n- bgm.compose",
    )
    profile = parse_rental_md(text)
    assert profile.persona == "A brief persona."
    assert profile.allowed_tools == ("bgm.compose",)
    assert profile.forbidden_topics == ()
    assert profile.pricing_hints == {}


def test_parses_full_example_with_all_sections() -> None:
    text = textwrap.dedent("""
        # Agent Rental Profile

        ## Persona
        You are a senior music director with 6 months of experience.

        Multi-paragraph persona content survives intact.

        ## Allowed Tools
        - bgm.compose
        - bgm.list_styles
        - file.upload
        * web.search

        ## Forbidden Topics
        - Do NOT discuss other clients
        - Do NOT reference past conversation history

        ## Pricing Hints
        per_minute_credits: 5
        per_session_max_credits: 300
        default_session_minutes: 60
    """).strip()

    profile = parse_rental_md(text)

    assert profile.persona.startswith("You are a senior music director")
    assert "Multi-paragraph persona content survives" in profile.persona

    assert profile.allowed_tools == (
        "bgm.compose",
        "bgm.list_styles",
        "file.upload",
        "web.search",
    )
    assert profile.forbidden_topics == (
        "Do NOT discuss other clients",
        "Do NOT reference past conversation history",
    )
    assert profile.pricing_hints == {
        "per_minute_credits": 5,
        "per_session_max_credits": 300,
        "default_session_minutes": 60,
    }


def test_pricing_hints_coerce_to_float_when_decimal() -> None:
    text = _md(
        "## Persona\np",
        "## Allowed Tools\n- t",
        "## Pricing Hints\nrate_multiplier: 1.5",
    )
    profile = parse_rental_md(text)
    assert profile.pricing_hints["rate_multiplier"] == 1.5
    assert isinstance(profile.pricing_hints["rate_multiplier"], float)


def test_pricing_hints_keep_strings_when_not_numeric() -> None:
    text = _md(
        "## Persona\np",
        "## Allowed Tools\n- t",
        "## Pricing Hints\ncurrency: AGENTBNB",
    )
    profile = parse_rental_md(text)
    assert profile.pricing_hints["currency"] == "AGENTBNB"


def test_pricing_hints_strip_inline_comments_without_breaking_quoted_values() -> None:
    text = _md(
        "## Persona\np",
        "## Allowed Tools\n- t",
        "## Pricing Hints\n"
        "per_minute_credits: 5  # standard rate\n"
        'tag: "hash # in quotes survives"',
    )
    profile = parse_rental_md(text)
    assert profile.pricing_hints["per_minute_credits"] == 5
    assert profile.pricing_hints["tag"] == "hash # in quotes survives"


def test_unknown_sections_are_silently_ignored() -> None:
    """Forward-compat: authors may add custom H2 sections without failure."""
    text = _md(
        "## Persona\np",
        "## Allowed Tools\n- t",
        "## Author Notes\nThis is just a personal note.",
    )
    profile = parse_rental_md(text)
    assert profile.persona == "p"
    assert profile.allowed_tools == ("t",)


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

def test_missing_persona_section_raises() -> None:
    text = _md("## Allowed Tools\n- t")
    with pytest.raises(RentalMdError, match="Persona"):
        parse_rental_md(text)


def test_missing_allowed_tools_section_raises() -> None:
    text = _md("## Persona\np")
    with pytest.raises(RentalMdError, match="Allowed Tools"):
        parse_rental_md(text)


def test_empty_persona_raises() -> None:
    text = _md("## Persona\n", "## Allowed Tools\n- t")
    with pytest.raises(RentalMdError, match="Persona"):
        parse_rental_md(text)


def test_empty_allowed_tools_raises() -> None:
    """A rental with zero tools cannot work — fail loudly during authoring."""
    text = _md("## Persona\np", "## Allowed Tools\n")
    with pytest.raises(RentalMdError, match="zero tools"):
        parse_rental_md(text)


# ---------------------------------------------------------------------------
# is_tool_allowed
# ---------------------------------------------------------------------------

def test_is_tool_allowed_exact_match_only() -> None:
    profile = RentalProfile(
        persona="p",
        allowed_tools=("bgm.compose", "file.upload"),
        forbidden_topics=(),
    )
    assert profile.is_tool_allowed("bgm.compose")
    assert profile.is_tool_allowed("file.upload")
    assert not profile.is_tool_allowed("bgm.export_admin")
    assert not profile.is_tool_allowed("BGM.COMPOSE")  # case-sensitive on dotted
    assert not profile.is_tool_allowed("bgm")  # no prefix expansion


# ---------------------------------------------------------------------------
# load_rental_md (file I/O)
# ---------------------------------------------------------------------------

def test_load_rental_md_reads_from_disk(tmp_path: Path) -> None:
    p = tmp_path / "RENTAL.md"
    p.write_text(_md("## Persona\nfrom file", "## Allowed Tools\n- t"))
    profile = load_rental_md(p)
    assert profile.persona == "from file"


def test_load_rental_md_expands_user_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    target = tmp_path / "RENTAL.md"
    target.write_text(_md("## Persona\np", "## Allowed Tools\n- t"))
    profile = load_rental_md("~/RENTAL.md")
    assert profile.persona == "p"


def test_load_rental_md_missing_file_raises_file_not_found_with_help(tmp_path: Path) -> None:
    missing = tmp_path / "nope.md"
    with pytest.raises(FileNotFoundError, match=r"examples/RENTAL\.md"):
        load_rental_md(missing)


def test_load_rental_md_loads_real_example_file() -> None:
    """The shipped example must always parse cleanly — guards documentation."""
    example = Path(__file__).parent.parent / "examples" / "RENTAL.md"
    profile = load_rental_md(example)
    assert profile.persona  # non-empty
    assert "bgm.compose" in profile.allowed_tools
    assert profile.pricing_hints.get("per_minute_credits") == 5
