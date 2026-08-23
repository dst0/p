import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { BenchmarkChildResultError } from "./benchmark-project-instructions-child-result.js";
import { runPairedBenchmarkCell } from "./benchmark-project-instructions-cell.js";
import { createClassifiedBenchmarkGateFailure } from "./benchmark-project-instructions-failure.js";
import { renderPairedReport } from "./benchmark-project-instructions-core.js";
import { runPairedBenchmarkSchedule } from "./benchmark-project-instructions-schedule.js";
import { settlePairedCellEvidence } from "./benchmark-paired-resources.js";

const pair = { run: 1, task: "typescript-calculator", modes: ["legacy", "compiled"] };

function writeExitZeroChild(path, scratchOutput, resultText) {
  const source = [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { brotliCompressSync } from "node:zlib";',
    `const scratch = ${JSON.stringify(scratchOutput)};`,
    'mkdirSync(`${scratch}/recordings`, { recursive: true });',
    'writeFileSync(`${scratch}/diagnostic.txt`, "untrusted diagnostic\\n");',
    'writeFileSync(`${scratch}/recordings/p-run-1-typescript-calculator.jsonl.br`, brotliCompressSync(Buffer.from("{\\\"type\\\":\\\"session\\\"}\\n")));',
    resultText === undefined
      ? ""
      : `writeFileSync(${JSON.stringify(join(scratchOutput, "results.json"))}, ${JSON.stringify(resultText)});`,
  ].join("\n");
  writeFileSync(path, `${source}\n`);
}

async function runInvalidExitZeroChild(resultText) {
  const root = mkdtempSync(join(tmpdir(), "p-paired-invalid-child-"));
  const output = join(root, "output");
  const scratchOutput = join(root, "scratch");
  const cellOutput = join(root, "cell");
  const progressPath = join(output, "progress", "cell.jsonl");
  const childPath = join(root, "exit-zero-child.js");
  mkdirSync(output);
  writeExitZeroChild(childPath, scratchOutput, resultText);
  let error;
  try {
    await runPairedBenchmarkCell(
      {
        options: { privateSnapshots: {}, authFiles: [], model: "provider/model", sourceSha256: "a".repeat(64) },
        pair,
        mode: "legacy",
        cellOutput,
        scratchOutput,
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "runtime-sha",
        progressPath,
        output,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "runtime-sha",
        buildArgs: () => [],
        resolveRunner: () => childPath,
        buildEnvironment: () => process.env,
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
      assert.equal(run.error.pairedBenchmarkLiveness.semanticEvidenceComplete, false);
      assert.equal(run.progress.at(-1).event, "failed");
      assert.equal(run.progress.some((record) => record.event === "completed"), false);
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
      binarySha256: "runtime-sha",
      seed: "seed",
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
      'import { mkdirSync, writeFileSync } from "node:fs";',
      `const scratch = ${JSON.stringify(scratchOutput)};`,
      'mkdirSync(`${scratch}/recordings/p-run-1-typescript-calculator.jsonl.chunks`, { recursive: true });',
      'writeFileSync(`${scratch}/diagnostic.txt`, "must be discarded\\n");',
      'writeFileSync(`${scratch}/recordings/p-run-1-typescript-calculator.jsonl.chunks/active.jsonl.active`, "{\\\"type\\\":\\\"session\\\"}\\n");',
      'writeFileSync(`${scratch}/results.json`, JSON.stringify({ results: [{ recordingCapture: { format: "chunked-brotli-v1", archiveBytes: 1, archiveLimitBytes: 64, bytes: 19, limitBytes: 64, partial: false, storageBytes: 19, storageLimitBytes: 64 } }] }));',
    ].join("\n"),
  );
  let trusted;
  let error;
  try {
    await runPairedBenchmarkCell(
      {
        options: { privateSnapshots: {}, authFiles: [], model: "provider/model", sourceSha256: "a".repeat(64) },
        pair,
        mode: "legacy",
        cellOutput,
        scratchOutput,
        remainingSeconds: 60,
        runtimeSnapshot: root,
        runtimeSha256: "runtime-sha",
        progressPath,
        output,
      },
      {
        verifyPrivateInputs: () => true,
        assertLegacyUnseeded: () => {},
        hashRuntime: () => "runtime-sha",
        buildArgs: () => [],
        resolveRunner: () => childPath,
        buildEnvironment: () => process.env,
        createSample: () => ({
          status: "passed",
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
    assert.equal(error?.message, "child benchmark semantic evidence is incomplete");
    assert.equal(error?.pairedBenchmarkLiveness.semanticEvidenceComplete, false);
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

test("cell-output collision writes hard-stop evidence instead of leaving RUNNING", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cell-collision-"));
  try {
    const output = join(root, "output");
    const cellOutput = join(output, "cells", "run-1", pair.task, "legacy");
    mkdirSync(cellOutput, { recursive: true });
    const document = {
      candidateVersion: "5.0.1-rc.1",
      generatedAt: "2026-08-23T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "runtime-sha",
      seed: "seed",
      runs: 3,
      tasks: [pair.task],
      schedule: [pair],
      samples: [],
      completed: false,
      gate: { passed: true },
    };
    let exitCode;
    await runPairedBenchmarkSchedule(
      { options: {}, output, scratchRoot: join(root, "scratch"), runtimeSnapshot: root, runtimeSha256: "runtime-sha", schedule: [pair], document, deadline: Date.now() + 60_000 },
      { hashRuntime: () => "runtime-sha", setExitCode: (value) => { exitCode = value; } },
    );
    const persisted = JSON.parse(readFileSync(join(output, "results.json"), "utf8"));
    const report = readFileSync(join(output, "report.md"), "utf8");
    assert.equal(exitCode, 2);
    assert.equal(persisted.gate.passed, false);
    assert.equal(persisted.gate.failure.reason, "benchmark cell output already exists");
    assert.match(report, /HARD STOP/u);
    assert.doesNotMatch(report, /Correctness gate: \*\*RUNNING\*\*/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
