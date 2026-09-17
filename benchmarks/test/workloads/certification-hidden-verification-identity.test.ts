import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkOutputPath } from "../../src/workloads/benchmark-output.ts";
import { runHiddenVerification } from "../../src/workloads/hidden-verification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("hidden verification rejects a replaced test directory without external writes", () => {
  const parent = mkdtempSync(join(tmpdir(), "hidden-verification-identity-"));
  const external = mkdtempSync(join(tmpdir(), "hidden-verification-external-"));
  const output = join(parent, "output");
  const workspace = join(output, "workspaces", "p", "run-1", "task");
  const movedTest = join(workspace, "moved-test");
  const externalFile = join(external, "hidden.test.ts");
  try {
    createBenchmarkOutputPath(
      parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--output",
        output,
      ]),
    );
    mkdirSync(join(workspace, "test"), { recursive: true });
    writeFileSync(externalFile, "external remains unchanged\n");
    renameSync(join(workspace, "test"), movedTest);
    symlinkSync(external, join(workspace, "test"), "dir");

    assert.throws(
      () => runHiddenVerification(workspace, "hidden.test.ts", "secret evaluator bytes\n", "holdout", []),
      /unsafe directory|identity/u,
    );
    assert.equal(readFileSync(externalFile, "utf8"), "external remains unchanged\n");
    assert.equal(existsSync(join(external, "package.json")), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
