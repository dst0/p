# Learning Log

This is the repository-wide, append-only journal for durable engineering learnings.

Add an entry when work reveals a resolved bug or regression, a failed or misleading experiment, unexpected behavior, a setup or environment trap, a non-obvious constraint, an important workaround, or a rejected approach whose rationale should be reused.

Do not add entries for routine successful work unless it produced a generalizable insight. Keep entries append-only by default and never rewrite or delete history merely to make the outcome look cleaner.

Exception: if authoritative evidence proves that an entry itself was fabricated, hallucinated, or factually false, correct or remove the false content so it cannot mislead future work. Never make that correction silently: mark the entry `Corrected` and add a dated correction note explaining what was wrong, which authoritative evidence established the error, and what changed. Do not repeat removed sensitive content. If evidence remains incomplete or disputed, preserve the original and append a `Partial` or `Open` follow-up instead.

Sanitize all evidence and never include credentials, tokens, private keys, customer data, sensitive payloads, or unsanitized production information.

## Entry template

```markdown
### YYYY-MM-DD — Short descriptive title

- **Status:** Resolved | Partial | Open | Corrected
- **Correction (only when status is `Corrected`):** Date, sanitized description of the false claim, authoritative evidence, and the exact correction made.
- **Task/context:** What work was underway and where.
- **Unexpected observation or failure:** What happened, including the visible symptom.
- **Evidence:** Logs, reproduction, measurements, or other decisive facts, sanitized as required.
- **Approaches tried:**
  - **Attempt:** What was tried.
    - **Outcome:** Worked | Did not work | Partial
    - **Why:** Why it succeeded, failed, or remained inconclusive.
- **Root cause:** The underlying cause, or the leading hypothesis and missing evidence if not confirmed.
- **Resolution:** What changed or which path is now correct.
- **Verification:** Tests, checks, or live evidence proving the result.
- **Prevention/follow-up:** Regression test, guardrail, cleanup/reset procedure, documentation update, or remaining action.
- **Reusable learning:** The concise rule future work should apply.
- **References:** Safe links or paths to issues, commits, tests, or documentation.
```

## Entries

<!-- Append new entries below this line. -->

### 2026-08-17 — Event-Sourced Delta Logging & Provider Cache Telemetry Normalization

- **Status:** Resolved
- **Task/context:** Optimizing agent session logging, benchmark recording streams, and KV cache reuse telemetry across `@dst0/p`.
- **Unexpected observation or failure:** Raw benchmark session logs for a 4-task agent run reached 3.32 GB on disk, causing heavy V8 garbage collection pauses (Scavenge/Major GC) and UI stutter during active token streaming.
- **Evidence:** Stream profiling revealed that 99.96% of the 3.32 GB log was caused by dumping full accumulated message arrays on every streaming token delta (`message_update`). Brotli compression post-factum reduced disk size to 1.5 MB (1,085x ratio), but did not prevent in-memory V8 allocation thrashing and quadratic CPU serialization during live generation.
- **Approaches tried:**
  - **Attempt 1:** Compress streaming output with Gzip.
    - **Outcome:** Partial
    - **Why:** Reduced disk size by only 28.5x (48 MB) and did not solve in-memory GC churn.
  - **Attempt 2:** Compress streaming output with Brotli Q6 text mode (`createBrotliCompress`).
    - **Outcome:** Worked for disk storage (153 MB total across 51 historical runs vs 7.2 GB), but runtime streaming still generated gigabytes in V8 heap.
  - **Attempt 3:** Implement Canonical v1 Event-Sourced Delta Logging Protocol (`turn_start`, `delta`, `tool_chunk`, `tool_call`, `turn_end`).
    - **Outcome:** Worked completely. Raw stream reduced by 99.9% to linear $O(1)$ events (<60 bytes per token), eliminating V8 GC pressure.
- **Root cause:**
  1. Serializing the full message AST on every single token delta generates $\sum_{k=1}^N k \cdot \bar{L}_t \approx \frac{N^2}{2} \cdot \bar{L}_t$ bytes ($O(N^2)$ quadratic explosion).
  2. Telemetry heterogeneity across providers: Anthropic reports non-cached tokens in `input_tokens` and cached tokens separately in `cache_read_input_tokens`, whereas OpenAI, DeepSeek, and Gemini report total input tokens in `prompt_tokens` (inclusive of cached tokens).
- **Resolution:**
  1. Built `SessionStreamRecorder` and `SessionStreamReplayer` in `packages/coding-agent/src/core/session-recording/` with typed channel multiplexing (`reasoning`, `content`, `tool_arg`).
  2. Full message snapshots and provider usage are emitted strictly at terminal turn boundaries (`turn_end`).
  3. Implemented provider-aware cache hit ratio normalization in `stream-recorder.ts`.
- **Verification:** Unit and recovery test suites (`packages/coding-agent/test/session-recording.test.ts` and `test/session-recording-recovery.test.ts`) passed 100% with adversarial critic approval; `npm run check` and `./reinstall.sh` verified.
- **Prevention/follow-up:** Never emit full message snapshots inside per-token streaming handlers; record $O(1)$ deltas in live streams and assemble full states at turn boundaries.
- **Reusable learning:** LLM providers handle prompt cache tokens differently: Anthropic `total = input + cache_read`, OpenAI/Gemini/DeepSeek `total = prompt_tokens`, `miss = prompt_tokens - cached_tokens`. Always account for this difference when computing cache hit ratios.
- **References:** `packages/coding-agent/src/core/session-recording/`, `scripts/benchmark-agents.js`, `test/session-recording.test.ts`.

### 2026-08-16 — Completion certificates must track contradictory evidence and durable prompts

- **Status:** Resolved
- **Task/context:** Adding a sequential, evidence-backed user-requirement audit to the coding-agent completion protocol.
- **Unexpected observation or failure:** A successful focused test executed during the audit reset readiness and made the next verdict impossible, while a failed focused test executed after certificate issuance left the old token usable. Restoring before requirement definition also left `status` pointing at a decomposition prompt that might already have been compacted away.
- **Evidence:** Focused regressions reproduced all three failures: `ready_to_finish -> define -> focused test -> verdict`, `completion_ready -> failed focused test -> finish_work`, and `ready_to_finish -> controller restore -> status`.
- **Approaches tried:**
  - **Attempt:** Reuse final-verification auto-recording unchanged while layering the requirement audit above it.
    - **Outcome:** Did not work
    - **Why:** Auto-recording treated new evidence as a fresh final-state transition even when final verification was already current, and failed evidence was appended without invalidating the previously issued readiness state.
  - **Attempt:** Keep the full decomposition instructions only in the original `ready_to_finish` result.
    - **Outcome:** Did not work
    - **Why:** Persisted state survived restoration, but the model-visible tool result was not a durable recovery source after compaction.
- **Root cause:** The original final-verification lifecycle assumed readiness was terminal and evidence only accumulated before readiness. The new multi-turn audit permits evidence both during and after readiness, so every contradictory observation and every recovery instruction must participate in the persisted state machine.
- **Resolution:** Preserve active audit readiness when additional successful evidence arrives, clear the certificate and verdicts on later failed verification, re-check unresolved failed commands and verdict evidence at the completion gate, and render the exact persisted source prompts from both `ready_to_finish` and `status`.
- **Verification:** The focused requirement-audit suite covers evidence collection during audit, post-certificate failure, certificate and verdict corruption, persistence recovery, exact prompt entry IDs, and non-code mutations; `npm run check` passes.
- **Prevention/follow-up:** For any future completion state, add adversarial transitions for new positive evidence, new negative evidence, restart/compaction, and partial or failed terminal calls before considering the state terminal.
- **Reusable learning:** A completion certificate is valid only while every later observation remains consistent with it, and every recovery prompt must be reproducible from persisted state rather than an earlier transient tool result.
- **References:** `packages/coding-agent/test/task-requirement-audit-lifecycle.test.ts`, `packages/coding-agent/test/task-requirement-audit-regressions.test.ts`, `packages/coding-agent/test/task-requirement-audit-state-machine.test.ts`

### 2026-08-17 — Reinstall health checks need runtime-valid indexing assets and realistic startup timeouts

