import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCertification } from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const options = parseRunnerArgs([
  "--certified",
  "--model",
  "provider/model",
  "--expected-resolved-model",
  "resolved/model",
  "--runs",
  "3",
  "--max-duration-ratio",
  "1",
  "--max-token-ratio",
  "1",
  "--max-cost-ratio",
  "1",
]);

test("paired efficiency rejects a slow, token-heavy, costly task that global averages conceal", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/model",
    modifyCell: (row) => {
      if (row.agent !== "p") return row;
      const slowTask = row.task === "typescript-calculator";
      row.elapsedMs = slowTask ? 1500 : 500;
      row.metrics!.usage.totalTokens = slowTask ? 300 : 100;
      row.metrics!.usage.cost = { total: slowTask ? 0.075 : 0.025 };
      return row;
    },
  });

  const outcome = evaluateCertification(rows, options);
  assert.equal(outcome.passed, false, outcome.failures.join("\n"));
  for (const agent of ["pi", "kilo"]) {
    for (const metric of ["duration", "token", "cost"]) {
      assert.match(
        outcome.failures.join("\n"),
        new RegExp(`P exceeded ${metric} paired threshold versus ${agent} for task typescript-calculator`, "u"),
      );
    }
  }
});

test("paired efficiency rejects zero monetary-cost evidence instead of treating it as comparable", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "pi" && row.task === "typescript-calculator") {
        row.metrics!.usage.cost = { total: 0 };
      }
      return row;
    },
  });

  const outcome = evaluateCertification(rows, options);
  assert.equal(outcome.passed, false, outcome.failures.join("\n"));
  assert.match(
    outcome.failures.join("\n"),
    /Invalid paired cost values versus pi for task typescript-calculator run 1: p=0\.040 pi=missing/u,
  );
});

test("certification rejects a per-task quality tie instead of claiming P beat both baselines", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/model",
    pDurationMs: 1000,
    baselineDurationMs: 1000,
    pTokens: 200,
    baselineTokens: 200,
    pCost: 0.05,
    baselineCost: 0.05,
    baselineScoreDelta: 0,
  });

  const outcome = evaluateCertification(rows, options);
  assert.equal(outcome.passed, false, outcome.failures.join("\n"));
  for (const agent of ["pi", "kilo"]) {
    for (const task of [
      "typescript-calculator",
      "monolith-split",
      "event-sourced-inventory",
      "durable-workflow-saga",
    ]) {
      assert.match(
        outcome.failures.join("\n"),
        new RegExp(`P did not strictly exceed ${agent} quality for task ${task}`, "u"),
      );
    }
  }
});
