# Development Rules

## User Updates

- While actively working, reread `user-updates.md` for new instructions at least once per minute and incorporate any new guidance before continuing.
- After reading and incorporating `user-updates.md`, clear its contents but do not delete the file.

## Conversational Style

- Keep answers short and concise
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
- Do not run `npm run test:unit` inside a wrapper with a fixed deadline shorter than the suite. `test.sh` temporarily moves `~/.p/agent/auth.json`; after any interrupted run, verify the primary and `.bak` paths and restore the intact mode-`0600` backup only when the primary is absent.
- Run `./test.sh` directly with output redirected to a temporary active log; do not route it through lean-ctx's bounded CLI wrapper. Compress the closed log with Brotli Q6 after the process exits.
- Poll running background tasks with reasonable intervals that approximately equal to ETA ot reasonably smaller when closer progress monitoring is absolutely necessary. But not repeatedly in tight loops. Hard-Rely on reactive completion messages instead.
- After restarting a live `p` run, rediscover and identity-bind its newest session JSONL before monitoring; never infer a stall from the previous process's log.

## Test Quality & Adversarial Review

- Tests must never be added solely as mechanical line-fillers to pass coverage gates (`scripts/check-changed-coverage.js`). Tests must meaningfully verify domain logic, invariant preservation, realistic crash recovery, positive cases, negative cases, and edge cases.
- Never create generic, catch-all, or branch-filler test files (e.g. `branches.test.ts`, `coverage.test.ts`). Organize all tests into descriptively named files grouped by domain, feature responsibility, and lifecycle semantics.
- Strive for 100% branch coverage across all tested modules. Exercise real operational permutations: optional configuration hooks, fallback dispatcher chains, default parameter paths, and event sequences with and without initial lifecycle triggers.
- When investigating uncovered lines reported by `check-changed-coverage.js`, never bypass them or write superficial mocks. Always investigate why the branch was unexercised (e.g. realistic repository fixture setup such as `.git/config` remotes, real abort signals, default environment/argument paths, fatal error transitions) and write genuine tests exercising the domain behavior.
- Bug fixes must start with a reproducible failing regression test before writing the fix. Any bugs discovered during test authoring, coverage expansion, or refactoring must be fixed with dedicated regressions, explicitly documented in the PR description, and reported directly to the user in the session summary.
- When a serialization contract requires both a terminal delimiter and rejection of any truncation, add a focused regression that removes exactly the final delimiter byte. Removing a whole record or payload is not equivalent evidence for that boundary.
- For non-trivial features, bug fixes, or test additions, automatically spawn an adversarial test-critic subagent to review the tests. The critic must evaluate whether the suite verifies real behavior vs artificial line coverage, identifies missing edge cases, and flags fragile/vacuous tests before work is completed.
- Never use `/* v8 ignore */` or coverage comments to bypass coverage gates. All code in the repository must be reachable and exercised by tests; dead or unreachable code must be deleted rather than kept or suppressed (except rare compiler/type-exhaustiveness edge cases where a branch is syntactically required but provably unreachable at runtime).
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- When adding a test under `scripts/`, inspect the root npm test scripts; if its parent suite enumerates files explicitly, add the new file in the same change and run that parent script at least once.
- Temporary release Git fixtures that recursively delete repositories, remotes, or clones must disable repository-local automatic and detached maintenance/GC unless the test explicitly owns and joins that background lifecycle.
- Successful child-process regressions must give their kill timeout measured full-suite load margin rather than setting it near the focused runtime.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.

## Version Bump