- **Status:** Partial
- **Task/context:** Reinstalling and smoke-testing the local `p` CLI after a coding-agent protocol change.
- **Unexpected observation or failure:** The first reinstall timed out while starting a large existing Qdrant store, then a later attempt reached the Apple Core AI worker but failed to load an on-disk model asset that passed the installer's structural checks.
- **Evidence:** Qdrant needed about 80 seconds to answer its health endpoint while the configured timeout was 30 seconds. The existing Core AI directory contained the expected marker, model, embedding table, and tokenizer, but the worker raised a Core AI load error. Regenerating the same-version asset allowed the real semantic-search smoke to return one result.
- **Approaches tried:**
  - **Attempt:** Treat the first `reinstall.sh` failure as a code regression.
    - **Outcome:** Did not work
    - **Why:** Direct process and endpoint checks showed Qdrant was still loading a multi-gigabyte local store and became responsive after the installer's deadline.
  - **Attempt:** Reuse the structurally complete Core AI asset.
    - **Outcome:** Did not work
    - **Why:** File presence and the artifact version marker did not prove that the runtime could load the compiled model function.
  - **Attempt:** Regenerate the asset and rerun the installer with a 120-second local Qdrant startup timeout.
    - **Outcome:** Worked
    - **Why:** The rebuilt asset loaded successfully and the larger deadline covered the observed local-store startup time.
- **Root cause:** The Qdrant deadline was shorter than this machine's observed startup time. The old Core AI artifact was runtime-invalid despite being structurally complete; whether corruption or runtime compatibility drift caused that invalidity remains unproven.
- **Resolution:** Increase the machine-local Qdrant startup timeout when its measured store load requires it, move the suspect Core AI asset aside, regenerate it, and require the real semantic-search smoke before accepting reinstall success.
- **Verification:** A complete `./reinstall.sh` rebuilt and relinked version `0.4.224`, verified compaction settings, loaded the regenerated Core AI asset, and passed real semantic search with one result.
- **Prevention/follow-up:** Add a runtime load probe or integrity fingerprint before reusing compiled Core AI assets. Keep installer logs as rotated Brotli Q6 artifacts when long-running diagnostics need persistence.
- **Reusable learning:** Structural asset markers are only a cache hint; accelerator artifacts require a runtime load probe, and service startup deadlines should reflect measured persistent-store recovery time.
- **References:** `scripts/install-apple-coreai.js`, `packages/code-index/apple_coreai_artifact.py`, `scripts/install-indexing-service.js`

### 2026-08-17 — Visual snapshots must normalize truncated feature-branch labels

- **Status:** Resolved
- **Task/context:** Running the full unit suite from an isolated feature-branch worktree.
- **Unexpected observation or failure:** Four interactive UI snapshots expected `(main)` but rendered a long feature branch truncated before its closing parenthesis.
- **Evidence:** The coding-agent suite passed 2,196 tests and failed four snapshots only on `~/dev/p/packages/coding-agent (codex/requirement-audit-cert...`; the existing sanitizer normalized complete parenthesized branch labels but not the unterminated viewport form.
- **Approaches tried:**
  - **Attempt:** Update the snapshots with the current feature-branch label.
    - **Outcome:** Did not work
    - **Why:** That would make deterministic fixtures depend on one temporary branch and simply move the failure to other branches.
  - **Attempt:** Normalize the targeted coding-agent status line when terminal truncation ends it with an ellipsis.
    - **Outcome:** Worked
    - **Why:** It removes only volatile branch text while retaining the stable path and canonical `(main)` fixture representation.
- **Root cause:** The sanitizer required a closing `)` before recognizing branch text, while the 80-column viewport truncates long branch labels before that character.
- **Resolution:** Normalize truncated branch suffixes on the coding-agent path before applying the existing complete-parenthesis normalization.
- **Verification:** Both positive and negative regressions failed before their respective sanitizer changes and then passed together with all four interactive UI snapshot tests: two files and six tests total.
- **Prevention/follow-up:** Snapshot sanitizers should cover both complete and viewport-truncated forms of every volatile status field.
- **Reusable learning:** Normalize volatile terminal fields after accounting for width truncation; delimiters visible in the source string may be absent from the captured viewport.
- **References:** `packages/coding-agent/test/ui-visual-snapshot-sanitization.test.ts`, `packages/coding-agent/test/helpers/ui-visual-snapshot-harness.ts`, `packages/coding-agent/test/interactive-ui-regression.test.ts`

### 2026-08-17 — Release approval must bind evidence to the exact immutable base

- **Status:** Resolved
- **Task/context:** Replacing the manual `/cl` confirmation before monorepo version bumps and releases.
- **Unexpected observation or failure:** The release policy asked the user to confirm that a prompt had run, but the repository contained no `/cl` implementation, persisted result, commit binding, or check in either the version-bump or release scripts. A stale or entirely absent audit therefore could not be distinguished from a current successful audit.
- **Evidence:** Repository and user-configuration searches found only the policy sentence in `AGENTS.md`; `scripts/version-bump.js` and `scripts/release.js` mutated versions without consuming audit evidence. Regression fixtures showed that direct bumps needed to be rejected before their first write and that a certificate had to become invalid after a new commit or release-input edit.
- **Approaches tried:**
  - **Attempt:** Preserve the user confirmation as the gate.
    - **Outcome:** Did not work
    - **Why:** Confirmation was neither machine-verifiable nor bound to the current main SHA or changelog contents.
  - **Attempt:** Treat any new `[Unreleased]` bullet for an affected package as semantic coverage.
    - **Outcome:** Did not work
    - **Why:** One unrelated or placeholder bullet could certify multiple independent undocumented changes. Arbitrary prose and diffs have no reliable offline relation without change-owned metadata.
  - **Attempt:** Treat certificate issuance as permanent approval.
    - **Outcome:** Did not work
    - **Why:** Version mutation necessarily changes certified inputs, so a reusable certificate would either invalidate mid-release or permit stale reuse.
  - **Attempt:** Trust a receipt's own input paths and evidence hashes during CI verification.
    - **Outcome:** Did not work
    - **Why:** A self-consistent receipt could omit workspaces or replace audit evidence unless CI reconstructed both from the certified base tree.
  - **Attempt:** Validate only allowed release path names around each commit.
    - **Outcome:** Did not work
    - **Why:** A hook could modify an allowed file after checks or during the next-cycle commit, and the tag verifier would not inspect the later main-only commit.
  - **Attempt:** Separate immutable evidence certification from a one-time persisted release transaction.
    - **Outcome:** Worked
    - **Why:** The certificate is checked and consumed while the worktree is still identical to the audited base; subsequent controlled mutations advance through explicit states and cannot mint or reuse another authorization.
- **Root cause:** An automatable evidence check was represented as a conversational convention instead of an enforced state machine at the mutation boundary.
- **Resolution:** Require commit-local `.changes` fragments with package/category/summary or an explicit reasoned exemption, automatically fetch and audit the exact `origin/main`, persist a Brotli Q6 certificate bound to SHA, target, fragment evidence, and release-input hashes, require its one-time token in `version-bump.js`, bind each commit to its exact prevalidated index tree, reconcile interrupted publication against remote ancestry, and publish main plus tag with one atomic push. Commit a Brotli Q6 receipt at the release tag; CI reconstructs the canonical input scope, reruns evidence from the certified base in an isolated worktree, and verifies the exact normalized changelog preview before publishing.
- **Verification:** Domain regressions cover malformed and historically rewritten changelogs, empty `[Unreleased]` aggregation, Markdown injection, mismatched/reused/`None`/breaking fragments, two consecutive releases, cross-process persistence, self-consistent evidence and input-scope tampering, commit and input invalidation, target mismatch, interrupted local-tag recovery, remote-main advancement after publish, unexpected and allowed-file hook injection in both commits, direct bump rejection, heterogeneous 0.4.224/0.4.134 to 0.5.0 lockstep mutation, exact-tag CI checkout, receipt verification, and a real temporary Git remote completing the audit-to-atomic-push flow.
- **Prevention/follow-up:** Keep every release mutation behind the certificate consumer, include new audit/release inputs in the canonical deterministic scope, compare commit trees rather than only path names, and add a real transition regression whenever a new release phase is introduced. Preserve protected-main review and tag/workflow permissions because repository-contained verification cannot authenticate a malicious simultaneous policy rewrite.
- **Reusable learning:** Automate evidence collection fully, bind approval to immutable inputs, consume it once at the first mutation, and independently reconstruct verifier scope and evidence; never let an artifact choose what the verifier checks.
- **References:** `scripts/release-changelog-audit.js`, `scripts/release-audit-certificate.js`, `scripts/release-transaction.js`, `scripts/release-flow-certificate.test.js`

