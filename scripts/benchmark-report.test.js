import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkReport, formatCacheHitPercentage } from "./benchmark-report.js";

function completedResult(usage) {
  return {
    run: 1,
    agent: "p",
    task: "fixture",
    status: "passed",
    elapsedMs: 1200,
    nudges: 0,
    metrics: { usage, toolCalls: 2, toolErrors: 0 },
    quality: { passed: true, score: 3, maxScore: 3, checks: [{ passed: true }] },
  };
}

test("cache hit percentage includes cache writes in total prompt tokens", () => {
  assert.equal(formatCacheHitPercentage({ input: 40, cacheRead: 40, cacheWrite: 20 }), "40.0%");
  assert.equal(formatCacheHitPercentage({ input: 0, cacheRead: 0, cacheWrite: 0 }), "0.0%");
});

test("benchmark report renders cache telemetry and skipped rows safely", () => {
  const output = mkdtempSync(join(tmpdir(), "benchmark-report-test-"));
  try {
    const summaries = createBenchmarkReport(
      { agents: ["p"], model: "provider/model", runs: 1 },
      { p: "1.0.0" },
      [
        completedResult({ input: 40, cacheRead: 40, cacheWrite: 20, output: 5, totalTokens: 105 }),
        { run: 1, agent: "p", task: "later-fixture", status: "skipped" },
      ],
      output,
      [{ id: "fixture" }],
    );
    const report = readFileSync(join(output, "report.md"), "utf8");
    assert.match(report, /Avg cached tokens \| Cache hit %/u);
    assert.match(report, /\| p \| 1\/1 \| 1\/1 \| 3\/3 .* \| 40 \| 40 \| 40\.0% \| 5 \| 105 \|/u);
    assert.match(report, /\| 1 \| p \| later-fixture \| skipped \| — \| — \| — \| — \|/u);
    assert.equal(summaries.winner, "p");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("benchmark report records the Codex model independently from PI and P", () => {
  const output = mkdtempSync(join(tmpdir(), "benchmark-report-test-"));
  try {
    createBenchmarkReport(
      { agents: ["codex"], model: "shared/pi-p", codexModel: "openai/gpt-codex", runs: 1 },
      { codex: "1.0.0" },
      [],
      output,
      [{ id: "fixture" }],
    );
    const report = readFileSync(join(output, "report.md"), "utf8");
    assert.match(report, /Codex model alias: `openai\/gpt-codex`/u);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