- Do not bump package versions in feature or fix branches. Version changes are release mutations and may run only inside the certified release transaction on the exact current `origin/main` commit.
- `scripts/version-bump.js` fails closed without the one-time authorization issued by `scripts/release.js`; never bypass or synthesize `P_RELEASE_AUDIT_TOKEN`.
- The release transaction sets the root, published packages, private site package, extension examples, lockfile, and coding-agent shrinkwrap to one target version. Include those version changes only in the generated `Release vX.Y.Z` commit.
- Before pushing code changes, run the touched focused tests, `npm run test:unit` for the non-e2e suite, `npm run check`, `./reinstall.sh`, and a `p` smoke. For docs/workflow-only changes, run the relevant validation plus `npm run check`. Never push with known local or CI failures unless the user explicitly accepts the risk.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Always commit and push changes unless the user asks not to.
- `./reinstall.sh` is mandatory after code changes. Never use `npm run build` + `npm link` manually. The script handles build, relink, and verification in one step:
  1. Hydrates monorepo dependencies (`npm install --ignore-scripts`) and builds all packages (`npm run build`).
  2. Relinks `p` CLI across all global npm prefix locations on `PATH` and verifies version match & compaction settings.
  3. Computes the indexing runtime version hash (`NEW_INDEXING_VERSION`) and compares it against the running daemon's `OLD_INDEXING_VERSION` in `~/.p/agent/indexing-service-status.json`.
  4. If indexing version is unchanged, skips stopping/restarting the background daemon (`com.dst.p.code-index`) and avoids rebuilding vector stores. If changed, allows the daemon 10s to quiesce active indexing before updating service binaries.
  5. Installs/updates the system service (launchd/systemd) and runs an isolated semantic-search smoke test.

## Code Indexing & Daemon Versioning

- `computeIndexingVersion()` in `packages/coding-agent/src/core/indexing-service.ts` calculates a deterministic SHA-256 hash of all indexing runtime files (daemon core `indexing*.ts`/`js` modules, `code-index` build/Python/config files, installer scripts); `./reinstall.sh` uses it to skip unnecessary daemon restarts and vector-store rebuilds safely.
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

When creating PRs or issues, add every applicable package label: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, and `pkg:tui`.

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating PRs:

- The PR description must give a detailed, complete account of every material change in the PR: behavior and architecture changes, state or data migrations, operational and release impact, compatibility or security consequences, and the exact verification performed. Do not omit secondary changes discovered or made while completing the task.
- Always include a `## Bug Fixes` section in the PR description detailing any bugs uncovered and resolved during the task, with references to their regression tests.

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

Release-note inputs live in `.changes/*.json`. Every commit that changes releasable package or release-tool behavior must add or update a fragment in the same commit. A fragment names every affected changelog package, one canonical changelog category, and a specific single-line user-facing summary. Use `type: "None"` only with a concrete single-line reason for a deliberately non-user-facing change. The automated release audit binds each policy-era commit to the fragment IDs and content hashes, and the release transaction aggregates normal fragments into changelogs and removes the consumed files. Do not use an older unrelated fragment to cover a later commit. This proves deterministic package coverage, not the truth of arbitrary prose; reviewers remain responsible for the semantic accuracy of summaries and exemptions during normal PR review.

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

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. Major releases fail closed by default. The only currently authorized major target is exactly `5.0.1`, and it requires the explicit `--allow-major` flag; changing that target requires another reviewed policy change and explicit user authorization.

Feature PRs must not change root, workspace, lockfile, or shrinkwrap release versions. CI runs `scripts/release-pr-version-policy.js` against the PR base and rejects such bumps; version mutation happens only inside the certified transaction on exact `main`.

Live provider model generators are not release-time mutations because their network inputs are not reproducible during later certificate verification. Run and review model metadata regeneration in a normal pre-release PR when needed; the certified release commit must leave generated model source identical to its audited base.