### 2026-08-17 — Parallel agents must receive and verify the exact worktree path

- **Status:** Resolved
- **Task/context:** Parallelizing release-workflow hardening across the main checkout and an isolated feature worktree.
- **Unexpected observation or failure:** A replacement subagent reported completing SHA-pinning but wrote its two files into the main checkout instead of the feature worktree that contained the release implementation.
- **Evidence:** `git status` showed the workflow modification and a new workflow test under the main checkout, while byte comparison showed they differed from the stricter files already present in the feature worktree.
- **Approaches tried:**
  - **Attempt:** Rely on inherited conversation context to identify the intended worktree.
    - **Outcome:** Did not work
    - **Why:** The subagent inherited the process working directory even though the task text referred to the feature worktree.
  - **Attempt:** Resolve both absolute paths, remove only the two agent-owned changes from the main checkout, and retain the independently verified feature-worktree implementation.
    - **Outcome:** Worked
    - **Why:** Path-specific status and byte comparisons separated agent-owned edits from unrelated user changes before cleanup.
- **Root cause:** Delegation named the worktree informally but did not require an initial absolute `pwd` and branch assertion before editing.
- **Resolution:** Restore only the agent-owned main-checkout files, preserve every unrelated change, and continue from `/Users/dst/dev/p-requirement-audit`.
- **Verification:** The two affected paths are clean in the main checkout; the target worktree still contains the stricter SHA-pinned workflow and its focused regression.
- **Prevention/follow-up:** Every multi-worktree subtask must include the absolute worktree path and require `pwd` plus `git branch --show-current` verification before any edit. The parent must verify changed paths in both checkouts before accepting the result.
- **Reusable learning:** Shared filesystem access does not imply a shared current directory; pin and verify the absolute worktree at delegation boundaries.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`

### 2026-08-17 — Release verifiers must share the production transform and run outside the repository cwd

- **Status:** Resolved
- **Task/context:** Hardening CI verification of the exact release-tag contents and the PR-only version gate.
- **Unexpected observation or failure:** An intermediate verifier could not load because it imported `mkdtempSync` from `node:os`, used `process.cwd()` instead of the supplied repository, treated a Git ref as an expected commit path, and compared pre-release changelog bytes with released bytes. The PR gate also missed versions hidden in internal lockfile entries.
- **Evidence:** Receipt, recovery, certificate, and authorization suites initially aborted at module load. After that was exposed, foreign-cwd receipt fixtures and an internal-lock-entry regression reproduced the remaining fail-open paths. The lockfile regression exited zero before its fix.
- **Approaches tried:**
  - **Attempt:** Independently reimplement version mutation inside the CI verifier and validate a broad release allowlist.
    - **Outcome:** Did not work
    - **Why:** Duplicate transforms drift, broad path checks cannot constrain allowed-file content, and ambient cwd accidentally verifies the caller rather than the supplied repository.
  - **Attempt:** Share pure manifest and lockfile transforms, reconstruct outputs in a detached base worktree, and compare the exact path/blob set while validating the dynamic receipt separately.
    - **Outcome:** Worked
    - **Why:** Both mutation and verification now derive deterministic package, dependency, lockfile, shrinkwrap, fragment-deletion, and changelog outputs from the same certified base.
- **Root cause:** The first verifier combined too many trust-boundary responsibilities without a module-load smoke, foreign-cwd execution, or one canonical content transform.
- **Resolution:** Add `release-version-content.js`, verify lightweight tag and direct parent, recompute audit evidence at `baseSha`, bind one UTC release date, compare exact release outputs, require current origin-main ancestry, and inspect internal workspace versions and dependency ranges in PR lockfiles.
- **Verification:** `npm run check` passes; the release regressions pass in three bounded groups with clean exit codes: 32/32, 9/9, and 9/9. The full combined run also reported 50/50 passing before the compression wrapper reached its own capture limit.
- **Prevention/follow-up:** Every verifier must be tested with `repoRoot !== process.cwd()`, every executable module must have a startup path in the focused suite, and deterministic mutations must use a shared pure transform rather than copied logic.
- **Reusable learning:** At a release trust boundary, exact content reconstruction and foreign-cwd tests are mandatory; path allowlists and duplicated transformations are insufficient.
- **References:** `scripts/release-certificate-receipt.js`, `scripts/release-output-verifier.js`, `scripts/release-version-content.js`, `scripts/release-pr-version-policy.test.js`

### 2026-08-17 — Git release fixtures must pin the bare remote default branch

- **Status:** Resolved
- **Task/context:** Running the release-certificate pull-request suite on the Linux GitHub Actions runner.
- **Unexpected observation or failure:** Two release-flow tests passed locally but failed in CI when a clone could not push `main`; the bare fixture remote advertised a nonexistent default branch.
- **Evidence:** With `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`, both the local reproduction and CI emitted `warning: remote HEAD refers to nonexistent ref` followed by `error: src refspec main does not match any`. The same tests passed when the host Git default branch was already `main`.
- **Approaches tried:**
  - **Attempt:** Rely on the non-bare fixture checkout being initialized with `-b main`.
    - **Outcome:** Did not work
    - **Why:** That selected only the working repository branch; the separately initialized bare remote kept the host-dependent default branch in its `HEAD` symbolic ref.
  - **Attempt:** Initialize both the working repository and bare remote with an explicit `main` initial branch.
    - **Outcome:** Worked
    - **Why:** Fresh clones now check out the published `main` branch independently of global Git configuration.
- **Root cause:** The fixture pinned the local repository branch but left the bare remote default branch implicit, so its behavior depended on the machine's `init.defaultBranch` setting.
- **Resolution:** Initialize the bare fixture remote with `git init --bare -b main`.
- **Verification:** Run the focused release-flow and origin-ancestry tests with `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`, then rerun the ordinary focused release suite and CI.
- **Prevention/follow-up:** Every Git fixture that clones a bare remote must explicitly set that remote's initial branch or symbolic `HEAD`; never depend on host Git defaults.
- **Reusable learning:** Pin branch topology in fixtures at every repository boundary, not only in the primary working clone.
- **References:** `scripts/release-flow-test-fixture.js`, `scripts/release-flow-certificate.test.js`, `scripts/release-origin-ancestry.test.js`

### 2026-08-17 — Reject invalid CLI arguments before session initialization

- **Status:** Resolved
- **Task/context:** Re-running the full coding-agent unit suite after the release-fixture portability fix.
- **Unexpected observation or failure:** The empty `--name` integration test timed out and killed the CLI process instead of receiving the expected validation error.
- **Evidence:** The focused subprocess test repeatedly returned `code=null` after its 10-second kill deadline. A new parser regression showed that both an empty string and whitespace-only input were accepted into `Args.name` before the fix.
- **Approaches tried:**
  - **Attempt:** Treat the failure as load-only flakiness and rerun the complete suite.
    - **Outcome:** Did not work
    - **Why:** The focused test reproduced without suite load, proving that the expensive startup path preceded validation.
  - **Attempt:** Validate and diagnose empty names while parsing CLI arguments.
    - **Outcome:** Worked
    - **Why:** Invalid input now exits through the existing diagnostic path before migrations, session lookup, or runtime startup; valid names retain their original whitespace until the existing append boundary trims them.
- **Root cause:** `parseArgs` preserved blank names and `main` validated them only after creating the session manager, making a syntactic error depend on unrelated startup work.
- **Resolution:** Reject empty and whitespace-only `--name` values in `parseArgs` and remove the now-unreachable late validation branch.
- **Verification:** `test/args.test.ts` and `test/startup-session-name.test.ts` pass together with 81 tests after failing with two parser regressions and one subprocess timeout before the fix.
- **Prevention/follow-up:** Validate argument syntax and value shape in the parser; defer only checks that genuinely require runtime or repository state.
- **Reusable learning:** Fail-fast CLI validation reduces both side effects and false timeout flakes because invalid input never enters expensive initialization.
- **References:** `packages/coding-agent/src/cli/args.ts`, `packages/coding-agent/src/main/command-dispatch.ts`, `packages/coding-agent/test/args.test.ts`, `packages/coding-agent/test/startup-session-name.test.ts`

### 2026-08-17 — Source CLI subprocess tests need a load-aware watchdog

- **Status:** Resolved
- **Task/context:** Verifying the early `--name` validation fix in the complete coding-agent test suite.
- **Unexpected observation or failure:** The focused subprocess regression passed in about six seconds, but the same test still crossed its 10-second child watchdog during the full concurrent suite even though validation now happens before session initialization.
- **Evidence:** The focused parser and subprocess tests passed 81/81. In two complete suite runs, the child was killed at the fixed 10-second deadline and returned `code=null`; the second run occurred after the fail-fast parser fix. The package Vitest configuration allows 30 seconds per test.
- **Approaches tried:**
  - **Attempt:** Assume early argument validation alone would keep the source CLI subprocess below 10 seconds under every suite load.
    - **Outcome:** Partial
    - **Why:** It removed migrations/session/runtime work for invalid names, but Node still has to load the full TypeScript CLI import graph before calling `main`.
  - **Attempt:** Give the child a 20-second watchdog inside the package's existing 30-second test ceiling.
    - **Outcome:** Worked
    - **Why:** The watchdog remains bounded and leaves time for Vitest cleanup while accommodating observed cold-load contention.
- **Root cause:** The test conflated a production hang with source-module load time and used a budget too close to the loaded-suite worst case.
- **Resolution:** Keep fail-fast parser validation and raise only the test child watchdog from 10 to 20 seconds; no production timeout changes.
- **Verification:** Run the focused CLI tests, `npm run check`, and the full `npm run test:unit` with `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`.
- **Prevention/follow-up:** Size subprocess watchdogs below the enclosing test timeout but above measured loaded-suite startup, and pair them with direct unit coverage so correctness is not inferred from timing alone.
- **Reusable learning:** A source-entrypoint integration test measures both behavior and module-load cost; its watchdog must account for loaded-suite contention without becoming unbounded.
- **References:** `packages/coding-agent/test/startup-session-name.test.ts`, `packages/coding-agent/vitest.config.ts`
### 2026-08-17 — Full-workspace coverage must use the sanitized root launcher
- **Status:** Resolved
- **Task/context:** Recomputing changed-line coverage for the completion and release certificate implementation.
- **Unexpected observation or failure:** Direct package-level coverage commands activated provider e2e tests from ambient authentication and endpoint variables, producing unrelated network failures instead of the intended unit-only evidence.
- **Evidence:** The direct AI workspace run attempted provider requests and reported authorization failures, while `npm run test:unit:coverage` moved the local auth file aside, removed provider credentials through `test.sh`, and completed every workspace test suite successfully.
- **Approaches tried:**
- **Attempt:** Run each workspace `test:coverage` script directly in parallel.
- **Outcome:** Did not work
- **Why:** Package scripts do not provide the root launcher's authentication isolation and can activate environment-gated e2e cases.
- **Attempt:** Run the root `npm run test:unit:coverage` command and inspect the retained log when the compression wrapper reached its capture limit.
- **Outcome:** Worked
- **Why:** The repository launcher sanitizes provider state before invoking the same workspace coverage scripts and restores it afterward.
- **Root cause:** The direct commands bypassed the repository's unit-test environment boundary; the failures were test-selection errors, not product regressions.
- **Resolution:** Discard direct workspace coverage results and use only the root sanitized launcher for full-workspace coverage evidence.
- **Verification:** All five workspace coverage suites completed successfully, including 260 coding-agent files and 2,221 passing tests, before the changed-line checker reported 99.61% coverage.
- **Prevention/follow-up:** Keep full coverage behind `test.sh`; use package-level Vitest only for explicitly focused, known non-e2e files.
- **Reusable learning:** A package's coverage script is not necessarily a safe unit-test entrypoint; preserve the repository's environment-sanitizing root launcher whenever ambient provider configuration may exist.
- **References:** `test.sh`, `package.json`, `scripts/check-changed-coverage.js`
### 2026-08-17 — Legacy verification restores must preserve original task context
- **Status:** Resolved
- **Task/context:** Extending high-risk acceptance guidance and requirement hashing to use every persisted user prompt.
- **Unexpected observation or failure:** A restored version-2 verification state without the new `taskPrompts` field fell back directly to the benign model-authored task summary, silently dropping the original high-risk `taskContext`.
- **Evidence:** A focused restored-state regression recorded a successful broad unit suite at mutation revision 1 and received no `HIGH-RISK ACCEPTANCE AUDIT REQUIRED` guidance even though the persisted context described crash recovery and transactional writes.
- **Approaches tried:**
- **Attempt:** Treat `taskSummary` as the universal compatibility fallback for states without prompt entries.
- **Outcome:** Did not work
- **Why:** The summary is not authoritative source text and can omit the lifecycle or durability terms that trigger stricter acceptance guidance.
- **Attempt:** Prefer the persisted legacy `taskContext` with a stable synthetic source ID, using the summary only when neither prompt representation exists.
- **Outcome:** Worked
- **Why:** Restored states retain their original user-authored risk signal while new states continue to use their complete ordered prompt entries.
- **Root cause:** The prompt aggregation migration preserved the new representation but ordered its compatibility fallbacks incorrectly.
- **Resolution:** Change `sourcePromptsForState` fallback order to `taskPrompts`, legacy `taskContext`, then `taskSummary`.
- **Verification:** Focused regressions now prove both a later high-risk user clarification and a restored legacy high-risk context produce the mandatory broad-suite acceptance warning.
- **Prevention/follow-up:** Every state-schema migration must test restored prior-version records at the downstream policy decision, not only serialization round trips.
- **Reusable learning:** Compatibility fallbacks must preserve the most authoritative persisted input; a derived summary must never replace surviving original user context.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-audit-hashing.ts`, `packages/coding-agent/test/task-verification-high-risk-acceptance.test.ts`

