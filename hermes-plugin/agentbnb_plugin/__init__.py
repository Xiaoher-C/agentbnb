"""AgentBnB rental session plugin for Hermes (v10).

Importing this package loads the public surface that the Hermes plugin
runtime resolves via ``plugin.yaml`` (entry point
``agentbnb_plugin.adapter:AgentBnbAdapter``) plus the helpers that
external code may want to instantiate directly.

See ``../README.md`` for installation and ``../docs/hermes-plugin-spec.md``
for the full implementation contract.
"""

from agentbnb_plugin.adapter import AgentBnbAdapter
from agentbnb_plugin.rental_md_loader import (
    RentalMdError,
    RentalProfile,
    load_rental_md,
    parse_rental_md,
)

__all__ = [
    "AgentBnbAdapter",
    "RentalMdError",
    "RentalProfile",
    "load_rental_md",
    "parse_rental_md",
]

__version__ = "0.1.0"
