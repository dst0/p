# PI vs P vs Kilo: event-sourced inventory

## Configuration

- Date: 2026-07-29
- Sequential order: PI, P, Kilo
- PI: `0.82.1`
- P: `0.4.110`
- Kilo: `7.4.16`
- PI/P alias: `mini-pc/sokann-qwen-27b`
- Kilo alias: `llm-orchestrator/sokann-qwen-27b`
- Resolved backend model: `mini-pc/sokann-qwen-27b`
- Per-agent timeout: 1,800 seconds

The agents received the same fixture and prompt in fresh workspaces. The task
required a transactional event-sourced inventory engine with optimistic
concurrency, exact command idempotency, atomic multi-SKU batches, immutable
reads, deterministic hash-chained JSONL export, strict replay validation, and
tamper detection.

## Results

| Agent | Completed | Quality checks | Wall time | Total tokens | Tool calls | Tool errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PI | no | 1/6 | 608.5 s | 28,805 | 5 | 0 |
| P | no | 5/6 | 1,640.3 s | 701,918 | 34 | 8 |
| Kilo | no | 1/6 | 688.8 s | 84,216 | 6 | 0 |

None passed the complete task. All three exited before the 30-minute timeout.

## Findings

1. P was decisively best on implementation quality. It created the required
   modules and its own tests, and both visible tests and TypeScript typecheck
   passed. It failed only the combined hidden transactional, replay, and
   tamper-detection suite.
2. PI and Kilo did not create the required implementation. Both preserved the
   supplied contract/configuration but passed no substantive quality gate.
3. P used approximately 24 times PI's total tokens and eight times Kilo's.
   Its quality advantage came with much higher latency, tool count, and eight
   tool errors.
4. P and Kilo both temporarily renamed `package.json` to `pkg.json`. P recovered
   and completed a substantial implementation; Kilo did not. P also created a
   `package-lock.json` despite the instruction not to install dependencies.
5. PI's cumulative JSON streaming produced 16,769 raw events and a 208 MB gzip
   recording. P produced 49,268 raw events and a 320 MB recording. This exposed
   and motivated the harness change to stream recordings directly to gzip
   instead of concatenating stdout in memory.

## Earlier Kilo reruns after configuration repair

| Task | Process result | Quality | Wall time | Total tokens | Tool calls |
| --- | --- | ---: | ---: | ---: | ---: |
| TypeScript calculator | completed | 6/6 | 248.6 s | 243,255 | 18 |
| Monolith split | timed out | 6/6 | 600.1 s | 501,065 | 34 |

The repaired Kilo path therefore works and can produce passing workspaces.
The monolith result also demonstrates why process completion and final
workspace quality are reported separately.

## Evidence

- PI hard-task metadata: [`../2026-07-29-pi-event-sourced-inventory-exact-v2/results.json`](../2026-07-29-pi-event-sourced-inventory-exact-v2/results.json)
- P hard-task metadata: [`../2026-07-29-p-event-sourced-inventory-exact/results.json`](../2026-07-29-p-event-sourced-inventory-exact/results.json)
- Kilo hard-task metadata: [`../2026-07-29-kilo-event-sourced-inventory-exact/results.json`](../2026-07-29-kilo-event-sourced-inventory-exact/results.json)
- Kilo calculator metadata: [`../2026-07-29-kilo-fixed-calculator/results.json`](../2026-07-29-kilo-fixed-calculator/results.json)
- Kilo monolith metadata: [`../2026-07-29-kilo-fixed-monolith/results.json`](../2026-07-29-kilo-fixed-monolith/results.json)

Raw gzip recordings, stderr, and final workspaces remain in the corresponding
local result directories. The two cumulative PI/P recordings are intentionally
not committed because together they exceed 500 MB.
