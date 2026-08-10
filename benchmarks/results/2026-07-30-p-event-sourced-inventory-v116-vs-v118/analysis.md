# v116 vs v118: Event-Sourced Inventory Comparison

## Summary
System prompt changes between v116 and v118 produced a **+32 point quality improvement** (64 → 96/100).

## Configuration
- **v116**: `benchmark-mini-pc` provider, port 11450, 1800s timeout
- **v118**: `mini-pc` provider, port 11435, 1800s timeout
- Both use `sokann-qwen-27b` model

## Results

| Metric | v116 | v118 | Δ |
|--------|------|------|---|
| **Quality Score** | 64/100 | 96/100 | **+32** |
| Turns | 25 | 36 | +11 |
| Tool Calls | 27 | 40 | +13 |
| Runtime | 1800s (timed out) | 1464s (completed) | -336s |
| Input Tokens | 55,844 | 58,488 | +2,644 |
| Output Tokens | 41,033 | 36,026 | -5,007 |
| Total Tokens | 685,745 | 1,169,646 | +483,901 |
| Test Results | 66 pass, 15 fail | 85 pass, 1 fail | +19 pass, -14 fail |
| Typecheck | ❌ failed | ✅ passed | Fixed |
| Failed Quality Checks | 8/30 | 1/30 | -7 |

## v116 Failed Checks (8)
1. **visible npm test passes** (8) — 15 tests failed
2. **npm run typecheck passes** (6) — type errors
3. **changed retry with same command ID** (3) — idempotency collision
4. **cross-command command ID reuse** (3) — idempotency
5. **failed batch does not consume command IDs** (4) — batch rollback
6. **successful batch commits ordered cross-SKU effects** (3) — batch ordering
7. **final-byte truncation is rejected** (5) — tamper detection
8. **stale batch consumes no IDs or positions** (4) — batch rollback

## v118 Failed Checks (1)
1. **failed batch does not consume command IDs** (4) — same issue as v116

## Root Cause of Improvement
The v116 system prompt included a speculative batching rule that instructed the agent to "speculatively prepare 2x the task count as commands" and run commands in parallel. This caused the agent to:
- Attempt to batch 6 commands when only 3 could execute
- Trigger verification guards on speculative failures
- Waste turns on retry loops after guard hits
- Time out before completing the task

The v118 system prompt removed speculative batching and verification guard constraints, allowing the agent to:
- Run commands at a natural pace
- Complete all implementation work within time limit
- Write comprehensive tests (86 vs 81)
- Pass typecheck on first attempt
- Fix all idempotency and batch issues

## Remaining Issue
The **failed batch does not consume command IDs** check fails in both versions. This is a model capability limitation — the agent does not correctly implement command ID rollback in failed batches. This requires either:
1. More explicit system prompt guidance on batch transactionality
2. Model instruction-following improvement on this specific pattern