### 2026-08-18 — Agent guidance must describe available capabilities and compact outcomes

- **Status:** Resolved
- **Task/context:** Reviewing the coding-agent system-prompt guidance added for context-efficient tool use.
- **Unexpected observation or failure:** The prompt unconditionally demanded parallel subagents, treated local `semantic_search` as proof of web access, and named a repository-local testing skill that is not necessarily loaded or shipped to the running agent.
- **Evidence:** Focused prompt regressions showed the subagent instruction with only `read` and `bash`, and showed web-research guidance when the only search capability was local semantic code search.
- **Approaches tried:**
  - **Attempt:** Encode a particular parallel workflow and named skill directly in the default prompt.
    - **Outcome:** Did not work
    - **Why:** The prompt can only rely on tools and skills actually supplied to that agent instance; prescribing unavailable mechanisms creates impossible work and distracts from the output-control objective.
  - **Attempt:** State the desired observable outcome and condition web guidance on web-capable tools.
    - **Outcome:** Worked
    - **Why:** The agent can choose an available harness, quiet reporter, or wrapper while returning only `PASS` or `FAIL` with the decisive reason and authoritative exit code.
- **Root cause:** The original guidance conflated the goal of minimizing model-visible tool output with one optional orchestration mechanism and inferred capabilities from a broad name match.
- **Resolution:** Remove the subagent demand, distinguish local semantic search from web tools, reference only loaded skills generically, and require planning the smallest useful command plus compact outcome reporting while retaining full logs outside model context.
- **Verification:** `packages/coding-agent/test/system-prompt.test.ts` passes and explicitly rejects both subagent wording and the hard-coded `test-output-discipline` skill name.
- **Prevention/follow-up:** Prompt tests must exercise both the presence and absence of capability-dependent guidance.
- **Reusable learning:** Specify the output contract and detected capabilities, not an unavailable tool, skill, or orchestration strategy.
- **References:** `packages/coding-agent/src/core/system-prompt.ts`, `packages/coding-agent/test/system-prompt.test.ts`

### 2026-08-18 — Durable gates must validate the latest state, its evidence, and equivalent command forms

