"""Tests for ``identity`` — Ed25519 keypair, did:key derivation, persistence.

The DID derivation must produce identical bytes to the TypeScript core
(`src/identity/did.ts`) so a Hermes-published agent and a CLI-published
agent resolve to the same DID for the same key.
"""

from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest

from agentbnb_plugin.identity import (
    AgentBnbIdentity,
    IdentityError,
    derive_agent_id,
    ensure_identity,
    load_identity,
    to_did_agentbnb,
    to_did_key,
)

# ---------------------------------------------------------------------------
# DID derivation cross-language compatibility
# ---------------------------------------------------------------------------

# Known good vector — produced by running the TS core's toDIDKey
# (src/identity/did.ts) on this same 32-byte public key. Locked here so that
# any future change to the multibase / multicodec encoding which would
# diverge from the TS core trips immediately. To regenerate after a
# legitimate refactor:
#
#   pnpm tsx --eval 'import("./src/identity/did.js").then(m => \
#     console.log(m.toDIDKey("<pubkey-hex>")))'
KNOWN_PUBKEY_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
KNOWN_DID_KEY = "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"


def test_to_did_key_matches_known_vector_from_ts_core() -> None:
    """Locks the multibase / multicodec encoding to the TS implementation."""
    assert to_did_key(KNOWN_PUBKEY_HEX) == KNOWN_DID_KEY


def test_to_did_key_rejects_wrong_length() -> None:
    short = "ab" * 16  # 16 bytes
    with pytest.raises(IdentityError, match="32-byte"):
        to_did_key(short)


def test_to_did_agentbnb_format() -> None:
    assert to_did_agentbnb("0123456789abcdef") == "did:agentbnb:0123456789abcdef"


@pytest.mark.parametrize(
    "bad_id",
    ["", "ABCDEF0123456789", "0123", "0123456789abcdeg", "0123456789abcdef0"],
)
def test_to_did_agentbnb_rejects_malformed(bad_id: str) -> None:
    with pytest.raises(IdentityError, match="16 lowercase hex"):
        to_did_agentbnb(bad_id)


def test_derive_agent_id_is_deterministic_and_well_formed() -> None:
    out = derive_agent_id(KNOWN_PUBKEY_HEX)
    assert len(out) == 16
    assert all(c in "0123456789abcdef" for c in out)
    # Stable across calls
    assert out == derive_agent_id(KNOWN_PUBKEY_HEX)


# ---------------------------------------------------------------------------
# ensure_identity — first-run generation
# ---------------------------------------------------------------------------

def test_ensure_identity_creates_directory_and_keyfile_on_first_run(tmp_path: Path) -> None:
    identity = ensure_identity(tmp_path)
    keyfile = tmp_path / "key.json"
    assert keyfile.is_file()

    # The returned object must agree with the persisted file
    payload = json.loads(keyfile.read_text())
    assert payload["did_key"] == identity.did_key
    assert payload["did_agentbnb"] == identity.did_agentbnb
    assert payload["agent_id"] == identity.agent_id
    assert payload["public_key_hex"] == identity.public_key_hex
    assert payload["version"] == 1
    assert "private_key_hex" in payload  # private key persisted (still 0o600)


def test_ensure_identity_writes_file_with_0o600_permissions(tmp_path: Path) -> None:
    ensure_identity(tmp_path)
    keyfile = tmp_path / "key.json"
    mode = stat.S_IMODE(keyfile.stat().st_mode)
    # Owner read/write only — no group / other access
    assert mode & 0o077 == 0, f"keyfile permissions too permissive: {oct(mode)}"


def test_ensure_identity_returns_existing_identity_on_second_call(tmp_path: Path) -> None:
    first = ensure_identity(tmp_path)
    second = ensure_identity(tmp_path)
    assert first.did_key == second.did_key
    assert first.public_key_hex == second.public_key_hex
    # Same private key reproduces same signature
    msg = b"smoke"
    assert first.sign(msg) == second.sign(msg)


def test_ensure_identity_expands_user_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    identity = ensure_identity("~/.hermes/agentbnb")
    expected = tmp_path / ".hermes" / "agentbnb" / "key.json"
    assert expected.is_file()
    assert identity.did_key.startswith("did:key:")


# ---------------------------------------------------------------------------
# load_identity — strict load (no auto-create)
# ---------------------------------------------------------------------------

def test_load_identity_raises_when_keyfile_missing(tmp_path: Path) -> None:
    with pytest.raises(IdentityError, match="agentbnb publish"):
        load_identity(tmp_path)


def test_load_identity_returns_same_object_as_ensure_identity(tmp_path: Path) -> None:
    created = ensure_identity(tmp_path)
    loaded = load_identity(tmp_path)
    assert created.did_key == loaded.did_key
    assert created.agent_id == loaded.agent_id


def test_load_identity_rejects_wrong_schema_version(tmp_path: Path) -> None:
    keyfile = tmp_path / "key.json"
    keyfile.write_text(json.dumps({
        "version": 99,
        "did_key": "did:key:zfake",
        "did_agentbnb": "did:agentbnb:0000000000000000",
        "agent_id": "0000000000000000",
        "public_key_hex": "00" * 32,
        "private_key_hex": "00" * 32,
        "created_at": "2026-05-04T00:00:00Z",
    }))
    with pytest.raises(IdentityError, match="version mismatch"):
        load_identity(tmp_path)


def test_load_identity_rejects_corrupt_json(tmp_path: Path) -> None:
    keyfile = tmp_path / "key.json"
    keyfile.write_text("{ this is not json")
    with pytest.raises(IdentityError, match="not valid JSON"):
        load_identity(tmp_path)


# ---------------------------------------------------------------------------
# Sign + verify round-trip
# ---------------------------------------------------------------------------

def test_sign_and_verify_round_trip(tmp_path: Path) -> None:
    identity: AgentBnbIdentity = ensure_identity(tmp_path)
    message = b"hello, agentbnb"
    signature = identity.sign(message)

    # 64-byte raw Ed25519 signature
    assert len(signature) == 64

    # Round-trip with the embedded verify key — proves signing key matches
    verify_key = identity.verify_key()
    verify_key.verify(message, signature)


def test_repr_does_not_leak_private_key(tmp_path: Path) -> None:
    identity = ensure_identity(tmp_path)
    text = repr(identity)
    assert identity.public_key_hex not in text or "private_key=<redacted>" in text
    assert "private_key=<redacted>" in text


def test_two_separate_identity_dirs_have_independent_keys(tmp_path: Path) -> None:
    a = ensure_identity(tmp_path / "a")
    b = ensure_identity(tmp_path / "b")
    assert a.did_key != b.did_key
    assert a.sign(b"msg") != b.sign(b"msg")
