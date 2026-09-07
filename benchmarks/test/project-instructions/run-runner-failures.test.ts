import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { settlePairedCellEvidence } from "../../src/harness/paired-resources.ts";
import { runPairedBenchmarkCell } from "../../src/project-instructions/run-cell.ts";
import { BenchmarkChildResultError } from "../../src/project-instructions/run-child-result.ts";
import type { PairedScheduleCell } from "../../src/project-instructions/run-core.ts";
import { createClassifiedBenchmarkGateFailure } from "../../src/project-instructions/run-failure.ts";
import { renderPairedReport } from "../../src/project-instructions/run-report.ts";
import { runPairedBenchmarkSchedule } from "../../src/project-instructions/run-schedule.ts";

const pair: PairedScheduleCell = {
  run: 1,
  task: "typescript-calculator",
  conditions: ["legacy", "compiled-evidence", "compiled-audit"],
};
const privateSnapshots = {
  models: { path: "", present: false, sha256: "", dispose() {} },
  auth: { path: "", present: false, dispose() {} },
  dispose() {},
};
const cellOptions = {
  privateSnapshots,
  authFiles: [],
  model: "provider/model",
  sourceSha256: "a".repeat(64),
} as unknown as Parameters<typeof runPairedBenchmarkCell>[0]["options"];

function writeExitZeroChild(path: string, scratchOutput: string, resultText: string | undefined): void {
  const receiptSha256 = "c".repeat(64);
  const source = [
    'import { createHash } from "node:crypto";',
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { brotliCompressSync } from "node:zlib";',
    `const scratch = ${JSON.stringify(scratchOutput)};`,
    'mkdirSync(scratch + "/recordings", { recursive: true });',
    'writeFileSync(scratch + "/diagnostic.txt", "untrusted diagnostic\\n");',
    'writeFileSync(scratch + "/recordings/p-run-1-typescript-calculator.jsonl.br", brotliCompressSync(Buffer.from("{\\"type\\":\\"session\\"}\\n")));',
    resultText === undefined
      ? ""
      : `writeFileSync(${JSON.stringify(join(scratchOutput, "results.json"))}, ${JSON.stringify(resultText)});`,
    `const resultText = ${JSON.stringify(resultText ?? "")};`,
    `process.send({ schemaVersion: 1, kind: "project-instruction-outer-authority", cellReceiptSha256: ${JSON.stringify(receiptSha256)}, authority: { expectedTurnCount: 1, baseSystemModeProofs: [{}], userTurns: [{}], resultSha256: createHash("sha256").update(resultText).digest("hex") } }, () => process.disconnect());`,
  ].join("\n");
  writeFileSync(path, `${source}\n`);
}

async function runInvalidExitZeroChild(resultText: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "p-paired-invalid-child-"));
  const output = join(root, "output");
  const scratchOutput = join(root, "scratch");
  const cellOutput = join(root, "cell");
  const progressPath = join(output, "progress", "cell.jsonl");
  const childPath = join(root, "exit-zero-child.js");
  mkdirSync(output);
  writeExitZeroChild(childPath, scratchOutput, resultText);
  let error: unknown;
  try {
    await runPairedBenchmarkCell(
      {
        options: cellOptions,
        pair,
        condition: "legacy",
        cellOutput,
        scratchOutput,
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "b".repeat(64),
        progressPath,
        output,
        repoRoot: root,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "b".repeat(64),
        buildArgs: () => [],
        resolveRunner: () => childPath,
        buildEnvironment: () => process.env,
        createProofReceipt: (identity) => ({ ...identity, nonce: "nonce", sha256: "c".repeat(64) }),
      },
    );
  } catch (caught) {
    error = caught;
  }
  const progress = brotliDecompressSync(readFileSync(`${progressPath}.br`))
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { root, error, cellOutput, scratchOutput, progress };
}

