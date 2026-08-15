# Development Rules

## User Updates

- While actively working, reread `user-updates.md` for new instructions at least once per minute and incorporate any new guidance before continuing.
- After reading and incorporating `user-updates.md`, clear its contents but do not delete the file.

## Conversational Style

- Keep answers short and concise
- No emojis in code
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Code files must contain at most 300 physical lines. `npm run check:file-structure` enforces the limit for new files and prevents legacy baseline violations from growing; tighten or remove baseline entries whenever a legacy file is reduced.
- Keep one class or runtime entity per file. Supporting types for that entity may stay with it, but additional classes/entities belong in descriptively named files.
- Use descriptive split names based on responsibility. Never create generic `part1`, `part2`, or similar continuation files.
- Treat file splits as behavior-preserving refactors: establish a clean baseline, inspect symbol references and import cycles, retain generic/override method contracts explicitly, and run focused regression tests before and after the split. Never introduce circular delegation or self-recursive forwarding.
- Avoid zero-length insertions (`was: ""`) or line-based replacements without anchors. If positional/line-based edits are used, you must run compiler checks or inspect the edited lines immediately after each edit to catch offset drift and corruption before proceeding.
- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.
- Code formatting and indentation: Biome is configured in `biome.json` to enforce 2 spaces over tabs across all code files. Always keep `biome.json` configured with `"indentStyle": "space"` and `"indentWidth": 2`.

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `npm run test:unit` from the repo root. Otherwise run specific tests from the package root: `node ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`.
- Poll running background tasks with reasonable intervals that approximately equal to ETA or reasonably smaller when closer progress monitoring is absolutely necessary. But not repeatedly in tight loops. Rely on reactive completion messages instead.

## Test Quality & Adversarial Review

- Tests must never be added solely as mechanical line-fillers to pass coverage gates (`scripts/check-changed-coverage.js`). Tests must meaningfully verify domain logic, invariant preservation, realistic crash recovery, positive cases, negative cases, and edge cases.
- When investigating uncovered lines reported by `check-changed-coverage.js`, never bypass them or write superficial mocks. Always investigate why the branch was unexercised (e.g. realistic repository fixture setup such as `.git/config` remotes, real abort signals, default environment/argument paths, fatal error transitions) and write genuine tests exercising the domain behavior.
- Bug fixes must start with a reproducible failing regression test before writing the fix.
- For non-trivial features, bug fixes, or test additions, automatically spawn an adversarial test-critic subagent to review the tests. The critic must evaluate whether the suite verifies real behavior vs artificial line coverage, identifies missing edge cases, and flags fragile/vacuous tests before work is completed.
- Never use `/* v8 ignore */` or coverage comments to bypass coverage gates. All code in the repository must be reachable and exercised by tests; dead or unreachable code must be deleted rather than kept or suppressed (except rare compiler/type-exhaustiveness edge cases where a branch is syntactically required but provably unreachable at runtime).
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.

## Version Bump

- When a feature, fix, or improvement is finished, run the version bump before pushing changes. Run `node scripts/version-bump.js patch` to bump all workspace packages and root `package.json`. Do this before running `./reinstall.sh` so the installed CLI reports the correct version.
- Include the version bump in the same commit as the changes.
- Before pushing code changes, run the touched focused tests, `npm run test:unit` for the non-e2e suite, `npm run check`, `./reinstall.sh`, and a `p` smoke. For docs/workflow-only changes, run the relevant validation plus `npm run check`. Never push with known local or CI failures unless the user explicitly accepts the risk.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Always commit and push changes unless the user asks not to.
- After successful code changes, run `./reinstall.sh` to rebuild and relink the CLI locally, then test `p` works correctly.
- `./reinstall.sh` is mandatory after code changes. Never use `npm run build` + `npm link` manually. The script handles build, relink, and verification in one step:
  1. Hydrates monorepo dependencies (`npm install --ignore-scripts`) and builds all packages (`npm run build`).
  2. Relinks `p` CLI across all global npm prefix locations on `PATH` and verifies version match & compaction settings.
  3. Computes the indexing runtime version hash (`NEW_INDEXING_VERSION`) and compares it against the running daemon's `OLD_INDEXING_VERSION` in `~/.p/agent/indexing-service-status.json`.
  4. If indexing version is unchanged, skips stopping/restarting the background daemon (`com.dst.p.code-index`) and avoids rebuilding vector stores. If changed, allows the daemon 10s to quiesce active indexing before updating service binaries.
  5. Installs/updates the system service (launchd/systemd) and runs an isolated semantic-search smoke test.

## Code Indexing & Daemon Versioning