- **Status:** Resolved
- **Task/context:** Auditing the requirement certificate, Git publication gate, and certified release path policy.
- **Unexpected observation or failure:** `git -C ... commit/push` and valid global Git options bypassed publication gating; a malformed latest persisted state fell back to an older valid completion certificate; a well-shaped state could claim passed final/readiness status without evidence; and the local release allowlist permitted generated model drift that CI rejected later.
- **Evidence:** Dedicated regressions failed against quoted worktree paths, `-P`, `--no-optional-locks`, `--namespace`, incomplete nested state, type-correct evidence-free readiness, stale certificates, and generated model paths before the fixes.
- **Approaches tried:**
  - **Attempt:** Match only literal `git commit` and `git push` and shallowly validate persisted object shape.
    - **Outcome:** Did not work
    - **Why:** Equivalent Git invocation grammar escaped the regex, while status strings alone did not prove current evidence or semantic state consistency.
  - **Attempt:** Make the latest state entry authoritative, validate status-dependent invariants, parse supported Git global options, and re-resolve final and acceptance evidence at the gate.
    - **Outcome:** Worked
    - **Why:** Corruption now fails closed and publication depends on current non-error evidence rather than persisted assertions alone.
- **Root cause:** Trust-boundary checks validated convenient serialized labels and one command spelling instead of the complete state/evidence relationship and equivalent invocation forms.
- **Resolution:** Add deep state/evidence validators, refuse stale-state fallback, expose a recoverable restore error until a new task is declared, verify evidence again before publication, parse Git global options before identifying the subcommand, and remove generated model sources from local release mutations.
- **Verification:** The focused system-prompt and completion regressions pass 37/37, the requirement-audit cluster passes 29/29, the release suite passes 51/51, `npm run check` passes, and the full sanitized unit harness passes.
- **Prevention/follow-up:** Add adversarial command variants and semantically impossible but type-correct persisted states whenever a durable gate changes.
- **Reusable learning:** At a durable gate, the newest record is authoritative, status must be derivable from current evidence, and alternate command grammar must not change authorization.
- **References:** `packages/coding-agent/src/core/task-verification/state-validation.ts`, `packages/coding-agent/src/core/task-verification/git-command-classification.ts`, `packages/coding-agent/test/task-requirement-audit-corrupted-restoration.test.ts`, `scripts/release-receipt-verification.test.js`

### 2026-08-18 — Noisy verification needs a compact exit-code-preserving harness

- **Status:** Resolved
- **Task/context:** Running the monorepo unit and reinstall gates from a fresh isolated worktree during the review.
- **Unexpected observation or failure:** The first unit run failed because workspace `dist` artifacts had not been built. After building, raw unit and reinstall output exceeded the context wrapper's capture limit and produced a wrapper exit of `1` even though the retained logs contained green suite summaries and completed smoke output.
- **Evidence:** The unbuilt run reported `ERR_MODULE_NOT_FOUND` for workspace `dist` files. A compact rerun after `reinstall.sh` returned authoritative exit `0` for both the full unit harness and reinstall while preserving their closed logs as Brotli Q6 artifacts.
- **Approaches tried:**
  - **Attempt:** Stream the entire monorepo command through the model-facing wrapper.
    - **Outcome:** Did not work
    - **Why:** Multi-megabyte output hit the capture budget, making the wrapper result differ from the underlying command result.
  - **Attempt:** Redirect to a bounded temporary log, retain the command exit code, close and compress the log, and print one result line.
    - **Outcome:** Worked
    - **Why:** The underlying process completed without output backpressure or context overflow, while failures can still expose a short decisive tail.
- **Root cause:** The verification launcher mixed command execution with unbounded model-visible log transport, and a fresh workspace had not yet satisfied tests that import built package artifacts.
- **Resolution:** Build/relink with the required reinstall path, then run noisy gates through a compact harness that reports only `PASS` or `FAIL` plus the saved Brotli Q6 log path.
- **Verification:** Compact `npm run test:unit` and `./reinstall.sh` runs both returned exit `0`; `p --version` returned `0.4.224` and semantic-search smoke returned one result.
- **Prevention/follow-up:** Prepare workspace artifacts before full integration-style unit runs and keep success output to one line; on failure include only exit code and the decisive log tail.
- **Reusable learning:** Preserve the subprocess exit code separately from output capture, and compress only a closed log chunk rather than an actively appended stream.
- **References:** `test.sh`, `reinstall.sh`, `.agents/skills/test-output-discipline/SKILL.md`

### 2026-08-18 — Security parser coverage must exercise lexical and restored-state boundaries directly

- **Status:** Resolved
- **Task/context:** Fixing the first CI run for the recent coding-agent hardening review.
- **Unexpected observation or failure:** Every functional suite passed, but the changed-line gate reported 90.34% because the end-to-end publication regression did not execute escape handling, option-separator exits, malformed nested validator shapes, or the independent in-memory readiness guard.
- **Evidence:** CI reported 159/176 changed executable lines and named the exact uncovered scanner, validator, and readiness-gate lines. The local sanitized coverage harness reproduced the gap.
- **Approaches tried:**
  - **Attempt:** Rely on one broad controller regression containing many Git command variants.
    - **Outcome:** Partial
    - **Why:** It proved the main authorization outcome but did not isolate shell lexical behavior or distinguish restore validation from runtime gate revalidation.
  - **Attempt:** Add responsibility-specific tests for escaped shell words, wrapper separators, safe incomplete commands, nested state-shape rejection, and in-memory readiness tampering.
    - **Outcome:** Worked
    - **Why:** Each test now asserts a real security boundary and reaches the corresponding branch through its public or persisted behavior.
- **Root cause:** Scenario breadth was mistaken for branch diversity; several defensive paths require deliberately isolated inputs even when the main end-to-end workflow is covered.
- **Resolution:** Add dedicated Git publication-classification and restored-state-validation suites, plus a runtime readiness-tampering regression, without coverage suppressions or synthetic mocks.
- **Verification:** Sanitized full coverage passed and the changed-line checker reported 176/176 executable lines, 100.00% coverage against the PR base.
- **Prevention/follow-up:** Run the local changed-line coverage gate before first push whenever a new parser or fail-closed validator is introduced.
- **Reusable learning:** For security parsers and durable-state gates, test lexical decoding, structural validation, and runtime revalidation as separate domain responsibilities.
- **References:** `packages/coding-agent/test/task-verification-git-publication-classification.test.ts`, `packages/coding-agent/test/task-verification-restored-state-validation.test.ts`, `scripts/check-changed-coverage.js`

### 2026-08-18 — Compatible dependency ranges still need lockfile security refreshes

- **Status:** Resolved
- **Task/context:** Repairing the scheduled production `npm audit` failure for the `p` monorepo.
- **Unexpected observation or failure:** The daily audit began failing with a high-severity Nano ID denial-of-service advisory even though the owning PostCSS dependency already allowed the patched version.
- **Evidence:** `npm audit --omit=dev --audit-level=moderate` reported `GHSA-2v37-7h3g-55p8` for `nanoid` 3.3.17; PostCSS declared `nanoid` as `^3.3.16`, and the advisory identifies 3.3.18 as the patched 3.x release.
- **Approaches tried:**
  - **Attempt:** Run `npm audit fix --package-lock-only --ignore-scripts --dry-run` to preview the remediation.
    - **Outcome:** Did not work
    - **Why:** The dry run reported no planned lockfile change even though the audit object still marked the transitive dependency as fixable.
  - **Attempt:** Run `npm update nanoid --package-lock-only --ignore-scripts` within the existing compatible PostCSS range.
    - **Outcome:** Worked
    - **Why:** It changed only the Nano ID lock entry from 3.3.17 to 3.3.18 without introducing a direct dependency or running lifecycle scripts.
  - **Attempt:** Run the complete unit suite after a clean `npm ci --ignore-scripts` in the new worktree but before building workspace packages.
    - **Outcome:** Did not work
    - **Why:** Workspace symlinks resolved to internal packages whose `dist/` directories did not exist yet, producing 74 unrelated `ERR_MODULE_NOT_FOUND` failures.
