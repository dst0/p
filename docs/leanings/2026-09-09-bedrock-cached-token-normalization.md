# 2026-09-09 — Bedrock cached-token normalization

- **Status:** Resolved
- **Task/context:** Amazon Bedrock usage reporting and cache token accounting (`packages/ai/src/providers/amazon-bedrock/request-building.ts`).
- **Unexpected observation or failure:** Bedrock Converse stream metadata reports raw `inputTokens` representing non-cached input tokens, while `totalTokens` in raw metadata omitted cached input tokens (`cacheReadInputTokens` and `cacheWriteInputTokens`). For example, with input=100, output=50, cacheRead=10, cacheWrite=20, Bedrock returned raw totalTokens=150 instead of normalized totalTokens=180.
- **Evidence:** In `packages/ai/test/amazon-bedrock-coverage.test.ts`, asserting `res.usage.totalTokens === 180` failed prior to remediation (`expected 150 to be 180`). Downstream, limited-budget task ledgers (`packages/coding-agent/test/run-budget-ledger.test.ts`) settle token spend against `res.usage.totalTokens`, which must consistently reflect all consumed tokens (`input + output + cacheRead + cacheWrite`).
- **Approaches tried:**
  - **Attempt:** Normalize `output.usage.totalTokens` in `handleMetadata` to sum `output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite`.
    - **Outcome:** Worked
    - **Why:** `output.usage.input` contains non-cached input tokens, so summing all four components yields the exact canonical total token consumption (180), matching the ledger and cost accounting conventions across providers.
- **Root cause:** Bedrock converse stream event usage metadata was assigned directly to `output.usage.totalTokens` with fallback to `input + output`, failing to account for `cacheReadInputTokens` and `cacheWriteInputTokens`.
- **Resolution:** Updated `handleMetadata` in `packages/ai/src/providers/amazon-bedrock/request-building.ts` to calculate `output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite`. Maintained Google Vertex provider official total token behavior (`prompt=150 (cached=50), candidates=30, thoughts=20, official total=200 -> input=100, cacheRead=50, output=50, total=200`).
- **Verification:** Ran focused tests `packages/ai/test/amazon-bedrock-coverage.test.ts`, `packages/ai/test/google-vertex-coverage.test.ts`, and `packages/coding-agent/test/run-budget-ledger.test.ts` (all passing), verified line count baseline, and passed Biome checks.
- **Prevention/follow-up:** Provider integration fixtures must verify both detailed usage breakdowns and aggregate `totalTokens` consistency against downstream budget ledger accounting.
- **Reusable learning:** When cloud model providers report raw token totals that exclude cached read/write tokens, normalize `totalTokens` at the provider adapter boundary so cost, budget, and telemetry layers receive unified invariants.
- **References:** `packages/ai/src/providers/amazon-bedrock/request-building.ts`, `packages/ai/test/amazon-bedrock-coverage.test.ts`, `packages/coding-agent/test/run-budget-ledger.test.ts`
