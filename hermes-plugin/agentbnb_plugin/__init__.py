"""AgentBnB rental session plugin for Hermes (v10).

Importing this package only loads the modules that have been implemented so
far. Submodules under active development are imported on demand from the
calling sites.

See ``../README.md`` for installation and ``../docs/hermes-plugin-spec.md``
for the full implementation contract.
"""

from agentbnb_plugin.rental_md_loader import (
    RentalMdError,
    RentalProfile,
    load_rental_md,
    parse_rental_md,
)

__all__ = [
    "RentalMdError",
    "RentalProfile",
    "load_rental_md",
    "parse_rental_md",
]

__version__ = "0.1.0"