- **Root cause:** The committed lockfile retained Nano ID 3.3.17 after the advisory's patched threshold advanced to 3.3.18; semantic compatibility in the parent range does not update an existing lock automatically. Separately, a fresh workspace install does not build internal package artifacts that some integration-style unit tests import.
- **Resolution:** Refresh the single transitive Nano ID lock entry to 3.3.18, keep the existing PostCSS dependency range unchanged, and build the workspace through `./reinstall.sh` before rerunning the complete unit suite in a fresh worktree.
- **Verification:** A clean install resolved Nano ID 3.3.18; production `npm audit` reported zero vulnerabilities; `npm audit signatures --omit=dev` verified 224 registry signatures and 46 attestations; `npm run check`, `./reinstall.sh`, the complete non-e2e unit suite, `p --version`, and `p --list-models` passed after workspace build hydration.
- **Prevention/follow-up:** Treat scheduled audit failures as lockfile evidence first; inspect the exact dependency chain and prefer the smallest patched transitive update that remains inside the parent range. In fresh worktrees, build internal workspace packages before interpreting module-not-found failures from the complete suite.
- **Reusable learning:** A compatible semver range is not a security fix until the committed lockfile resolves to a patched artifact; verify the exact locked version and integrity. Clean dependency hydration and workspace build readiness are separate preconditions for the monorepo unit suite.
- **References:** `package-lock.json`, `.github/workflows/npm-audit.yml`, `GHSA-2v37-7h3g-55p8`.

### 2026-08-20 — Benchmark archives and reports must preserve format and attribution semantics

- **Status:** Resolved
- **Task/context:** Review and finish a local benchmark evidence cleanup that
  removed large recordings, converted closed diagnostics, and extended report
  telemetry.
- **Unexpected observation or failure:** Eighteen recording deletions had no
  replacement archives, a Brotli stream was written with a `.gz` name, cache
  hit percentage omitted cache-write tokens, Codex results inherited the PI/P
  model alias, and persisted result documents exposed machine-specific paths.
- **Evidence:** Git status identified the unmatched recording deletions;
  decompression proved existing diagnostic replacements were Brotli; a focused
  report regression reproduced `50.0%` instead of `40.0%` for input/read/write
  usage of 40/40/20; and generated JSON contained absolute home, repository,
  and result paths.
- **Approaches tried:**
  - **Attempt:** Keep the deletions because the recordings were large, or put
    all restored streams into one compressed bundle.
    - **Outcome:** Rejected.
    - **Why:** The recording evidence would be lost or no longer independently
      addressable like the repository's other completed archives.
  - **Attempt:** Infer compression from the filename and compute cache hits
    from input plus cached reads only.
    - **Outcome:** Failed.
    - **Why:** The writer already emitted Brotli bytes, and cache writes are
      prompt tokens in the canonical denominator.
  - **Attempt:** Restore each source independently as Brotli Q6, extract report
    logic for focused tests, and sanitize result documents before persistence.
    - **Outcome:** Worked.
    - **Why:** Every archive remains independently readable, report semantics
      are regression-tested, and evidence is portable without changing runtime
      measurements.
- **Root cause:** The cleanup changed storage format and reporting fields
  without an explicit round-trip inventory or focused semantic tests, while
  agent-specific model attribution was incomplete.
- **Resolution:** Restored all 18 recordings as separate `.jsonl.br` Brotli Q6
  files, corrected the diagnostic extension, excluded volatile Kilo lock state,
  added cache-write-aware telemetry, recorded the independent Codex model alias,
  sanitized persisted paths, and reduced the legacy file-size baseline by
  extracting the report module.
- **Verification:** Each restored archive decompresses byte-for-byte to its Git
  source; report and sanitization regressions pass; regenerated reports and
  result JSON contain no absolute user paths; repository checks and the full
  unit/reinstall gates provide the final integration proof.
- **Prevention/follow-up:** Storage migrations must inventory every removed
  artifact and prove decoded equivalence one file at a time. Report formulas
  and agent/model attribution require focused fixtures before regenerating
  historical evidence.
- **Reusable learning:** A smaller archive is not a valid migration until its
  decoded bytes, per-artifact boundaries, filename format, and downstream
  report semantics are all proven.
- **References:** `scripts/benchmark-agents.js`,
  `scripts/benchmark-report.js`,
  `scripts/benchmark-result-sanitization.js`,
  `scripts/benchmark-runtime-evidence.js`,
  `scripts/benchmark-report.test.js`,
  `scripts/benchmark-result-sanitization.test.js`,
  `packages/coding-agent/docs/benchmarking.md`

### 2026-08-20 — One release-fixture cleanup race did not reproduce

- **Status:** Partial
- **Task/context:** Run the complete non-E2E unit gate after benchmark evidence
  hardening.
- **Unexpected observation or failure:** The first run passed 50 of 51 release
  regressions but one fixture cleanup raised `ENOTEMPTY` while removing its
  private temporary repository.
- **Evidence:** The failing assertion was cleanup after the expected pre-commit
  rejection, not the release-policy behavior under test. A complete rerun
  passed with authoritative exit status zero.
- **Approaches tried:**
  - **Attempt:** Treat the first aggregate exit as a benchmark-code failure.
    - **Outcome:** Rejected.
    - **Why:** The decisive stack was in temporary-directory removal after the
      policy assertion, outside every changed benchmark module.
  - **Attempt:** Rerun the entire canonical unit harness without changing the
    release fixture.
    - **Outcome:** Worked.
    - **Why:** All suites, including the same release regression and the new
      benchmark tests, completed successfully.
- **Root cause:** Unconfirmed; the one-time `ENOTEMPTY` indicates a late writer
  or filesystem cleanup race in the release fixture. There is not enough
  evidence to assign a code defect after one failure and one clean full rerun.
- **Resolution:** No release-test behavior was weakened or changed. The final
  gate uses the successful complete rerun, while the initial failure remains
  recorded as non-authoritative diagnostic evidence.
- **Verification:** `npm run test:unit` completed with exit status zero on the
  full rerun; focused benchmark tests also pass independently.
- **Prevention/follow-up:** If this cleanup failure recurs, capture the exact
  remaining directory entries and owning processes before retrying, then add a
  focused lifecycle regression instead of broad retry logic.
- **Reusable learning:** Separate an assertion failure from teardown failure,
  but require a complete clean rerun before treating a one-time cleanup race as
  non-blocking.
- **References:** `scripts/release-flow-certificate.test.js`, `test.sh`

### 2026-08-20 — Pre-commit restaging must preserve already staged ignored evidence

- **Status:** Resolved
- **Task/context:** Commit independently restored benchmark recordings that are
  intentionally ignored by the repository's general evidence rule.
- **Unexpected observation or failure:** The pre-commit hook passed every
  validation command, then rejected the commit while restaging a recording that
  was already force-added to the index.
- **Evidence:** Git reported that the recording directory was ignored at the
  hook's plain `git add "$file"` step; the index already contained exactly 18
  intentional `.jsonl.br` replacements.
- **Approaches tried:**
  - **Attempt:** Bypass the hook or temporarily change the ignore policy.
    - **Outcome:** Rejected.
    - **Why:** That would remove validation or broaden the permanent evidence
      policy just to publish a reviewed exception.
  - **Attempt:** Restage only current index members with NUL-delimited paths and
    `git add -f --` after formatting.
    - **Outcome:** Worked.
    - **Why:** Force applies only to files already selected in the index, while
      NUL delimiting also preserves filenames containing spaces.
- **Root cause:** The hook forgot that an intentionally force-staged ignored
  file remains ignored when the formatter restaging loop later calls plain
  `git add`.
- **Resolution:** Moved formatter restaging into a focused helper that reads the
  current index safely, rejects partially staged paths before formatting, and
  force-restages additions, modifications, and deletions only for those indexed
  paths using literal Git pathspecs. The hook now also propagates helper
  failures.
- **Verification:** A temporary-repository regression force-stages an ignored
  archive with special characters in its name, modifies it, and proves the
  helper updates its index content without staging unrelated work. Additional
  cases cover pre-staged deletion, deletion during formatting, partial staging,
  colon-prefixed pathspec magic, and hook-level restaging failure.
- **Prevention/follow-up:** Keep ignore exceptions explicit at initial staging;
  post-validation restaging must operate only on paths already present in the
  index.
- **Reusable learning:** `git add -f` is safe for formatter restaging only when
  its input is derived from the existing index rather than the working tree.
- **References:** `.husky/pre-commit`, `scripts/restage-precommit-files.js`,
  `scripts/pre-commit-restage.test.js`

### 2026-08-20 — Detached Git maintenance raced release-fixture cleanup

- **Status:** Resolved
- **Task/context:** Complete the full non-E2E unit gate after benchmark and
  pre-commit hardening.