1. **Automatic changelog audit and certificate**: do not ask the user whether `/cl` ran. `scripts/release.js` fetches `origin/main` and tags, requires the clean current `HEAD` to equal the fetched `origin/main`, runs the deterministic changelog audit, and persists a Brotli Q6 certificate in the worktree Git directory before authorizing any version mutation. The certificate binds the exact main SHA, target version, major-release authorization state, changelog evidence, release-note fragment IDs and hashes, and release-input hash. The one-time transaction token is bound to that certificate ID and exact target, and every active transition revalidates certificate authority from the certified base revision. A rebase, commit, changed `[Unreleased]` section or `.changes` fragment, changed release script/workflow/manifest, target change, authorization-state change, restart into an inconsistent state, or previously consumed certificate fails closed. `npm run release:audit -- audit <x.y.z>` may create the same certificate as a standalone preflight; use `npm run release:audit -- audit 5.0.1 --allow-major` for the authorized major target. `npm run release:audit -- status <x.y.z>` checks a certificate without repeating the authorization flag, and the release command always reruns the audit automatically. Evidence certification and one-time release authorization are separate state transitions. There is currently no repository rule requiring a human semantic approval; if one is introduced, preserve it as an additional decision after automated evidence collection rather than using the user to launch automatable checks.

   If a release process stops after authorization, run `npm run release:audit -- recover`. It marks an unpublished transaction `aborted` when the target tag is absent and remote main does not contain the release commit; it also deletes only a matching local-only target tag so linked worktrees can retry safely. It marks the transaction `released` when the target tag matches and remote main contains the persisted next-cycle commit, even if main advanced afterward. A partial release commit without its tag, mismatched tag, or divergent publication remains a hard failure. Use a clean disposable worktree for a new attempt after an aborted transaction; do not reset a dirty release worktree automatically.

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
   P_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 node scripts/release.js 5.0.1 --allow-major
   ```

   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or shrinkwrap diffs the release creates before push.

   The release script consumes the valid certificate, bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then atomically pushes `HEAD:main` and the tag and verifies both remote refs. Do not rerun the release script after a tag was pushed.

4. **CI publishes npm packages**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. The validation job resolves the remote lightweight tag once, exports its verified commit SHA, and every downstream build or publish job checks out that exact SHA and rechecks that the remote tag still points to it immediately before an external side effect; recovery dispatches cannot substitute another source ref. Before building or publishing, CI reconstructs the canonical workspace and release-input scope from the certified base tree, reruns deterministic audit evidence from that base SHA, and verifies the Brotli Q6 receipt, exact normalized changelog preview, tag parent, release commit paths, every workspace and lockfile version, internal dependency ranges, and coding-agent shrinkwrap. A manual manifest bump or tag without that receipt cannot publish. Repository-contained certificates prevent accidental and stale bypasses; authenticity against a contributor deliberately changing both policy code and receipt still depends on protected-main review, tag permissions, and trusted workflow controls. The `publish-npm` job uses npm trusted publishing through GitHub Actions OIDC with environment `npm-publish`; no local `npm publish`, `npm whoami`, OTP, or WebAuthn flow is required.

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

## Durable Learning Capture

- Treat every resolved bug, regression, setup trap, operator mistake, failed experiment, and unexpected behavior as a learning opportunity, not only as a code change.
- Before or while fixing an issue, preserve the observable symptom and decisive evidence. Once understood, record the root cause rather than only the final patch.
- Record enough detail to make the learning reusable:
  - what went wrong and why;
  - which approaches were tried, including what worked, what did not work, and why;
  - any unexpected constraints, side effects, or environmental differences;
  - the correct path and how it was verified;
  - the regression test, prevention rule, cleanup, or reset procedure that prevents recurrence.
- Put durable guidance in the appropriate canonical repository document in the same change: use `AGENTS.md` for agent behavior, `README.md` for user or setup paths, and the canonical architecture or product documentation for design and runtime contracts.
- When a cross-session memory tool such as `memory_save` is available, save resolved bugs, architectural decisions, durable facts, and learned patterns so future sessions can retrieve them.
- Do not leave important learnings only in chat, temporary notes, commit history, or a pull-request discussion.
- If an issue exposes repeated agent friction, add the shortest durable instruction here that would have prevented it.
- Keep learning records safe: never store credentials, tokens, private keys, customer data, or sensitive payloads; sanitize examples and evidence.

## Mandatory Learning Log

- Maintain the repository-wide append-only learning collection in `docs/leanings/`.
- Create exactly one Markdown file per learning in the same change whenever work reveals a resolved bug or regression, failed or misleading experiment, unexpected behavior, setup or environment trap, non-obvious constraint, important workaround, or rejected approach with reusable rationale.
- Routine successful work does not need an entry unless it produces a reusable insight.
- Follow the filename convention and exact entry structure documented in `docs/leanings/README.md`. Include the task/context, observation or failure, evidence, approaches tried and their outcomes, root cause, resolution, verification, prevention or follow-up, and the reusable learning.
- Mark uncertainty honestly. If root cause or resolution is incomplete, record the entry as `Partial` or `Open` and state what evidence is still missing.
- Keep learning files append-only by default: do not delete or rewrite older files merely to make the history cleaner. Put later discoveries in a new file that links the earlier learning.
- Exception for confirmed falsehoods: when authoritative evidence proves that an entry itself was fabricated, hallucinated, or factually false, correct or remove the false content so future agents do not reuse it.
- A confirmed-falsehood correction must never be silent. Mark the affected file `Corrected` and add a dated correction note stating what was wrong, the authoritative evidence used, and what was changed. Do not repeat removed sensitive content.
- If the evidence is incomplete or disputed, do not rewrite the original file; add a dated `Partial` or `Open` learning file that links it.
- Link relevant issues, commits, logs, or regression tests when safe and useful.
- Never place credentials, tokens, private keys, customer data, sensitive payloads, or unsanitized production evidence in learning files.

<!-- destinationworks-universal-agent-baseline:v1 -->
## Universal Delivery Baseline (v1)

These rules are the portable minimum for Destination Works repositories. Repository-specific instructions may strengthen them or name concrete commands, but must not silently weaken them.

### Evidence, scope, and decisions

- Read the repository instructions and relevant canonical docs before changing files. Check available cross-session memory when prior decisions or recurring failures may affect the work.
- While actively working, reread a repository-root `user_updates.md` at least once per minute when it exists. Treat new entries as user instructions, handle them before continuing, remove only entries that were fully handled, and never delete the file itself.
- Establish the live baseline before diagnosing or claiming completion. Prefer direct evidence from current code, tests, CI, deployed artifacts, or authenticated system state over comments, stale reports, or agent summaries.
- Preserve unrelated and user-owned changes. Use an isolated branch/worktree for broad work, stage intentionally, and never reset, clean, delete, or rewrite unrelated state to simplify a task.
- For non-trivial changes, compare 2-3 viable approaches and record the decisive tradeoffs. Proof-test material assumptions with a focused reproduction or authoritative source before committing to the design.
- Test scripted replacements and bulk mechanical edits on a disposable copy of one representative file before applying them broadly; inspect the result for collateral changes.
- Keep implementation, user/setup documentation, architecture/runtime contracts, and operator guidance synchronized in the same change.
- Store closed, well-compressible logs and temporary evidence with Brotli quality 6 when practical. Never compress an actively appended log as one stream: rotate or close it into chunks first, then compress each completed chunk. Use a format better suited to append, random access, or unsupported tooling when required, and record the reason for that exception.

### Durable learning capture

- Maintain `docs/leanings/` as the repository-wide append-only learning collection. Create exactly one dated Markdown file per material learning in the same work; routine successful work needs no record.
- Follow `docs/leanings/README.md` for filenames and record structure. Capture context, observable symptoms, sanitized decisive evidence, approaches and outcomes, root cause or honest uncertainty, resolution, verification, prevention/follow-up, reusable rule, and safe references. Use `Resolved`, `Partial`, `Open`, or `Corrected` truthfully.
- Keep published learning files append-only by default. Put later discoveries in a new linked file rather than rewriting history.
- Exception: when authoritative evidence proves an existing statement was fabricated, hallucinated, or factually false, correct or remove the false content in the affected file, mark it `Corrected`, and add a dated note with the authoritative evidence and exact correction. Never use this exception for disputed interpretation, ordinary staleness, or changed external conditions.
- Promote the shortest prevention rule into the appropriate canonical instructions, setup guide, architecture contract, or operator runbook in the same change. Do not leave durable knowledge only in chat, commit history, a PR, or the learning collection.
- Never record secrets, credentials, private keys, customer data, sensitive payloads, device codes, or unsanitized production evidence.

### Validation and test quality

- Discover and use the repository's canonical commands; do not invent shared command names where the project does not define them.
- Use a validation ladder: fast targeted feedback while iterating, the repository pre-commit gate before commit, and the full pre-push/release-relevant gate before push. If a named gate does not exist, run the closest repository-native equivalent and document the exact evidence.
- A hook is developer feedback, not the authoritative merge gate. CI must rerun required checks from a clean checkout.
- Never weaken, skip, or replace a failing check merely to make it green. Read the failure, fix the cause, rerun the narrowest relevant test, then rerun the containing gate.
- Validate generated artifacts against their source and canonical generator. Do not hand-edit generated output or accept drift.
- Tests must cover meaningful behavior, negative/error paths, and important boundaries. Coverage is a regression signal, not a reason to add vacuous line-fillers or bypass comments.
- For non-trivial or high-risk changes, obtain an independent adversarial review of assumptions, tests, failure handling, and rollback before publication.
- Process-timeout tests must prove that descendants and inherited pipes are gone, not merely that the direct child received a signal. When an external Unix `kill` command receives a negative process-group operand, terminate option parsing with `--` and cover the Linux path.
- For user-visible UI changes, exercise the changed path in the real browser or installed application after automated tests pass; record the nearest honest evidence if UI automation is unavailable.

### Git, pull requests, and CI enforcement

- Start from current remote truth, keep commits scoped and reviewable, and verify the exact staged diff before committing. Do not mix unrelated work into one PR.
- A local pass, push, or successful agent report is not proof that remote CI passed. Confirm the remote PR head SHA and every required check on that exact revision.
- Self-merge only when branch/ruleset protection actually enforces the required checks and they all pass. If protection is unavailable, checks cannot start, or the head changed after validation, leave the PR open for owner approval.
- CI workflows must use least-privilege permissions, pinned third-party actions, explicit timeouts/concurrency, and repository-owned validation commands.
- Self-hosted workflows must target verified organization runner labels, check prerequisites early, and prefer runner-local/preinstalled toolchains and caches over dynamic marketplace installers or billing-dependent artifact/cache services.
- Prove self-hosted readiness as the runner service account with its real non-interactive `HOME`, `PATH`, permissions, working directory, and any runner-managed persisted environment snapshot; an administrator's shell or manually constructed environment is not equivalent to a real workflow job.
- Prerequisite probes must exercise the concrete subcommands and capabilities the job invokes, not infer support only from a parent runtime's major version.
- Runner services must restart after unexpected failure and terminate the complete job process group; for systemd, use `Restart=on-failure` and `KillMode=control-group`. Bound build/test parallelism to the shared host's measured memory budget and provision recovery swap without treating swap as permission for unbounded concurrency.
- Run unrelated repository or organization runner services under distinct Unix service accounts so user-scoped signals and cleanup cannot cross repository boundaries. After a runner migration, disable superseded services and watchdogs immediately; never leave a deleted registration in an automatic restart loop.
- Containers that bind-mount a reusable self-hosted worktree must write generated files as the runner UID/GID, or normalize ownership before exit even on failure. Prove a subsequent clean checkout can remove prior outputs.
- Scope runner prerequisites to the job's actual contract: native test jobs must not require release-only cross-platform emulation, while every published platform must fail closed unless its build and execution prerequisites are verified.
- PR descriptions must explain why the change was needed, what changed, approaches rejected, exact validation, bugs found/fixed with regression evidence, learning-log entries, risk, and rollback.

### Security and supply chain

- Never store or expose credentials, tokens, private keys, customer data, sensitive payloads, device codes, or unsanitized production evidence in source, logs, fixtures, PRs, or learning records.
- Treat dependency lifecycle scripts, lockfile changes, generated code, binary downloads, workflow actions, and base images as reviewed supply-chain inputs. Pin immutable versions/digests where supported and fail on unreviewed drift.
- When JavaScript is used, prefer `.js` filenames and migrate `.mjs` references unless the user explicitly requires another extension.
- Run repository-appropriate dependency, secret, and static security checks before publication. Waive only a specific reviewed false positive with narrow evidence; never use broad exclusions that hide future findings.
- Security-sensitive configuration and deployment paths must fail closed when required identity, authorization, signing, backup, or runtime prerequisites are missing.

### Release and deployment integrity

- When the repository publishes a deployable artifact, build it once, identify it by immutable digest, and test the exact bytes that will be promoted on every published platform.
- Generate provenance/SBOM, scan, sign, and verify the same immutable artifact before promotion. Promote by digest without rebuilding.
- Separate immutable provenance tags from mutable environment pointers. Publish and verify evidence first, move the smallest mutable production pointer last, verify the live promoted state, and define an exact rollback to the previously recorded digest.
- Do not describe registry publication as runtime deployment. If no external runtime target and verification contract are configured, state that boundary and fail closed rather than claiming production delivery.
- Rehearse backup/restore and rollback through safe isolated commands that produce inspectable evidence; documentation-string checks alone are not operational proof.

<!-- /destinationworks-universal-agent-baseline:v1 -->
