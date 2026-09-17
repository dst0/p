import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BenchmarkMutableArtifactsUnsafeError,
  finalizeAgentBenchmarkRun,
} from "../../src/workloads/benchmark-run-finalization.ts";

test("unsafe mutable-artifact errors preserve the original termination cause", () => {
  const cause = new Error("termination rejection");
  const error = new BenchmarkMutableArtifactsUnsafeError("unconfirmed termination", cause);
  assert.equal(error.cause, cause);
});

test("run finalization attempts every safe cleanup and preserves primary plus all failures", () => {
  const primary = new Error("primary failure");
  const calls: string[] = [];
  assert.throws(
    () =>
      finalizeAgentBenchmarkRun({
        primaryError: primary,
        mutableArtifactsSafe: true,
        finalizeAgentResources: () => {
          calls.push("agent/auth");
          throw new AggregateError([new Error("auth"), new Error("agent-dir")]);
        },
        sanitizeReceipt: () => {
          calls.push("receipt");
          throw new Error("receipt");
        },
        disposeFreeze: () => {
          calls.push("freeze");
          throw new AggregateError([new Error("evaluator"), new Error("candidate")]);
        },
      }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === primary &&
      error.errors.map(String).join("\n").includes("auth") &&
      error.errors.map(String).join("\n").includes("agent-dir") &&
      error.errors.map(String).join("\n").includes("receipt") &&
      error.errors.map(String).join("\n").includes("evaluator") &&
      error.errors.map(String).join("\n").includes("candidate"),
  );
  assert.deepEqual(calls, ["agent/auth", "receipt", "freeze"]);
});

test("confirmed-exit proof and recording failures still sanitize auth, receipts, and frozen state", () => {
  const primary = new Error("recording finalization failed after confirmed child exit");
  const calls: string[] = [];
  assert.doesNotThrow(() =>
    finalizeAgentBenchmarkRun({
      primaryError: primary,
      mutableArtifactsSafe: true,
      finalizeAgentResources: () => calls.push("agent/auth"),
      sanitizeReceipt: () => calls.push("receipt"),
      disposeFreeze: () => calls.push("freeze"),
    }),
  );
  assert.deepEqual(calls, ["agent/auth", "receipt", "freeze"]);
});

test("unconfirmed termination never traverses a workspace swapped to an external symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "unsafe-finalization-root-"));
  const external = mkdtempSync(join(tmpdir(), "unsafe-finalization-external-"));
  const mutable = join(root, "workspaces", "agent");
  const externalFile = join(external, "protected.txt");
  const calls: string[] = [];
  try {
    mkdirSync(mutable, { recursive: true });
    writeFileSync(join(mutable, "agent-owned.txt"), "mutable");
    writeFileSync(externalFile, "untouched");
    rmSync(mutable, { recursive: true });
    symlinkSync(external, mutable);
    assert.throws(
      () =>
        finalizeAgentBenchmarkRun({
          primaryError: new Error("benchmark process tree did not terminate"),
          mutableArtifactsSafe: false,
          finalizeAgentResources: () => {
            calls.push("agent/auth");
            writeFileSync(join(mutable, "protected.txt"), "changed");
          },
          sanitizeReceipt: (mutableArtifactsSafe = true) => {
            calls.push(`receipt:${mutableArtifactsSafe}`);
            if (mutableArtifactsSafe) writeFileSync(join(mutable, "protected.txt"), "changed");
          },
          disposeFreeze: () => calls.push("freeze"),
        }),
      (error) =>
        error instanceof AggregateError &&
        error.errors.some((nested) => /mutable artifact cleanup skipped/iu.test(String(nested))),
    );
    assert.deepEqual(calls, ["receipt:false", "freeze"]);
    assert.equal(readFileSync(externalFile, "utf8"), "untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