- **Unexpected observation or failure:** The release-policy assertions passed,
  but recursive removal of a temporary Git fixture intermittently failed with
  `ENOTEMPTY`; a second full run reproduced the same lifecycle failure.
- **Evidence:** The directory left after the failed removal contained only a
  newly written `repo/.git/objects/info/packs`, identifying a late Git object
  maintenance writer after the release subprocess had returned.
- **Approaches tried:**
  - **Attempt:** Treat the first cleanup failure as a one-time filesystem event
    after one clean rerun.
    - **Outcome:** Failed.
    - **Why:** A later authoritative full run reproduced the same late-writer
      shape in another release fixture.
  - **Attempt:** Add generic recursive-delete retries.
    - **Outcome:** Rejected.
    - **Why:** Retrying deletion would mask the unowned background process
      rather than make fixture process ownership deterministic.
  - **Attempt:** Disable automatic and detached maintenance/GC in both the
    fixture repository and its bare remote.
    - **Outcome:** Worked.
    - **Why:** Release tests do not need optimization, and every Git writer now
      remains synchronous with the fixture lifecycle.
- **Root cause:** Git's automatic maintenance/GC policy was inherited by
  short-lived release repositories, allowing detached object-info work to race
  the test's synchronous cleanup.
- **Resolution:** Release-flow fixtures now configure `maintenance.auto=false`,
  `maintenance.autoDetach=false`, `gc.auto=0`, and `gc.autoDetach=false` on
  the local repository, bare remote, and every temporary clone created under
  the fixture root.
- **Verification:** A focused regression proves all four repository-local
  settings on the fixture repository, bare remote, and a managed clone; the
  release-flow suite and complete unit gate pass without teardown residue.
- **Prevention/follow-up:** Temporary release Git fixtures that recursively
  delete repositories, remotes, or clones must disable detached maintenance
  locally unless the test explicitly owns and joins that background lifecycle.
- **Reusable learning:** A synchronous parent Git command does not prove that
  auto-maintenance has no detached descendants; control the repository policy,
  not the delete retry count.
- **References:** `scripts/release-flow-test-fixture.js`,
  `scripts/release-flow-certificate.test.js`

### 2026-08-20 — Ignored archives can mask incomplete benchmark publication

- **Status:** Resolved
- **Task/context:** Publish restored and newly generated benchmark evidence after
  the local archive-integrity gate passed.
- **Unexpected observation or failure:** CI reported thirteen broken Brotli
  references although the same test was green in the development worktree.
- **Evidence:** Eleven referenced archives existed locally under ignored
  recording paths but were absent from `git ls-files`: two replacements for
  deleted gzip diagnostics and nine recordings for newly added result files.
- **Approaches tried:**
  - **Attempt:** Narrow the test because older benchmark evidence appeared to
    be outside the migration scope.
    - **Outcome:** Rejected after inspecting the exact targets.
    - **Why:** Every reported target was task-owned and required by a changed or
      newly added evidence document.
  - **Attempt:** Require both filesystem existence and Git tracking for every
    Brotli reference, then force-stage only the missing archives.
    - **Outcome:** Worked.
    - **Why:** The local gate now models the clean CI checkout while preserving
      the repository's intentional broad ignore rule.
- **Root cause:** `existsSync` treated ignored local archives as publishable
  evidence, so the pre-commit test could not detect files omitted from the
  index.
- **Resolution:** Archive integrity now derives its target inventory from
  `git ls-files`, rejects empty intent-to-add entries, and fully decodes the
  staged Git blob; all eleven omitted archives were validated and explicitly
  force-staged without broadening the ignore policy.
- **Verification:** The strengthened test failed locally with the same thirteen
  references as CI before staging and passed after all eleven unique targets
  became tracked. The two converted diagnostics decode byte-for-byte to their
  deleted gzip sources, and all eleven Brotli streams pass integrity checks.
- **Prevention/follow-up:** Evidence-reference tests must assert publication
  state, not only worktree state, whenever archive paths are intentionally
  ignored.
- **Reusable learning:** A clean local filesystem is not proof of a complete
  commit; ignored dependencies require index-aware referential-integrity tests.
- **References:** `scripts/benchmark-archive-references.test.js`, GitHub Actions
  run `32297286225`.

### 2026-08-21 — Bounded project prompts need exact retrievable authority and independently keyed derivations

- **Status:** Resolved
- **Task/context:** Replace positional AGENTS/CLAUDE prompt truncation with a
  hash-driven processor, bounded injected block, and separate rule and skill
  readers.
- **Unexpected observation or failure:** The old 6,000-character keyword scan
  retained only 36 of 257 nonblank repository instruction lines and dropped
  every rule from the version-bump section onward. An initial replacement also
  called the model for small exact files, permanently cached failed
  compilations, recompiled when only skills changed, trusted cache-declared
  skill roots, and could corrupt a surrogate pair at a module boundary.
- **Evidence:** Direct system-prompt measurement showed an approximately
  37,000-character prompt and the exact 36/257 retained-line result. Focused
  adversarial reproductions exercised a forged self-consistent manifest with
  `baseDir` changed to `/`, two same-result cold-start processes, mixed-input
  live sessions, a 24,000-byte Unicode boundary, no-auth then working-compiler
  recovery, oversized resources, and a catalog larger than 512,000 bytes.
  The first installed local-model compile also ended with sanitized evidence
  `SyntaxError: Unexpected end of JSON input` while emitting every module
  trigger.
- **Approaches tried:**
  - **Attempt:** Keep a positional keyword excerpt under a fixed limit.
    - **Outcome:** Did not work
    - **Why:** Source order, not rule importance, decided which authoritative
      constraints disappeared.
  - **Attempt:** Store only a model-generated summary and treat extracted rules
    as ordinary skills.
    - **Outcome:** Rejected
    - **Why:** A summary is lossy authority, and skill discovery semantics do
      not express mandatory repository instructions.
  - **Attempt:** Hash the combined AGENTS and skill input and compile on every
    miss.
    - **Outcome:** Did not work
    - **Why:** It disclosed small files unnecessarily and resent unchanged
      instructions whenever an unrelated skill changed.
  - **Attempt:** Keep exact rule modules, key the model derivation only by the
    AGENTS chain, and build the skill catalog deterministically.
    - **Outcome:** Worked
    - **Why:** Exact authority stays locally retrievable, small inputs avoid the
      provider, and skill-only changes do not invalidate model work.
- **Root cause:** Prompt budgeting, authoritative storage, model derivation,
  skill discovery, and cache authority were treated as one lossy prompt-format
  operation instead of separate identities and trust boundaries.
- **Resolution:** Measure exact injection first; for overflow, preserve every
  UTF-8-safe exact module and inject only bounded routing. Cache successful
  compiler output by AGENTS hash, retry failures, paginate catalogs, pin live
  sessions to immutable versions, preflight read sizes, provide an ordinary-read
  fallback guide, and deep-compare cached source/module/canonical-skill records
  with fresh discovery before trusting paths. Record failed compiler attempts
  by model identity with a bounded backoff so fallback remains recoverable
  without repeating a slow failure on every startup. Keep model trigger
  overrides optional because deterministic heading triggers already provide a
  complete fallback; this leaves the model's bounded output budget for the
  optimized routing body.
- **Verification:** Six focused suites pass 33 tests, including cross-process,
  tamper, recovery, Unicode, pagination, allowlist, and size-limit regressions.
  The complete non-E2E gate passes 262 Vitest files and 2,274 tests, with all
  Node and Python segments at zero failures; `npm run check` and
  `./reinstall.sh` pass. A live first compile produced a 4,929-character block,
  reconstructed all three sources exactly, and a cached second startup reached
  the TUI in under five seconds; `read_rules` retrieved the late Version Bump
  module and completed with `V3_READ_RULES_OK`.
- **Prevention/follow-up:** Preserve the strict whole-block budget and add a
  regression for every new cache identity, retrieval route, or provider
  failure transition. Never let a mutable global pointer invalidate an already
  prepared session or let cached metadata define filesystem authority.
- **Reusable learning:** Separate source authority, model-derived routing, and
  deterministic catalogs by the narrowest relevant hash; bound only the
  injected representation, never the retrievable authoritative content.