- `computeIndexingVersion()` in `packages/coding-agent/src/core/indexing-service.ts` calculates a deterministic SHA-256 hash of all indexing runtime files (daemon core `indexing*.ts`/`js` modules, `code-index` build/Python/config files, installer scripts).
- This hash determines whether `./reinstall.sh` can safely skip restarting the background daemon (`com.dst.p.code-index`) and rebuilding vector stores.
- Package version bumps (`scripts/version-bump.js`) must NEVER modify source files in `packages/code-index/src/` or invalidate `computeIndexingVersion()`. Release version bumps only update `package.json` and `package-lock.json`.
- When adding or modifying indexing files, run `node ../../node_modules/vitest/dist/cli.js --run test/indexing-version.test.ts` from `packages/coding-agent` to verify test coverage. Any new indexing daemon module matching `packages/coding-agent/src/core/indexing*` is automatically tracked by `computeIndexingVersion()`.

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- If `packages/coding-agent/npm-shrinkwrap.json` needs regen, run `node scripts/generate-coding-agent-shrinkwrap.js` (verify with `--check` or `npm run check`). New deps with lifecycle scripts require review and an explicit allowlist entry in that script; never add one silently.
- Pre-commit blocks lockfile commits unless `P_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Multiple p sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Always submit changes via PRs, except critical cases where the PR workflow does not work and CI must be fixed by pushing directly to `main`.
- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` and `packages/ai/src/image-models.generated.ts` should always be committed alongside your changes when modified. They are regenerated by scripts, not edited manually.
- Message format: `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (auto-close workflows, `lgtm`/`lgtmi`, quality bar).

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating PRs:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`); use all that apply.
- Always include a `## Bug Fixes` section in the PR description detailing any bugs uncovered and resolved during the task, with references to their regression tests.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt (e.g. `This comment is AI-generated by `/wr``).

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing and Smoke Verification of p CLI & Features

- **No bare hanging commands**: Never run bare commands like `p -p "..."` directly in background subprocesses without a TTY. Without an attached pseudo-terminal, the TUI engine blocks waiting for terminal events or stdin, causing commands to hang indefinitely.
- **No generic dummy prompts**: Never use generic placeholder prompts (e.g. `Say exactly: ok`) as a substitute for real smoke testing. Smoke verification must specifically and meaningfully target the feature or bug that was changed:
  * **CLI version & metadata**: Verify `p --version` or `p --list-models` to confirm binary linkage and version metadata.
  * **Interactive TUI & visual layout**: Always run in a controlled terminal via `tmux`, capture the rendered pane with `tmux capture-pane -p`, and inspect/assert the exact UI state:
    ```bash
    tmux new-session -d -s p-test -x 80 -y 24
    tmux send-keys -t p-test "npm run dev --" Enter
    sleep 3 && tmux capture-pane -t p-test -p     # capture after startup
    tmux send-keys -t p-test "feature-specific prompt here" Enter
    sleep 3 && tmux capture-pane -t p-test -p     # capture response/UI state
    tmux kill-session -t p-test
    ```
  * **Semantic search & indexing**: Run concrete indexer queries or status checks (e.g. `p-code-index` search verification).
  * **Agent responses & streaming**: Verify through unit/domain harnesses (`test/suite/harness.ts` or domain unit tests) and targeted interactive session assertions.

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- `## [Unreleased]` must appear exactly once and must be the first level-two section immediately after `# Changelog`.
- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Each new release section must be inserted immediately below `[Unreleased]` and must have a greater semantic version than the previously topmost released section; do not reorder historical legacy sections.
- Release dates use the UTC calendar date in `YYYY-MM-DD` format, derived from `new Date().toISOString().slice(0, 10)`; never substitute a local timezone date.
- Released version sections (e.g. `## [0.12.2]`) are immutable except when correcting ordering or release metadata errors; never move entries between released versions.

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/dst0/p/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/dst0/p/pull/456) by [@username](https://github.com/username))`

## Releasing

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update and validate CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing. Before any version bump, verify every changelog has exactly one topmost `[Unreleased]` section, the newest released version is greater than the previously topmost release, and all release dates are UTC dates.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):

   ```bash
   npm run release:local -- --out /tmp/p-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/p-local-release/node/p --help
   /tmp/p-local-release/node/p --version
   /tmp/p-local-release/node/p --list-models
   /tmp/p-local-release/node/p -p "Say exactly: ok"
   /tmp/p-local-release/node/p

   # Bun binary smoke tests
   /tmp/p-local-release/bun/p --help
   /tmp/p-local-release/bun/p --version
   /tmp/p-local-release/bun/p --list-models
   /tmp/p-local-release/bun/p -p "Say exactly: ok"
   /tmp/p-local-release/bun/p
   ```

   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/p-local-release/node/p` and `/tmp/p-local-release/bun/p` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

3. **Run the release script**:

   ```bash
   P_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   P_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```

   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or shrinkwrap diffs the release creates before push.

   The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI publishes npm packages**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. The `publish-npm` job uses npm trusted publishing through GitHub Actions OIDC with environment `npm-publish`; no local `npm publish`, `npm whoami`, OTP, or WebAuthn flow is required.

5. **If CI publish fails**: inspect the failed `publish-npm` job. The publish helper is idempotent and skips package versions already present on npm, so rerun the tag workflow after fixing CI or transient npm issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.

## Refactoring Guidelines (LSP/MCP)

Before executing any semantic refactoring (TypeScript/JavaScript, HTML, Rust), the agent must:

1. Run diagnostics for the target file/project to verify baseline state.
2. Use symbol tools (`definition`, `references`, `hover`, `workspace symbols`) to explore impact.
3. Prefer LSP rename/code-action tools over manual text/regex edits wherever possible.
   - For TS/JS: Use `ts-js-lsp` (`typescript-language-server`).
   - For HTML: Use `html-lsp` (`vscode-html-language-server`).
   - For Rust: Use `rust-lsp` (`rust-analyzer`) and/or `rust-analyzer-native` (`rust-analyzer-mcp`).
4. After making edits, run `npm run check` (full output, no tail). Fix all errors, warnings, and infos.
   - Rust: `cargo fmt`, `cargo clippy`, `cargo test` as applicable.
5. Never perform large cross-module or architectural refactors without creating a plan first.
