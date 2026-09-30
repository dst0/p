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
]);

test("every scored cell requires matching independent wire-model evidence", () => {
  const missing = createSyntheticCertifiedMatrix();
  missing[0]!.proxyEvidence = undefined;
  const missingOutcome = evaluateCertification(missing, options);
  assert.equal(missingOutcome.passed, false);
  assert.match(
    missingOutcome.failures.join("\n"),
    /missing certified proxy evidence for run 1 p\/typescript-calculator/u,
  );

  const mismatched = createSyntheticCertifiedMatrix();
  mismatched[0]!.proxyEvidence!.responseModels = ["different/backend"];
  const mismatchedOutcome = evaluateCertification(mismatched, options);
  assert.equal(mismatchedOutcome.passed, false);
  assert.match(
    mismatchedOutcome.failures.join("\n"),
    /proxy response model mismatch for run 1 p\/typescript-calculator/u,
  );

  const wrongRequest = createSyntheticCertifiedMatrix();
  wrongRequest[0]!.proxyEvidence!.requestModels = ["different/backend"];
  assert.match(
    evaluateCertification(wrongRequest, options).failures.join("\n"),
    /proxy request model mismatch for run 1 p\/typescript-calculator/u,
  );

  const missingHash = createSyntheticCertifiedMatrix();
  missingHash[0]!.proxyEvidence!.requestHashes = [];
  assert.match(
    evaluateCertification(missingHash, options).failures.join("\n"),
    /invalid proxy request hash evidence for run 1 p\/typescript-calculator/u,
  );
});