- **References:** `packages/coding-agent/src/core/project-instructions/`,
  `packages/coding-agent/test/project-instructions-cache-integrity.test.ts`,
  `packages/coding-agent/test/project-instructions-recovery.test.ts`,
  `packages/coding-agent/docs/project-instructions.md`.

### 2026-08-21 — Cache-boundary tests must canonicalize macOS temporary roots

- **Status:** Resolved
- **Task/context:** Adding direct corruption and lifecycle tests for the project-instruction compilation cache on macOS.
- **Unexpected observation or failure:** Both direct cache tests failed the workspace-containment guard even though their cache directories were visibly nested beneath the temporary workspace.
- **Evidence:** The fixtures supplied a `/var/folders/...` workspace root while `realpathSync()` resolved the cache authority through `/private/var/folders/...`; the focused suite passed after the fixture supplied the canonical workspace root used by production.
- **Approaches tried:**
  - **Attempt:** Pass the raw `mkdtempSync(tmpdir())` result directly to the low-level cache API.
    - **Outcome:** Did not work
    - **Why:** macOS exposes `/var` as a symlink, so string containment against a canonical cache path correctly rejected the noncanonical authority root.
  - **Attempt:** Canonicalize the temporary workspace with `realpathSync()` before constructing cache options.
    - **Outcome:** Worked
    - **Why:** Both sides of the security boundary then used the same filesystem identity without weakening containment checks.
- **Root cause:** The test bypassed the production processor, which canonicalizes the discovered workspace before calling cache primitives, and therefore omitted a required low-level API precondition.
- **Resolution:** Direct cache tests now pass a canonical workspace root while retaining the raw temporary path only for cleanup.
- **Verification:** `project-instructions-compilation-cache.test.ts` passes both successful-record and failure-backoff corruption lifecycles; the changed-line coverage gate passes at 99.01%.
- **Prevention/follow-up:** Canonicalize both authority roots and candidate paths in direct filesystem-boundary fixtures; never relax containment logic to accommodate a path alias.
- **Reusable learning:** On macOS, `/var` and `/private/var` can identify the same object but fail lexical containment; security tests must model the production canonicalization boundary.
- **References:** `packages/coding-agent/test/project-instructions-compilation-cache.test.ts`, `packages/coding-agent/src/core/project-instructions/cache-safety.ts`.

### 2026-08-21 — Atomic directory collisions must validate state, not errno

- **Status:** Resolved
- **Task/context:** Adversarial review of concurrent content-addressed project-instruction cache installation.
- **Unexpected observation or failure:** After removing a non-atomic existence preflight, the collision handler accepted `EEXIST` and `ENOTEMPTY`, but Windows can report `EPERM` when renaming a temporary directory onto an existing deterministic version.
- **Evidence:** A focused regression injected a Windows-style `EPERM` after a valid winner already existed; the old handler threw `Destination exists`, while the state-validating handler reused the winner and returned the same immutable version.
- **Approaches tried:**
  - **Attempt:** Enumerate the expected POSIX collision error codes.
    - **Outcome:** Did not work
    - **Why:** Rename error codes for an existing destination directory vary by platform.
  - **Attempt:** On any rename error, accept only a destination that passes the complete immutable-version validation and otherwise rethrow the original error.
    - **Outcome:** Worked
    - **Why:** The decision now depends on authoritative state, so it is portable and cannot hide a failed install without a valid deterministic winner.
- **Root cause:** The collision protocol treated an operating-system errno as the invariant instead of treating the integrity-checked destination as the invariant.
- **Resolution:** `installVersion()` now validates the deterministic winner after every rename failure and rethrows unless that winner is complete and authoritative.
- **Verification:** The Windows-style collision regression fails before the fix and passes after it; cache recovery and real cross-process same-result concurrency suites also pass.
- **Prevention/follow-up:** For cross-platform atomic filesystem protocols, test representative foreign error codes and bind recovery to validated postconditions.
- **Reusable learning:** An errno explains why an operation failed on one platform; a validated postcondition proves whether a concurrent operation already achieved the intended result.
- **References:** `packages/coding-agent/test/project-instructions-cache-rename.test.ts`, `packages/coding-agent/src/core/project-instructions/cache.ts`.

### 2026-08-21 — Built-in tools must be discoverable through CLI help

- **Status:** Resolved
- **Task/context:** Installed-CLI smoke verification for the new `read_rules` and `read_skills` tools.
- **Unexpected observation or failure:** Both readers were active in sessions and accepted by `--tools`, but `p --help` omitted their names from the built-in tool catalog.
- **Evidence:** The installed help output ended with the legacy built-ins while the session integration suite reported both readers active; a focused help regression failed on both missing names before the fix.
- **Approaches tried:**
  - **Attempt:** Treat the system-prompt routing text as sufficient discoverability.
    - **Outcome:** Did not work
    - **Why:** Users constructing an explicit `--tools` allowlist need the exact accepted names before a session starts.
  - **Attempt:** Add both names and concise capability descriptions to the canonical CLI help output.
    - **Outcome:** Worked
    - **Why:** The installed command contract now matches the runtime tool registry.
- **Root cause:** Tool registration and help text are maintained through separate paths, and the feature initially updated only runtime registration.
- **Resolution:** `p --help` now advertises `read_rules` and `read_skills` beside the other built-ins.
- **Verification:** `cli-help-project-instruction-tools.test.ts` fails before the help update and passes after it; the installed help will be rechecked after relinking.
- **Prevention/follow-up:** Every new built-in tool must add a CLI-help contract assertion alongside runtime registration tests.
- **Reusable learning:** A callable feature is not fully installed if users cannot discover its exact allowlist name from the product's canonical help surface.
- **References:** `packages/coding-agent/test/cli-help-project-instruction-tools.test.ts`, `packages/coding-agent/src/cli/args.ts`.

### 2026-08-21 — Benchmark stop gates must define every degradation dimension

- **Status:** Partial
- **Task/context:** Comparing the compiled project-instruction prompt against the latest same-model `p` result for four benchmark fixtures, with an instruction to stop on the first degradation.
- **Unexpected observation or failure:** Calculator improved across quality, runtime, tokens, and tool errors, while monolith retained 6/6 quality and used 20.7% fewer tokens but ran 7.3% slower and increased tool errors from one to seven.
- **Evidence:** Calculator completed in 469.7 seconds versus 649.4 with 939,560 versus 1,171,998 tokens. Monolith completed in 1,133.3 seconds versus 1,056.6 with 1,713,582 versus 2,159,695 tokens; its failed iterations included five shell commands, one edit, and one premature finish attempt.
- **Approaches tried:**
  - **Attempt:** Treat only fixture quality and terminal status as degradation criteria.
    - **Outcome:** Incomplete
    - **Why:** It would label a materially slower, more error-prone run as unchanged even though the user's stop instruction said any degradation.
  - **Attempt:** Continue inventory and saga to average out the mixed result.
    - **Outcome:** Rejected
    - **Why:** A single run cannot establish causality, and continuing would violate the explicit stop-on-first-degradation cost guard.
  - **Attempt:** Finish the active monolith task, compare all reported dimensions, then stop before starting inventory.
    - **Outcome:** Worked
    - **Why:** It produced a complete comparable result while avoiding roughly 95 minutes of additional baseline runtime.
- **Root cause:** The benchmark is multidimensional and nondeterministic. Reduced prompt/token volume did not prevent model-level implementation mistakes from dominating wall time in one fixture, so the processor cannot be credited with either the slowdown or a universal speedup from one repetition.
- **Resolution:** Preserve the calculator and monolith reports, record the mixed evidence in the PR, keep the feature draft, and leave inventory and saga unstarted.
- **Verification:** Both completed fixtures passed at 6/6; the stop occurred only after monolith's final report confirmed the runtime and tool-error regressions.
- **Prevention/follow-up:** Before future benchmark gates, name primary quality/status invariants plus secondary runtime, token, and error tolerances. Use repeated runs only when the user authorizes the additional cost needed for a causal performance claim.
- **Reusable learning:** A lower-token prompt can coexist with a slower agent run; benchmark release gates must compare quality, terminal status, runtime, tokens, and execution errors without attributing one-run variance to the prompt change.
- **References:** `benchmarks/results/2026-08-21-project-instructions-p-calculator/`, `benchmarks/results/2026-08-21-project-instructions-p-monolith/`.
