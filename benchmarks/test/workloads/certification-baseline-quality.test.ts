import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCertification } from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const options = parseRunnerArgs([
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
]);

test("baseline Pi and Kilo clean task completion with partial hidden quality remains valid comparison", () => {
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.agent !== "p") {
        row.quality = {
          passed: false,
          score: Math.floor(row.quality!.maxScore / 2),
          maxScore: row.quality!.maxScore,
          penalty: 0,
          rawScore: Math.floor(row.quality!.maxScore / 2),
        };
        row.status = "failed";
      }
      return row;
    },
  });
  const outcome = evaluateCertification(rows, options);
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.failures, []);
});

test("P with partial hidden quality or penalties fails certification gate", () => {
  const partialPRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.quality = {
          passed: false,
          score: row.quality!.maxScore - 1,
          maxScore: row.quality!.maxScore,
          penalty: 0,
          rawScore: row.quality!.maxScore - 1,
        };
        row.status = "failed";
      }
      return row;
    },
  });
  const partialOutcome = evaluateCertification(partialPRows, options);
  assert.equal(partialOutcome.passed, false);
  assert.match(partialOutcome.failures.join("\n"), /P failed to achieve maximum rubric score/u);

  const penaltyPRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "p" && row.task === "typescript-calculator") {
        row.nudges = 1;
        row.quality!.penalty = 15;
      }
      return row;
    },
  });
  const penaltyOutcome = evaluateCertification(penaltyPRows, options);
  assert.equal(penaltyOutcome.passed, false);
  assert.match(penaltyOutcome.failures.join("\n"), /P incurred zero penalties gate failure/u);
});

test("baseline Pi with incomplete process fails closed", () => {
  const incompletePiRows = createSyntheticCertifiedMatrix({
    responseModel: "resolved/test-model",
    modifyCell: (row) => {
      if (row.run === 1 && row.agent === "pi" && row.task === "typescript-calculator") {
        row.exitCode = 1;
        row.status = "failed";
      }
      return row;
    },
  });
  const outcome = evaluateCertification(incompletePiRows, options);
  assert.equal(outcome.passed, false);
  assert.match(outcome.failures.join("\n"), /Incomplete cell: run 1 pi\/typescript-calculator/u);
});
