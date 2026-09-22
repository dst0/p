import assert from "node:assert/strict";
import { test } from "node:test";
import { type BenchmarkRowLike, evaluateCertification } from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const certifiedOptions = parseRunnerArgs([
  "--certified",
  "--model",
  "provider/test-model",
  "--expected-resolved-model",
  "resolved/test-model",
  "--runs",
  "3",
  "--max-duration-ratio",
  "1.0",
  "--max-token-ratio",
  "1.0",
  "--max-cost-ratio",
  "1.0",
]);

test("complete synthetic 3x4x3 matrix certifies successfully", () => {
  const rows = createSyntheticCertifiedMatrix({ responseModel: "resolved/test-model" });
  assert.equal(rows.length, 36);
  const outcome = evaluateCertification(rows, certifiedOptions);
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.failures, []);
});

test("certification rejects the former public task maximum without its sealed holdout weight", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality = { ...row.quality!, passed: true, score: 6, rawScore: 6, maxScore: 6 };
      }
      return row;
    },
  });
  const outcome = evaluateCertification(rows, certifiedOptions);
  assert.equal(outcome.passed, false);
  assert.match(outcome.failures.join("\n"), /row\[0\]\.quality\.maxScore/u);
});

test("single row per agent must never certify", () => {
  const singleRowPerAgent = [
    createSyntheticCertifiedMatrix({ runs: 1, agents: ["p"] })[0]!,
    createSyntheticCertifiedMatrix({ runs: 1, agents: ["pi"] })[0]!,
    createSyntheticCertifiedMatrix({ runs: 1, agents: ["kilo"] })[0]!,
  ];
  assert.equal(singleRowPerAgent.length, 3);
  const outcome = evaluateCertification(singleRowPerAgent, certifiedOptions);
  assert.equal(outcome.passed, false);
  assert.match(outcome.failures.join("\n"), /Missing cell: run/u);
});

test("missing, duplicate, or unexpected cells fail closed", () => {
  const complete = createSyntheticCertifiedMatrix({ responseModel: "resolved/test-model" });
  const missingOne = complete.slice(0, 35);
  const missingOutcome = evaluateCertification(missingOne, certifiedOptions);
  assert.equal(missingOutcome.passed, false);
  assert.match(missingOutcome.failures.join("\n"), /Missing cell: run 3 kilo\/durable-workflow-saga/u);

  const duplicateOne = [...complete, { ...complete[0]! }];
  const duplicateOutcome = evaluateCertification(duplicateOne, certifiedOptions);
  assert.equal(duplicateOutcome.passed, false);
  assert.match(duplicateOutcome.failures.join("\n"), /Duplicate cell: run 1 p\/typescript-calculator/u);

  const unexpectedCell = [...complete, { ...complete[0]!, agent: "codex" }];
  const unexpectedOutcome = evaluateCertification(unexpectedCell, certifiedOptions);
  assert.equal(unexpectedOutcome.passed, false);
  assert.match(unexpectedOutcome.failures.join("\n"), /Unexpected cell: run 1 codex\/typescript-calculator/u);
});

test("missing quality, responseModel, duration, tokens, or cost evidence fails closed", () => {
  const checkFailure = (modifier: (row: BenchmarkRowLike) => void, expectedPattern: RegExp) => {
    let modified = false;
    const rows = createSyntheticCertifiedMatrix({
      responseModel: "resolved/test-model",
      modifyCell: (row) => {
        if (!modified && row.run === 2 && row.agent === "kilo" && row.task === "monolith-split") {
          modifier(row);
          modified = true;
        }
        return row;
      },
    });
    const outcome = evaluateCertification(rows, certifiedOptions);
    assert.equal(outcome.passed, false);
    assert.match(outcome.failures.join("\n"), expectedPattern);
  };

  checkFailure((r) => {
    r.quality = undefined;
  }, /missing quality runtime evidence/u);
  checkFailure((r) => {
    if (r.metrics) r.metrics.responseModel = "";
  }, /missing responseModel runtime evidence/u);
  checkFailure((r) => {
    if (r.metrics) r.metrics.responseModel = "other-model";
  }, /responseModel mismatch/u);
  checkFailure((r) => {
    r.elapsedMs = 0;
  }, /missing duration runtime evidence/u);
  checkFailure((r) => {
    if (r.metrics) r.metrics.usage.totalTokens = -5;
  }, /missing token count runtime evidence/u);
  checkFailure((r) => {
    if (r.metrics) r.metrics.usage.cost = undefined;
  }, /missing monetary cost runtime evidence/u);
});

test("never substitute totalTokens as cost; missing cost fails closed", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.agent === "pi") {
        row.metrics!.usage.cost = undefined;
      }
      return row;
    },
  });
  const outcome = evaluateCertification(rows, certifiedOptions);
  assert.equal(outcome.passed, false);
  assert.match(outcome.failures.join("\n"), /missing monetary cost runtime evidence for run .* pi\//u);
});

