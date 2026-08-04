# P v0.4.120 and AGY extreme-workflow results

## P: all four fixtures

| Fixture | Status | Time | Tokens | Tool calls | Checks | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript calculator | passed | 281.1 s | 277,174 | 23 | 6/6 | 6/6 |
| Monolith split | passed | 719.2 s | 846,511 | 46 | 6/6 | 6/6 |
| Event-sourced inventory | failed | 1,157.6 s | 1,031,145 | 33 | 29/30 | 95/100 |
| Durable workflow saga | failed | 2,075.4 s | 1,365,913 | 35 | 24/31 | 107/152 |

The inventory implementation passed its 68 visible tests and typecheck. Its only failed weighted check was final-byte truncation rejection.

The extreme workflow implementation failed visible tests, typecheck, monotonic virtual-time enforcement, reverse compensation order, deep output isolation, exact hash/manifest semantics, and truncation/extra-data rejection.

## Extreme workflow: P versus AGY

| Agent | Model | Status | Time | Tokens | Tool calls | Tool errors | Checks | Score |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| P 0.4.120 | `mini-pc/sokann-qwen-27b-cache` | failed | 2,075.4 s | 1,365,913 | 35 | 4 | 24/31 | 107/152 |
| AGY 1.1.10 | `gemini-3.6-flash-medium` | failed | 213.0 s | 290,521 | 31 | 1 | 29/31 | 142/152 |

AGY failed only deep output isolation and the exact event hash/manifest contract. Neither agent completed the intentionally extreme fixture.
