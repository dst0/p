# Changelog

## [Unreleased]

### Added

- Add durable task-verification gates that require evidence-backed baseline validation before bug, behaviour, and refactor mutations, invalidate stale verification after every mutation, and block successful completion or publishing until fresh semantic verification passes.

### Fixed

- Validate changelog structure before release, require descending release versions, and document UTC release dates.

## [0.4.41] - 2026-07-23

### Fixed

- Fix `finish_work` reconciliation timing: auto-reconcile only after confirming the next tool call is not an error, so validation failures preserve plan state for agent repair.

## [0.4.40] - 2026-07-24

### Added

- Auto-reconcile session state when the agent calls `finish_work(status: 'success')`: automatically transition `not_started` and `in_progress` plan items to `done` so the consistency gate passes without a protocol-repair turn.
- Strengthen system prompt completion protocol: require the agent to examine `<working_state>` before calling `finish_work`, verify all plan items are genuinely done, complete remaining work if not, and repeat until all tasks are complete before calling `finish_work` with status `success`.

## [0.4.38] - 2026-07-23

### Changed

- Display version before repository path on the first line of the TUI footer instead of stats line.

### Added

- Add `install.sh` for cross-platform (Ubuntu/macOS) dependency detection and installation, including Node.js, and update README with installation instructions.
- Add `/index up` to move the active repository to the top of the system indexing queue, safely preempt lower-priority background work, and surface progress in the existing footer indicator.

### Fixed

- Keep healthy long-running repository indexing alive while progress continues, instead of aborting and restarting full RAG generations at the fixed daemon timeout.
- Keep incremental indexing on the latest stable file contents when files change again during a refresh, instead of failing the pass and forcing unnecessary recovery work.
- Prioritize the current PAgent repository in the system indexing daemon, prevent an active repository from consuming multiple workers, preserve FIFO refresh fairness, and automatically reach missing-collection recovery before subsequent semantic searches.
- Route semantic-search Qdrant requests through P's configured fetch runtime instead of the Qdrant SDK's incompatible bundled undici dispatcher, cover the PAgent HTTP runtime automatically, allow local query embedding enough time while background indexing is active, and make source reinstalls update and verify every npm-backed `p` command on `PATH`.
- Keep the code-index daemon draining repositories after workers finish, enforce singleton service and backend ownership, prevent PAgent searches from running foreground refreshes, cancel timed-out refreshes, rebuild missing Qdrant generations, reload manifests written by other processes, report semantic-search backend failures truthfully, and render an explicit 0% footer state when progress has started.
- Validate source reinstalls with a real temporary-repository semantic-search call, wait for smoke-owned backend processes to release their ports, and safely replace stale launchd, systemd, and managed-backend processes.

## [0.4.25] - 2026-07-21

### Added

- Added JSONC file support for code-index vocabulary recognition, enabling indexing of JSON configuration files with comments.
- Add a time-bounded same-model benchmark comparing p with upstream pi-coding-agent, including JSONL recordings, fixture quality checks, and a Markdown report.
- Expand the benchmark to long-form TypeScript calculator and existing-repository monolith-split tasks, with compressed recordings, stronger acceptance checks, and targeted task reruns.

- Install a persistent macOS/Linux code-indexing service from `reinstall.sh`, remember repository opt-in decisions, and incrementally reindex watched files in the background.
- Show the active repository's indexing state and live progress percentage in the footer, with a persisted `/settings` visibility toggle.

### Changed

- Updated esbuild from vulnerable version 0.23.1 to 0.28.1 via npm package.json override, addressing a prototype pollution vulnerability in the esbuild binary.

### Fixed

- Fix code-index vocabulary error causing indexing failures on certain file content patterns.
- Fix code-index daemon stalling on large repositories by implementing bounded file queueing with concurrency limits.
- Fix embedding server auto-start failure during reinstall by ensuring proper service registration before startup.
- Fix semantic search reliability issues with Qdrant client connection handling and retry logic.
- Fix structured state compacting to preserve session state fidelity during context window compaction.
- Resolve semantic search reliability issues with improved error handling and connection stability.
- Fix `semantic_search` tool failure ("fetch failed: invalid onError method") by bypassing the problematic undici dispatcher in the Qdrant client.
- Load legacy `pi` extension manifests and package aliases so existing extensions continue to start after the `p` rebrand.
- Keep optional search-tool installation and the first-use indexing prompt out of the global interactive startup barrier.
- Run the TUI startup profiler under a real terminal and terminate it after graceful runtime disposal instead of waiting on background handles.
- Persist a disabled repository indexing decision when the first-use selector is dismissed, preventing repeated prompts while retaining `/index enable` opt-in.
- Keep retrying agent turns visibly in their real llm-orchestrator queue position, including server-reported queue duration, instead of replacing the status with local unsent-message counts.
- Preserve complete provider prompt prefixes until a formal persisted compaction, without live tool-result stubbing or threshold truncation, and compact between tool turns at one visible cache boundary
- Use plan-item status as the sole progress source while retaining active Decisions, Files, and Risks in model checkpoints and `/state`
- Append a hidden cache-stable plan-state reminder after 90 seconds of sustained ordinary tool work, resetting the interval after state updates and formal compaction
- Persist tool-turn checkpoints and refreshed working state so agents continue from completed actions instead of repeating them
- Keep the initial provider request small by registering extension and MCP tools lazily, with `tool_search` activating only relevant schemas instead of sending every cached tool definition

## [0.4.0] - 2026-07-06

### Fixed