test("P must have maximum rubric score and zero penalties across all required cells", () => {
  const lessScoreRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality!.score = row.quality!.maxScore - 1;
      }
      return row;
    },
  });
  const scoreOutcome = evaluateCertification(lessScoreRows, certifiedOptions);
  assert.equal(scoreOutcome.passed, false);
  assert.match(scoreOutcome.failures.join("\n"), /P failed to achieve maximum rubric score/u);

  const excessScoreRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality!.score = row.quality!.maxScore + 10;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(excessScoreRows, certifiedOptions).passed, false);

  const passedFalseRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality!.passed = false;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(passedFalseRows, certifiedOptions).passed, false);

  const nonFiniteQualityRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality!.maxScore = Number.NaN;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(nonFiniteQualityRows, certifiedOptions).passed, false);

  const penaltyRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 2 && row.agent === "p" && row.task === "event-sourced-inventory") {
        row.quality!.penalty = 10;
        row.nudges = 1;
      }
      return row;
    },
  });
  const penaltyOutcome = evaluateCertification(penaltyRows, certifiedOptions);
  assert.equal(penaltyOutcome.passed, false);
  assert.match(penaltyOutcome.failures.join("\n"), /P incurred zero penalties gate failure/u);

  const nanPenaltyRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 2 && row.agent === "p" && row.task === "event-sourced-inventory") {
        row.quality!.penalty = Number.NaN;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(nanPenaltyRows, certifiedOptions).passed, false);

  const nanMetricRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p") {
        row.metrics!.usage.totalTokens = Number.POSITIVE_INFINITY;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(nanMetricRows, certifiedOptions).passed, false);

  const nanCostRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p") {
        row.metrics!.usage.cost = Number.POSITIVE_INFINITY;
      }
      return row;
    },
  });
  assert.equal(evaluateCertification(nanCostRows, certifiedOptions).passed, false);
});

test("duration, token, and cost threshold failures against either Pi or Kilo reject certification", () => {
  const durationFailPi = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    pDurationMs: 1200,
    baselineDurationMs: 1000,
  });
  assert.equal(evaluateCertification(durationFailPi, certifiedOptions).passed, false);
  assert.match(
    evaluateCertification(durationFailPi, certifiedOptions).failures.join("\n"),
    /P exceeded duration paired threshold versus pi/u,
  );

  const tokenFailKilo = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    pTokens: 250,
    baselineTokens: 200,
  });
  assert.equal(evaluateCertification(tokenFailKilo, certifiedOptions).passed, false);
  assert.match(
    evaluateCertification(tokenFailKilo, certifiedOptions).failures.join("\n"),
    /P exceeded token paired threshold versus kilo/u,
  );

  const costFailPi = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    pCost: 0.06,
    baselineCost: 0.05,
  });
  assert.equal(evaluateCertification(costFailPi, certifiedOptions).passed, false);
  assert.match(
    evaluateCertification(costFailPi, certifiedOptions).failures.join("\n"),
    /P exceeded cost paired threshold versus pi/u,
  );
});

test("instruction parity fails closed on missing, mismatched, or failed receipts", () => {
  const complete = createSyntheticCertifiedMatrix({ responseModel: "resolved/test-model" });
  const mockBinding = {
    node: { path: "/node", version: "22.0.0", sha256: "a".repeat(64) },
    pSnapshot: { path: "/p", version: "0.4.0", sha256: "b".repeat(64) },
    pi: { path: "/pi", version: "0.82.1", sha256: "c".repeat(64) },
    kilo: { path: "/kilo", version: "7.4.17", sha256: "d".repeat(64) },
    modelConfiguration: { sha256: "e".repeat(64) },
    projectInstructions: { path: "/AGENTS.md", sha256: "e".repeat(64), receiptSha256: "f".repeat(64) },
  };
  const missingOutcome = evaluateCertification(complete, certifiedOptions, mockBinding);
  assert.equal(missingOutcome.passed, false);
  assert.match(missingOutcome.failures.join("\n"), /Missing certified instruction parity receipt for agent/u);

  const passedReceipts = (["p", "pi", "kilo"] as const).map((agent) => ({
    agent,
    status: "passed" as const,
    receiptSha256: "f".repeat(64),
    responseMatched: true,
    responseModel: "resolved/test-model",
    responseModels: ["resolved/test-model"],
    elapsedMs: 50,
  }));
  const passedOutcome = evaluateCertification(complete, certifiedOptions, { ...mockBinding, receipts: passedReceipts });
  assert.equal(passedOutcome.passed, true);
  assert.deepEqual(passedOutcome.failures, []);

  const mismatchedReceipts = [
    passedReceipts[0]!,
    passedReceipts[1]!,
    { ...passedReceipts[2]!, receiptSha256: "0".repeat(64) },
  ];
  const mismatchedOutcome = evaluateCertification(complete, certifiedOptions, {
    ...mockBinding,
    receipts: mismatchedReceipts,
  });
  assert.equal(mismatchedOutcome.passed, false);
  assert.match(mismatchedOutcome.failures.join("\n"), /Instruction parity receipt mismatch for agent: kilo/u);
});