for (const [name, resultText, code] of [
  ["missing results", undefined, "missing_results"],
  ["malformed results", '{"results":["\n\n## forged-heading\n<script>forged()</script>', "malformed_results"],
  ["missing capture metadata", JSON.stringify({ results: [{}] }), "invalid_capture_metadata"],
  [
    "invalid full capture metadata",
    JSON.stringify({ results: [{ recordingCapture: { bytes: "64", limitBytes: 64, partial: false } }] }),
    "invalid_capture_metadata",
  ],
  [
    "invalid partial capture metadata",
    JSON.stringify({ results: [{ recordingCapture: { bytes: 64, limitBytes: 64, partial: true } }] }),
    "invalid_capture_metadata",
  ],
]) {
  test(`exit-zero child with ${name} fails before completion and retention`, async () => {
    const run = await runInvalidExitZeroChild(resultText);
    try {
      assert.ok(run.error instanceof BenchmarkChildResultError);
      assert.equal(run.error.code, code);
      const liveness = (
        run.error as BenchmarkChildResultError & {
          pairedBenchmarkLiveness: { semanticEvidenceComplete: boolean };
        }
      ).pairedBenchmarkLiveness;
      assert.equal(liveness.semanticEvidenceComplete, false);
      assert.equal(run.progress.at(-1).event, "failed");
      assert.equal(
        run.progress.some((record) => record.event === "completed"),
        false,
      );
      assert.equal(existsSync(run.scratchOutput), false);
      assert.equal(existsSync(run.cellOutput), false);
      assert.doesNotMatch(run.error.message, /forged-heading|script/u);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });
}

test("malformed child diagnostics cannot forge a report heading", async () => {
  const run = await runInvalidExitZeroChild('{"results":["\n\n## forged-heading\n<div>forged</div>');
  try {
    const failure = createClassifiedBenchmarkGateFailure(pair, "legacy", run.error);
    const report = renderPairedReport({
      generatedAt: "2026-08-23T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "b".repeat(64),
      seed: "seed",
      candidateVersion: "5.0.1-rc.1",
      runs: 3,
      tasks: [pair.task],
      schedule: [pair],
      samples: [],
      completed: false,
      gate: { passed: false, failure },
    });
    assert.doesNotMatch(report, /^## forged-heading$/mu);
    assert.doesNotMatch(report, /<div>forged<\/div>/u);
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
});

test("exit-zero child with valid metadata but active-only recording is untrusted and discarded", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-active-only-child-"));
  const output = join(root, "output");
  const scratchOutput = join(root, "scratch");
  const cellOutput = join(root, "cell");
  const progressPath = join(output, "progress", "active-only.jsonl");
  const childPath = join(root, "active-only-child.js");
  mkdirSync(output);
  writeFileSync(
    childPath,
    [
      'import { createHash } from "node:crypto";',
      'import { mkdirSync, writeFileSync } from "node:fs";',
      `const scratch = ${JSON.stringify(scratchOutput)};`,
      'const result = JSON.stringify({ results: [{ recordingCapture: { format: "chunked-brotli-v1", archiveBytes: 1, archiveLimitBytes: 64, bytes: 19, limitBytes: 64, partial: false, storageBytes: 19, storageLimitBytes: 64 } }] });',
      'mkdirSync(scratch + "/recordings/p-run-1-typescript-calculator.jsonl.chunks", { recursive: true });',
      'writeFileSync(scratch + "/diagnostic.txt", "must be discarded\\n");',
      'writeFileSync(scratch + "/recordings/p-run-1-typescript-calculator.jsonl.chunks/active.jsonl.active", "{\\"type\\":\\"session\\"}\\n");',
      'writeFileSync(scratch + "/results.json", result);',
      'process.send({ schemaVersion: 1, kind: "project-instruction-outer-authority", cellReceiptSha256: "c".repeat(64), authority: { expectedTurnCount: 1, baseSystemModeProofs: [{}], userTurns: [{}], resultSha256: createHash("sha256").update(result).digest("hex") } }, () => process.disconnect());',
    ].join("\n"),
  );
  let trusted: boolean | undefined;
  let error: unknown;
  try {
    await runPairedBenchmarkCell(
      {
        options: cellOptions,
        pair,
        condition: "legacy",
        cellOutput,
        scratchOutput,
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "b".repeat(64),
        progressPath,
        output,
        repoRoot: root,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "b".repeat(64),
        buildArgs: () => [],
        resolveRunner: () => childPath,
        buildEnvironment: () => process.env,
        createProofReceipt: (identity) => ({ ...identity, nonce: "nonce", sha256: "c".repeat(64) }),
        createSample: () => ({
          run: 1,
          task: pair.task,
          condition: "legacy",
          mode: "legacy",
          taskVerificationMode: "evidence",
          status: "passed",
          elapsedMs: 1,
          quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
          metrics: { usage: { totalTokens: 1 } },
        }),
        settleEvidence: (...args) => {
          trusted = args[4];
          settlePairedCellEvidence(...args);
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  try {
    assert.equal(trusted, false);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "child benchmark semantic evidence is incomplete");
    assert.equal(
      (error as Error & { pairedBenchmarkLiveness: { semanticEvidenceComplete: boolean } }).pairedBenchmarkLiveness
        .semanticEvidenceComplete,
      false,
    );
    const failure = createClassifiedBenchmarkGateFailure(pair, "legacy", error);
    assert.equal(failure.reason, "child benchmark semantic evidence is incomplete");
    assert.equal(existsSync(scratchOutput), false);
    assert.equal(existsSync(cellOutput), false);
    const progress = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8");
    assert.match(progress, /"event":"failed"/u);
    assert.doesNotMatch(progress, /"event":"completed"/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cell-output collision leaves a terminal hard stop for global publication", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cell-collision-"));
  try {
    const output = join(root, "output");
    const cellOutput = join(output, "cells", "run-1", pair.task, "legacy");
    mkdirSync(cellOutput, { recursive: true });
    const document: Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] = {
      candidateVersion: "5.0.1-rc.1",
      generatedAt: "2026-08-23T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "b".repeat(64),
      seed: "seed",
      runs: 3,
      tasks: [pair.task],
      schedule: [pair],
      samples: [],
      completed: false,
      gate: { passed: true },
    };
    let exitCode: number | undefined;
    await runPairedBenchmarkSchedule(
      {
        options: cellOptions,
        output,
        scratchRoot: join(root, "scratch"),
        runtimeSnapshot: root,
        runtimeSha256: "b".repeat(64),
        schedule: [pair],
        document,
        deadline: Date.now() + 60_000,
        repoRoot: root,
      },
      {
        hashRuntime: () => "b".repeat(64),
        setExitCode: (value) => {
          exitCode = value;
        },
      },
    );
    assert.equal(exitCode, 2);
    assert.equal(document.runStatus, "failed");
    assert.equal(document.completed, false);
    assert.equal(document.gate.passed, false);
    assert.equal(document.gate.failure?.reason, "benchmark cell output already exists");
    assert.equal(existsSync(join(output, "results.json")), false);
    assert.equal(existsSync(join(output, "report.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
