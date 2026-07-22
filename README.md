<p align="center">
  <a href="https://p.pages.dev">
    <img alt="p logo" src="https://p.pages.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# p — Agent Harness Mono Repo

This is the home of the `p` agent harness project, an opinionated fork of the [pi coding agent](https://github.com/badlogic/pi-mono).

- **[@dst0/p](packages/coding-agent)**: Interactive coding agent CLI with automatic context, memory, rules, and repo-map injection
- **[@dst0/p-agent-core](packages/agent)**: Agent runtime with tool calling and state management
- **[@dst0/p-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)
- **[@dst0/p-code-index](packages/code-index)**: Local hybrid semantic code indexing with Qdrant and dense/sparse retrieval

To learn more:

- [Visit p.pages.dev](https://p.pages.dev), the project website
- [Read the documentation](https://p.pages.dev/docs/latest), or ask the agent to explain itself

## Share your OSS coding agent sessions

If you use p for open source work, please share your coding agent sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

## All Packages

| Package                                       | Description                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **[@dst0/p-ai](packages/ai)**                 | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.)                           |
| **[@dst0/p-agent-core](packages/agent)**      | Agent runtime with tool calling and state management                                       |
| **[@dst0/p-code-index](packages/code-index)** | Local repository indexing and hybrid semantic retrieval                                    |
| **[@dst0/p](packages/coding-agent)**          | Interactive coding agent CLI with automatic context, memory, rules, and repo-map injection |
| **[@dst0/p-tui](packages/tui)**               | Terminal UI library with differential rendering                                            |

For Slack/chat automation and workflows see [dst0/p-chat](https://github.com/dst0/p-chat).

## Local code indexing

Source checkouts can install p's opt-in semantic-indexing service on macOS or Linux with `./reinstall.sh`. Reinstall replaces stale service processes and verifies a real semantic retrieval before succeeding. On first interactive use in a repository, p asks whether to index it; enabled repositories are refreshed in the background as files change. Use `/index` to inspect status, `/index up` to move the active repository to the front of the daemon queue, and `/index enable` or `/index disable` to change the saved decision.

See [Architecture](packages/coding-agent/docs/architecture.md) for an overview of the p system design.
See [Code indexing](packages/coding-agent/docs/code-indexing.md) for installation, privacy, configuration, service paths, and troubleshooting.

Source: [github.com/dst0/p](https://github.com/dst0/p)

## Permissions & Containerization

p does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox p. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `p` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `p` process in a local container for simple isolation.
- **OpenShell**: run the whole `p` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./p-test.sh         # Run p from sources (can be run from any directory)
```

For a short same-model comparison between this fork and the upstream agent, see
[Agent benchmarking](packages/coding-agent/docs/benchmarking.md).

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `P_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `p update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT
