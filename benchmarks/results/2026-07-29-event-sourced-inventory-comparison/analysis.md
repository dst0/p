# PI vs P vs Kilo: final three-task comparison

## Executive summary

There is no universal winner:

- **Kilo wins the calculator task**: the only clean completion, 6/6 checks,
  and the fastest result.
- **PI wins the monolith refactor**: clean 6/6 completion with substantially
  lower time and tokens than P; Kilo produced a 6/6 workspace but timed out.
- **P wins the hard event-sourcing task on quality**: 5/6 checks versus 1/6
  for PI and Kilo, although no agent fully passed it.

Across all 18 quality gates, **P leads with 17/18**, Kilo has 13/18, and PI has
11/18. Every agent has only one strict completed pass out of three because
timeouts and failed final verification are counted independently from the
quality of the final workspace.

P is the best choice when final implementation quality matters most, but it is
also the slowest and most expensive. PI is the most token-efficient and best at
the focused refactor. Kilo is strongest on the bounded greenfield task and
occupies the middle ground in aggregate cost.

## Versions and model routes

- Date: 2026-07-29
- Fixed order: PI, P, Kilo
- PI: `0.82.1`
- P during benchmark: `0.4.110`
- Kilo: `7.4.16`

For calculator and monolith, PI/P used `mini-pc/model`, which resolved to
`mini-pc/sokann-qwen-27b-cache`. The repaired Kilo route used
`llm-orchestrator/sokann-qwen-27b`, backed by
`mini-pc/sokann-qwen-27b`. These use the same model weights, but cache and
runtime state were not identical.

For the event-sourcing task all three used the exact non-cache backend model
`mini-pc/sokann-qwen-27b`. PI/P selected it through an isolated custom model
configuration; Kilo used the repaired llm-orchestrator route.

## Complete result matrix

| Task | Agent | Process result | Quality | Wall time | Total tokens | Tool calls | Tool errors |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Calculator | PI | timed out | 4/6 | 300.0 s | 90,328 | 16 | 4 |
| Calculator | P | timed out | 6/6 | 300.0 s | 312,741 | 29 | 9 |
| Calculator | Kilo | **passed** | **6/6** | **248.6 s** | 243,255 | 18 | 0 |
| Monolith refactor | PI | **passed** | **6/6** | **394.3 s** | **144,267** | 25 | 2 |
| Monolith refactor | P | passed | 6/6 | 548.6 s | 517,519 | 38 | 7 |
| Monolith refactor | Kilo | timed out | 6/6 | 600.1 s | 501,065 | 34 | 0 |
| Event-sourced inventory | PI | failed | 1/6 | 608.5 s | 28,805 | 5 | 0 |
| Event-sourced inventory | P | failed | **5/6** | 1,640.3 s | 701,918 | 34 | 8 |
| Event-sourced inventory | Kilo | failed | 1/6 | 688.8 s | 84,216 | 6 | 0 |

Process result and quality are deliberately separate. For example, P's
calculator and Kilo's refactor left workspaces passing all quality checks but
did not exit before their timeouts.

## Aggregate comparison

| Agent | Strict completed passes | Full-quality tasks | Quality gates | Total wall time | Total tokens | Tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PI | 1/3 | 1/3 | 11/18 | 1,302.9 s | **263,400** | 46 | 6 |
| P | 1/3 | **2/3** | **17/18** | 2,488.9 s | 1,532,178 | 101 | 24 |
| Kilo | 1/3 | **2/3** | 13/18 | 1,537.4 s | 828,536 | 58 | **0** |

The totals are descriptive rather than a statistically stable ranking: this
is one run per task, and the first two tasks used different cache routes.

## Task-by-task interpretation

### Calculator

Kilo is the clear winner. It completed in 248.6 seconds with 6/6 checks and no
tool errors. P reached the same workspace quality but was still running at 300
seconds. PI timed out with only 4/6 checks.

### Monolith refactor

PI is the clear winner. It completed 6/6 in 394.3 seconds and 144,267 tokens.
P also completed 6/6, but took 39% longer and used 3.6 times as many tokens.
Kilo achieved 6/6 with no tool errors but did not exit before 600 seconds.

### Event-sourced inventory

No agent passed. P was decisively best on implementation quality: it created
the required modules and its own tests, and both visible tests and typecheck
passed. It failed only the combined hidden transactional, replay, and
tamper-detection gate.

PI and Kilo did not create a substantive implementation. P used approximately
24 times PI's tokens and eight times Kilo's tokens on this task. P and Kilo
both temporarily renamed `package.json` to `pkg.json`; P recovered, while Kilo
did not. P also created a `package-lock.json` despite the instruction not to
install dependencies.

## Overall recommendation

- Choose **P** when the primary goal is maximum probability of a high-quality
  result on difficult coding work and higher latency/cost is acceptable.
- Choose **PI** for focused refactors when efficiency is important and the
  task shape is well bounded.
- Choose **Kilo** for bounded greenfield implementation when clean tool
  execution matters; it had zero tool errors across these final runs, but its
  completion behavior on longer tasks needs improvement.

The main weakness shared by all three is lifecycle discipline: each achieved
only one clean completed pass. P and Kilo each produced two full-quality
workspaces, but only one clean completion; PI's sole full-quality workspace was
also its sole clean completion.

## Harness and Kilo findings

Kilo originally stalled before useful agent events because its direct LAN
provider path was unusable from the bundled runtime. The working configuration
uses an explicit OpenAI-compatible provider, restricted enabled providers, and
a persistent localhost TCP forwarder to llm-orchestrator. After the repair,
Kilo completed the calculator and produced a passing refactor workspace.

The hard PI/P runs exposed a second infrastructure issue: cumulative JSON
streaming events exceeded Node's maximum string length when the harness
concatenated stdout. Recordings now stream directly into gzip files while only
metric-relevant terminal events remain in memory.

PI produced 16,769 raw hard-task events and a 208 MB gzip recording. P produced
49,268 raw events and a 320 MB recording. Raw recordings, stderr, and final
workspaces remain in the corresponding local result directories. The two large
PI/P recordings are intentionally not committed.

## Evidence

- Calculator and refactor PI/P baseline:
  [`../2026-07-29-pi-p-kilo-sokann-qwen-27b-restart/results.json`](../2026-07-29-pi-p-kilo-sokann-qwen-27b-restart/results.json)
- Repaired Kilo calculator:
  [`../2026-07-29-kilo-fixed-calculator/results.json`](../2026-07-29-kilo-fixed-calculator/results.json)
- Repaired Kilo refactor:
  [`../2026-07-29-kilo-fixed-monolith/results.json`](../2026-07-29-kilo-fixed-monolith/results.json)
- PI event-sourcing task:
  [`../2026-07-29-pi-event-sourced-inventory-exact-v2/results.json`](../2026-07-29-pi-event-sourced-inventory-exact-v2/results.json)
- P event-sourcing task:
  [`../2026-07-29-p-event-sourced-inventory-exact/results.json`](../2026-07-29-p-event-sourced-inventory-exact/results.json)
- Kilo event-sourcing task:
  [`../2026-07-29-kilo-event-sourced-inventory-exact/results.json`](../2026-07-29-kilo-event-sourced-inventory-exact/results.json)
