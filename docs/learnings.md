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
