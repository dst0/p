import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBenchmarkCandidateOutputPath,
  parseBenchmarkCandidateVersion,
  resolveBenchmarkCandidateOutput,
} from "../../src/harness/candidate-version.ts";

test("benchmark candidate version is required on the authorized prerelease line", () => {
  assert.throws(() => parseBenchmarkCandidateVersion(undefined), /required/u);
  assert.equal(parseBenchmarkCandidateVersion("5.0.1-rc.1"), "5.0.1-rc.1");
  assert.equal(parseBenchmarkCandidateVersion("5.0.1-rc.27"), "5.0.1-rc.27");
  for (const invalid of ["", "5.0.1", "5.0.1-rc.0", "5.0.2-rc.1", "5.0.1-rc.next"]) {
    assert.throws(() => parseBenchmarkCandidateVersion(invalid), /5\.0\.1-rc/u);
  }
});

test("benchmark output paths contain the exact candidate identity", () => {
  assert.equal(
    resolveBenchmarkCandidateOutput("/repo", undefined, "5.0.1-rc.12", "2026-08-24T00-00-00-000Z"),
    "/repo/benchmarks/results/2026-08-24T00-00-00-000Z-v5.0.1-rc.12-project-instructions",
  );
  assert.equal(
    resolveBenchmarkCandidateOutput("/repo", "/results/v5.0.1-rc.12/run", "5.0.1-rc.12", "unused"),
    "/results/v5.0.1-rc.12/run",
  );
  assert.doesNotThrow(() => assertBenchmarkCandidateOutputPath("/results/run-v5.0.1-rc.12-final", "5.0.1-rc.12"));
  assert.throws(
    () => assertBenchmarkCandidateOutputPath("/results/run-v5.0.1-rc.120-final", "5.0.1-rc.12"),
    /exact candidate/u,
  );
  assert.throws(() => assertBenchmarkCandidateOutputPath("/results/run", "5.0.1-rc.12"), /exact candidate/u);
});
