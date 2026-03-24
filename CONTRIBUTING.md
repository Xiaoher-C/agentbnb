# Contributing to AgentBnB

Thanks for your interest in contributing to AgentBnB — the P2P agent capability sharing protocol.

## Getting Started

```bash
git clone https://github.com/Xiaoher-C/agentbnb.git
cd agentbnb
pnpm install
pnpm build
pnpm test
```

## Development

- **Language:** TypeScript (strict mode) — no `any`, use `unknown` and narrow
- **Package manager:** pnpm
- **Tests:** Vitest — run `pnpm test` before submitting a PR
- **Linting:** `pnpm lint` and `pnpm format`

## Pull Requests

1. Fork the repo and create your branch from `main`
2. Make your changes with tests
3. Ensure `pnpm test` passes and `pnpm build` succeeds
4. Open a PR with a clear description of what and why

## Reporting Issues

- **Bugs:** [Open an issue](https://github.com/Xiaoher-C/agentbnb/issues) with reproduction steps
- **Security vulnerabilities:** See [SECURITY.md](SECURITY.md) — do not open a public issue

## Design Philosophy

AgentBnB is agent-native: every feature must pass the test "Does this require human intervention? If yes, redesign."

See [AGENT-NATIVE-PROTOCOL.md](AGENT-NATIVE-PROTOCOL.md) for the full design philosophy before proposing major changes.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
