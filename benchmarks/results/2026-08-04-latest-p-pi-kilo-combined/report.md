# PI/P/Kilo comparable benchmark

Generated: 2026-08-04T11:50:55.883Z

Versions: `pi 0.83.0`, `p 0.4.118`, `kilo 7.4.17`

Resolved backend model: `mini-pc/sokann-qwen-27b-cache`

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 1/3 | 1/3 | 11/112 | 0 | 2 | 508,300 ms | 20,462 | 6.7 | 0.0 |
| p | 2/3 | 2/3 | 105/112 | 1 | 0 | 1,084,249 ms | 419,743 | 25.3 | 1.7 |
| kilo | 2/3 | 2/3 | 101/112 | 0 | 1 | 572,662 ms | 510,492 | 28.7 | 0.3 |

Directional winner by completed passes, quality passes, then total tokens: **p**.

## Per-task results

| Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| pi | typescript-calculator | passed | 650,820 ms | 32,653 | 15 | 6/6 | 6/6 |
| pi | monolith-split | failed | 143,092 ms | 0 | 0 | 3/6 | 3/6 |
| pi | event-sourced-inventory | failed | 730,989 ms | 28,733 | 5 | 1/30 | 2/100 |
| p | typescript-calculator | passed | 309,115 ms | 379,907 | 20 | 6/6 | 6/6 |
| p | monolith-split | passed | 544,879 ms | 391,473 | 31 | 6/6 | 6/6 |
| p | event-sourced-inventory | timed_out | 2,398,754 ms | 487,850 | 25 | 28/30 | 93/100 |
| kilo | typescript-calculator | passed | 236,251 ms | 169,138 | 21 | 6/6 | 6/6 |
| kilo | monolith-split | passed | 560,742 ms | 538,339 | 32 | 6/6 | 6/6 |
| kilo | event-sourced-inventory | failed | 920,993 ms | 823,999 | 33 | 27/30 | 89/100 |

## Provenance

- All agents used the same loaded backend model. Kilo model-resolution and request probes passed before fixtures.
- The original harness process ended after seven completed rows. Those recordings and workspaces were retained; quality checks were rerun locally without model requests.
- Only the two incomplete Kilo fixtures were rerun, with identical fixture definitions, Kilo version, alias, and resolved backend model.
- Split execution can still be affected by provider latency and cache state; this is one repetition, not a general agent ranking.
