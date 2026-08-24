import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import {
  BenchmarkInterruptedError,
  createBenchmarkSignalController,
} from "./benchmark-interruption.js";
import { runPairedBenchmarkCell } from "./benchmark-project-instructions-cell.js";

test("signal controller maps both supported signals and removes every listener", () => {
  for (const [signalName, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const target = new EventEmitter();
    const controller = createBenchmarkSignalController(target);
    target.emit(signalName);
    assert.equal(controller.signal.reason.signalName, signalName);
    assert.equal(target.exitCode, exitCode);
    controller.dispose();
    assert.equal(target.listenerCount("SIGINT"), 0);
    assert.equal(target.listenerCount("SIGTERM"), 0);
  }
});

test("interrupted cell publishes sanitized Q6 progress and discards private scratch", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cell-interrupt-"));
  const output = join(root, "output");
  const scratchOutput = join(root, "scratch");
  const cellOutput = join(root, "cell");
  const progressPath = join(output, "progress", "cell.jsonl");
  const interruption = new BenchmarkInterruptedError("SIGTERM");
  const controller = new AbortController();
  let error;
  mkdirSync(scratchOutput, { recursive: true });
  writeFileSync(join(scratchOutput, "private-sentinel"), "must not survive");
  try {
    await runPairedBenchmarkCell(
      {
        options: { privateSnapshots: {}, authFiles: [], sourceSha256: "a".repeat(64) },
        pair: { run: 1, task: "event-sourced-inventory" },
        mode: "legacy",
        cellOutput,
        scratchOutput,
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "b".repeat(64),
        progressPath,
        output,
        signal: controller.signal,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "b".repeat(64),
        buildArgs: () => [],
        resolveRunner: () => "/unused/runner.js",
        buildEnvironment: () => process.env,
        createProofReceipt: () => ({ sha256: "c".repeat(64) }),
        runChild: async (_executable, _args, _options, _capture, control) => {
          assert.equal(control.signal, controller.signal);
          assert.equal(statSync(progressPath).mode & 0o777, 0o600);
          controller.abort(interruption);
          return { status: null, signal: "SIGTERM", interruption };
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  try {
    assert.equal(error, interruption);
    assert.equal(error.pairedBenchmarkLiveness.semanticEvidenceComplete, false);
    assert.equal(existsSync(progressPath), false);
    assert.equal(statSync(`${progressPath}.br`).mode & 0o777, 0o600);
    const records = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records.at(-1).event, "interrupted");
    assert.equal(records.at(-1).outcome, "interrupted");
    assert.doesNotMatch(JSON.stringify(records), /args|Authorization|private payload|\/unused\/runner/u);
    assert.equal(existsSync(scratchOutput), false);
    assert.equal(existsSync(cellOutput), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cell finalization failures remain secondary to interruption", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cell-cleanup-interrupt-"));
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const progressError = new Error("progress finalization failed");
  const disposalError = new Error("cell disposal failed");
  const controller = new AbortController();
  let error;
  try {
    await runPairedBenchmarkCell(
      {
        options: { privateSnapshots: {}, authFiles: [], sourceSha256: "a".repeat(64) },
        pair: { run: 1, task: "event-sourced-inventory" },
        mode: "legacy",
        cellOutput: join(root, "cell"),
        scratchOutput: join(root, "scratch"),
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "b".repeat(64),
        progressPath: join(root, "progress.jsonl"),
        output: root,
        signal: controller.signal,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "b".repeat(64),
        buildArgs: () => [],
        resolveRunner: () => "/unused/runner.js",
        buildEnvironment: () => process.env,
        createProofReceipt: () => ({ sha256: "c".repeat(64) }),
        createMonitor: () => ({ finalize: async () => { throw progressError; } }),
        runChild: async () => {
          controller.abort(interruption);
          return { status: null, signal: "SIGINT", interruption };
        },
        settleEvidence: () => { throw disposalError; },
      },
    );
  } catch (caught) {
    error = caught;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(error, interruption);
  assert.deepEqual(error.cleanupErrors, [progressError, disposalError]);
});
