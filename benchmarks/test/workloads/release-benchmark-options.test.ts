import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const certifiedArguments = [
  "--certified",
  "--model",
  "provider/model",
  "--expected-resolved-model",
  "resolved/model",
  "--runs",
  "3",
] as const;

test("release certification target is explicit and limited to a three-run certified matrix", () => {
  const options = parseRunnerArgs([...certifiedArguments, "--release-target", "5.0.1"]);
  assert.equal(options.releaseTarget, "5.0.1");

  assert.throws(
    () =>
      parseRunnerArgs([
        "--certified",
        "--model",
        "provider/model",
        "--expected-resolved-model",
        "resolved/model",
        "--runs",
        "4",
        "--release-target",
        "5.0.1",
      ]),
    /Release certification requires exactly 3 runs/u,
  );
});

test("release certification target is rejected outside certified mode", () => {
  assert.throws(
    () => parseRunnerArgs(["--model", "provider/model", "--release-target", "5.0.1"]),
    /--release-target requires --certified/u,
  );
});

test("release certification target must be a canonical semantic version", () => {
  for (const version of ["v5.0.1", "5.0", "5.0.1-beta.1", "05.0.1"]) {
    assert.throws(
      () => parseRunnerArgs([...certifiedArguments, "--release-target", version]),
      /--release-target must be a canonical semantic version/u,
    );
  }
});
