import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { runBenchmarkChild } from "../../src/project-instructions/run-child-process.ts";
import {
  assertChildSampleMetrics,
  assertNoStartupProbeCaptureOverflow,
  assessSample,
} from "../../src/project-instructions/run-core.ts";
import {
  attachPairedBenchmarkLiveness,
  classifyPairedBenchmarkFailure,
  createClassifiedBenchmarkGateFailure,
} from "../../src/project-instructions/run-failure.ts";
import {
  createCellLivenessMonitor,
  createUnavailableCellLiveness,
} from "../../src/project-instructions/run-liveness.ts";

test("paired gate failures distinguish process, status, correctness, provider, and infrastructure", () => {
  assert.equal(classifyPairedBenchmarkFailure("child benchmark exited 86"), "process");
  assert.equal(classifyPairedBenchmarkFailure("run status timed_out"), "status");
  assert.equal(classifyPairedBenchmarkFailure("quality gate failed (95/100)"), "correctness");
  assert.equal(classifyPairedBenchmarkFailure("child benchmark resolved model identity mismatch"), "provider");
  assert.equal(
    classifyPairedBenchmarkFailure("immutable P runtime changed before the benchmark cell"),
    "infrastructure",
  );
});

test("classified failures retain the existing correctness reason", () => {
  assert.deepEqual(
    createClassifiedBenchmarkGateFailure(
      { run: 2, task: "event-sourced-inventory" },
      "compiled",
      "quality gate failed (95/100)",
    ),
    {
      run: 2,
      task: "event-sourced-inventory",
      mode: "compiled",
      reason: "quality gate failed (95/100)",
      kind: "correctness",
      liveness: createUnavailableCellLiveness(),
    },
  );
});

test("complete failed samples classify quality regressions before generic status", () => {
  const failedQuality = {
    status: "failed",
    quality: {
      passed: false,
      rawScore: 95,
      maxScore: 100,
      checks: [
        { name: "contract", passed: true },
        { name: "newline termination", passed: false },
      ],
    },
  };
  assert.deepEqual(assessSample(failedQuality), { passed: false, reason: "quality gate failed (95/100)" });
  assert.deepEqual(assessSample({ ...failedQuality, status: "timed_out" }), {
    passed: false,
    reason: "run status timed_out",
  });
  assert.deepEqual(assessSample({ status: "skipped" }), { passed: false, reason: "run status skipped" });
});

test("passed samples hard-fail when expected semantic evidence is incomplete", () => {
  const sample = {
    status: "passed",
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    liveness: { semanticEvidenceAvailable: true, semanticEvidenceComplete: false },
  };
  assert.deepEqual(assessSample(sample), {
    passed: false,
    reason: "child benchmark semantic evidence is incomplete",
  });
});

test("explicit timeout and provider termination precede secondary semantic failures", () => {
  const incompleteLiveness = { semanticEvidenceAvailable: false, semanticEvidenceComplete: false };
  assert.deepEqual(assessSample({ status: "timed_out", liveness: incompleteLiveness }), {
    passed: false,
    reason: "run status timed_out",
  });
  assert.deepEqual(
    assessSample({
      status: "failed",
      metrics: { errors: ["upstream provider stopped"] },
      liveness: incompleteLiveness,
    }),
    { passed: false, reason: "provider terminated before successful completion" },
  );
  assert.equal(classifyPairedBenchmarkFailure("provider terminated before successful completion"), "provider");
});

test("capture overflow is an infrastructure failure before status, quality, or startup diagnosis", () => {
  const captureOverflow = {
    kind: "capture_overflow",
    captureName: "raw recording",
    limitBytes: 64,
    observedBytesAtLeast: 80,
    turn: 1,
  };
  const failed = {
    status: "failed",
    captureOverflow,
    elapsedMs: 10,
    metrics: { usage: { totalTokens: 1 } },
    quality: { passed: false, rawScore: 0, maxScore: 1, checks: [{ passed: false }] },
  };
  const assessment = assessSample(failed);
  assert.match(assessment.reason ?? "", /^capture overflow:/u);
  assert.equal(classifyPairedBenchmarkFailure(assessment.reason), "infrastructure");
  assert.throws(() => assertChildSampleMetrics(failed), /^Error: capture overflow:/u);
  assert.throws(
    () => assertNoStartupProbeCaptureOverflow({ agy: { captureOverflow } }),
    /^Error: agy startup probe capture overflow:/u,
  );
});

test("a real failed child retains compressed monitor evidence on its gate failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-failed-child-"));
  try {
    const progressPath = join(directory, "progress.jsonl");
    const finalRecordingPath = join(directory, "recording.jsonl.br");
    writeFileSync(
      finalRecordingPath,
      brotliCompressSync(
        Buffer.from(
          `${JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "failed-define",
            toolName: "record_requirement_audit",
            args: { action: "define" },
          })}\n`,
        ),
      ),
    );
    const monitor = createCellLivenessMonitor({
      progressPath,
      activeRecordingPath: join(directory, "recording.jsonl.active"),
      finalRecordingPath,
      inspectWorkspace: () => 0,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    const child = await runBenchmarkChild(process.execPath, ["-e", "process.exit(9)"], { stdio: "ignore" });
    assert.equal(child.status, 9);
    const recordingCapture = { bytes: 256, limitBytes: 512, partial: false };
    const liveness = await monitor.finalize({
      outcome: "failed",
      captureMetadataValid: true,
      recordingCapture,
    });
    const error = attachPairedBenchmarkLiveness(new Error(`child benchmark exited ${child.status}`), liveness);
    const failure = createClassifiedBenchmarkGateFailure(
      { run: 1, task: "event-sourced-inventory" },
      "compiled",
      error,
    );
    assert.equal(failure.kind, "process");
    assert.deepEqual(failure.liveness, liveness);
    assert.match(failure.liveness.progressEvidence ?? "", /\.jsonl\.br$/u);
    assert.equal(failure.liveness.requirementDefinitionAttemptCount, 1);
    assert.equal(failure.liveness.semanticEvidenceAvailable, true);

    const unavailableMonitor = createCellLivenessMonitor({
      progressPath: join(directory, "unavailable-progress.jsonl"),
      activeRecordingPath: join(directory, "missing.jsonl.active"),
      finalRecordingPath: join(directory, "missing.jsonl.br"),
      inspectWorkspace: () => 0,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    const unavailable = await unavailableMonitor.finalize({ outcome: "failed" });
    assert.equal(unavailable.requirementDefinitionAttemptCount, null);
    assert.equal(unavailable.semanticEvidenceAvailable, false);
    assert.equal(unavailable.semanticEvidenceComplete, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
