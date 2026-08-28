import assert from "node:assert/strict";
import test from "node:test";
import { computeIndexingServiceReadyTimeoutMs } from "./indexing-service-health.js";

test("installed service readiness covers sequential configured backend startup budgets", () => {
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      searchMode: "hybrid",
      qdrantStartupTimeoutMs: 120_000,
      embeddingStartupTimeoutMs: 600_000,
    }),
    780_000,
  );
});

test("BM25-only readiness excludes the unused embedding startup budget", () => {
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      searchMode: "bm25-only",
      qdrantStartupTimeoutMs: 120_000,
      embeddingStartupTimeoutMs: 600_000,
    }),
    180_000,
  );
});

test("installed service readiness uses safe defaults for absent or invalid budgets", () => {
  assert.equal(computeIndexingServiceReadyTimeoutMs({}), 660_000);
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      qdrantStartupTimeoutMs: -1,
      embeddingStartupTimeoutMs: "invalid",
    }),
    660_000,
  );
});
