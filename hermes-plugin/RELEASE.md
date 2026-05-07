# Cutting a release of the AgentBnB Hermes plugin

> Audience: Cheng Wen (or whoever owns the plugin) when the next version is
> ready to ship. Plugin releases are independent of the AgentBnB monorepo's
> main version tags — namespaced under `hermes-plugin-vX.Y.Z`.

The release flow is fully automated by
[`.github/workflows/hermes-plugin-release.yml`](../.github/workflows/hermes-plugin-release.yml).
Pushing a `hermes-plugin-vX.Y.Z` tag builds the tarball, runs the test
suite, computes a SHA-256, and attaches both to a GitHub release with a
body rendered from the matching `CHANGELOG.md` section.

## Pre-flight checklist

Run these on `feat/v10-rental-mvp` (or whichever branch the release ships
from) **before** tagging:

- [ ] `uv run pytest tests/ -v` passes locally (run from `hermes-plugin/`)
- [ ] `pyproject.toml` `version = "X.Y.Z"` matches the tag you intend to
      push (the workflow refuses to release if these disagree)
- [ ] `CHANGELOG.md` has a `## [X.Y.Z] — YYYY-MM-DD` section with at
      minimum: Added / Changed / Fixed (as applicable), the privacy
      contract status (which ADR-024 layers ship in this version), and
      ADR cross-links
- [ ] If anything in the privacy contract changed, the matching
      regression guard (`tests/test_subagent_runner.py` for Layers 1-2,
      `src/session/privacy.test.ts` for Layer 3 in the AgentBnB monorepo)
      has been updated
- [ ] `README.md` "Status (alpha)" table reflects what actually ships in
      this version

## Cutting the release

```bash
# 1. Bump version in pyproject.toml + add CHANGELOG.md section, then commit
git add hermes-plugin/pyproject.toml hermes-plugin/CHANGELOG.md
git commit -m "chore(hermes-plugin): bump v0.1.0"

# 2. Tag (note the prefix — required by the workflow)
git tag hermes-plugin-v0.1.0

# 3. Push the tag (this triggers .github/workflows/hermes-plugin-release.yml)
git push origin hermes-plugin-v0.1.0

# 4. Watch the workflow
gh run watch
```

When the workflow finishes you will have:

- A GitHub release at
  `https://github.com/Xiaoher-C/agentbnb/releases/tag/hermes-plugin-v0.1.0`
- `agentbnb-hermes-plugin-0.1.0.tar.gz` attached to it
- `agentbnb-hermes-plugin-0.1.0.tar.gz.sha256` attached for integrity
  verification
- Release notes rendered from the `## [0.1.0]` block of
  `hermes-plugin/CHANGELOG.md` plus a copy-paste install block

## After the release

- Update [`INSTALL.md`](INSTALL.md) Path B example to the new version if
  the API or config keys changed (the version itself is parameterised via
  `AGENTBNB_PLUGIN_VERSION`)
- Post the announcement copy from
  [`../docs/hermes-plugin-release-announcement.md`](../docs/hermes-plugin-release-announcement.md)
  to the configured channels (Hermes Discord, X, internal)
- File a Hannah dogfood issue if there's a privacy-contract delta worth
  re-validating against the BGM session

## Pre-releases

Tag with a hyphen suffix to mark a release as pre-release:

```bash
git tag hermes-plugin-v0.2.0-rc.1
git push origin hermes-plugin-v0.2.0-rc.1
```

The workflow detects the hyphen and sets `prerelease: true` on the
GitHub release.

## Rolling back a bad release

You cannot un-publish a Git tag cleanly. Instead:

1. Delete the GitHub release UI artifact (`gh release delete
   hermes-plugin-v0.1.0`)
2. Delete the tag locally and on the remote:
   `git tag -d hermes-plugin-v0.1.0 && git push origin :refs/tags/hermes-plugin-v0.1.0`
3. Cut a new patch version (`v0.1.1`) with the fix
4. If anyone has already pulled the bad tarball, the SHA-256 mismatch
   will surface during install verification

Be conservative: prefer cutting `v0.1.1` over revoking `v0.1.0`.
