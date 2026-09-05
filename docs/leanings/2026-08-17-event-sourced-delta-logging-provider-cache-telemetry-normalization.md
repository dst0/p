# 2026-08-17 — Event-Sourced Delta Logging & Provider Cache Telemetry Normalization

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
