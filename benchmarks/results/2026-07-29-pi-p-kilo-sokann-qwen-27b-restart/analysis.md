# PI vs P vs Kilo benchmark analysis

Run completed at `2026-07-29T08:40:22Z`.

## Configuration

- Sequential order: PI, then P, then Kilo.
- Versions: PI `0.82.1`, P `0.4.110`, Kilo `7.4.16`.
- PI/P alias: `mini-pc/model`.
- PI/P resolved response model: `mini-pc/sokann-qwen-27b-cache`.
- Kilo alias: `llm-orchestrator/sokann-qwen-27b`.
- Both aliases use the same Sokann Qwen 27B weight file, but Kilo did not emit a
  request or response event, so its resolved response model could not be
  verified during the benchmark.
- Per-task limits: 300 seconds for the calculator and 600 seconds for the
  monolith split.

## Results

| Agent | Task | Process status | Quality checks | Time | Tokens | Tools |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| PI | calculator | timed out | 4/6 | 300.0 s | 90,328 | 16 |
| PI | monolith split | passed | 6/6 | 394.3 s | 144,267 | 25 |
| P | calculator | timed out | 6/6 | 300.0 s | 312,741 | 29 |
| P | monolith split | passed | 6/6 | 548.6 s | 517,519 | 38 |
| Kilo | calculator | timed out | 1/6 | 300.1 s | 0 | 0 |
| Kilo | monolith split | timed out | 3/6 | 600.1 s | 0 | 0 |

## Findings

1. P produced the strongest workspace quality: both final workspaces passed all
   acceptance checks. Its calculator still failed process-level completion
   because the agent did not finish before the hard timeout.
2. PI completed the monolith split correctly and more efficiently than P:
   154.3 seconds faster, 3.59 times fewer tokens, and 13 fewer tool calls.
3. PI's calculator was incomplete at timeout. Typecheck passed, but tests and
   the CLI acceptance expression failed.
4. P's calculator workspace was complete at timeout. Tests, typecheck, and the
   CLI acceptance expression all passed despite the missing completion signal.
5. P used 3.46 times as many tokens as PI on the calculator and 3.59 times as
   many on the monolith split. It also recorded more tool errors on both tasks.
6. Kilo did not begin either agent loop. Both raw gzip recordings contain an
   empty JSONL stream. The first stderr contains only a successful one-time
   SQLite migration; the second stderr is empty.
7. A separate post-benchmark Kilo smoke reproduced the hang for more than 100
   seconds. During that smoke the orchestrator remained at zero active requests
   and zero queued requests, proving that Kilo stalled before sending a request
   to the backend.
8. `kilo config check` reported no warnings and `kilo models
   llm-orchestrator` listed `llm-orchestrator/sokann-qwen-27b`, so the failure is
   not an unknown model alias.
9. No benchmark agent installed dependencies or changed the fixture project
   configuration in the completed restart run.

## Conclusion

For successful end-state quality, P ranks first and PI second. For efficiency
on the task both completed, PI is decisively better. Kilo cannot be ranked on
code quality because its CLI did not reach the model or modify either
workspace. The generated report's simple `p` winner is therefore a
quality-check result, not a clean process-completion or efficiency win.

This is one repetition and should be treated as directional. A meaningful
stability ranking needs additional repetitions after the Kilo startup hang is
fixed.
