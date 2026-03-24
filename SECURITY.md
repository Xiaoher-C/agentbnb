# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentBnB, please report it responsibly.

**Contact:** Open a [GitHub Security Advisory](https://github.com/Xiaoher-C/agentbnb/security/advisories/new) (preferred) or email the maintainer directly via the GitHub profile.

**Response timeline:**
- Acknowledgement within 48 hours
- Assessment and severity determination within 7 days
- Fix or mitigation within 30 days for Critical/High severity issues

Please do not open a public GitHub issue for security vulnerabilities.

## Scope

This policy covers the `agentbnb` npm package and the AgentBnB protocol implementation.

## Known Limitations

### CommandExecutor (`mode: command` in skills.yaml)

Skills configured with `mode: command` execute local subprocesses. The following protections are in place:

- All interpolated parameters are shell-escaped using single-quote wrapping (`shellEscape()`)
- An `allowed_commands` allowlist in `skills.yaml` restricts which base commands may execute
- `execFile` with array arguments is used — not `exec()` with a raw shell string

**Operator responsibility:** The `allowed_commands` list must be carefully maintained by the operator. Misconfigured allowlists can expose the host to arbitrary command execution. Only enable `mode: command` skills in trusted, controlled environments.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 6.x     | Yes       |
| < 6.0   | No        |
