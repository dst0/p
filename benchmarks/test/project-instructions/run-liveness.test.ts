import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import {
  initializeBenchmarkWorkspaceRepository,
  sanitizeBenchmarkGitEnvironment,
} from "../../src/harness/workspace-repository.ts";
import { runBenchmarkChild } from "../../src/project-instructions/run-child-process.ts";
import { CELL_HEARTBEAT_INTERVAL_MS, createCellLivenessMonitor } from "../../src/project-instructions/run-liveness.ts";

test("cell liveness records bounded semantic heartbeats without paths or payloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-liveness-"));
  try {
    const progressPath = join(directory, "progress.jsonl");
    let elapsedMs = 0;
    let changedPathCount: number | undefined;
    const monitor = createCellLivenessMonitor({
      progressPath,
      now: () => 1_000 + elapsedMs,
      inspectWorkspace: () => changedPathCount,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    assert.ok(CELL_HEARTBEAT_INTERVAL_MS < 60_000);

    elapsedMs = 500;
    changedPathCount = 0;
    monitor.observe();
    elapsedMs = 2_000;
    changedPathCount = 3;
    monitor.observe();
    elapsedMs = 5_000;
    changedPathCount = 1;
    monitor.heartbeat();
    const evidence = await monitor.finalize({ outcome: "process_completed" });

    assert.equal(evidence.firstMutationElapsedMs, 2_000);
    assert.equal(evidence.requirementDefinitionAttemptCount, null);
    assert.equal(evidence.observedRequirementDefinitionAttemptCount, 0);
    assert.equal(evidence.heartbeatCount, 1);
    assert.match(evidence.progressEvidence ?? "", /\.jsonl\.br$/u);
    const records = brotliDecompressSync(readFileSync(`${progressPath}.br`))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map((record) => record.event),
      ["started", "heartbeat", "completed"],
    );
    assert.equal(records[1].phase, "implementation");
    assert.equal(records[1].firstMutationElapsedMs, 2_000);
    assert.equal(records[1].changedPathCount, 1);
    assert.equal(records[2].requirementDefinitionAttemptCount, null);
    assert.equal(records[2].observedRequirementDefinitionAttemptCount, 0);
    assert.doesNotMatch(JSON.stringify(records), /Authorization|prompt|args|path/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("async child execution preserves process status without buffering output", async () => {
  const result = await runBenchmarkChild(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
  assert.equal(result.status, 7);
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
});

test("active recording preserves semantic mutation after the worktree is committed or reverted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-active-recording-"));
  try {
    const workspace = join(directory, "workspace");
    const sourcePath = join(workspace, "source.ts");
    mkdirSync(workspace);
    writeFileSync(sourcePath, "export const value = 1;\n");
    initializeBenchmarkWorkspaceRepository(workspace);
    const gitEnvironment = sanitizeBenchmarkGitEnvironment(process.env);
    writeFileSync(sourcePath, "export const value = 2;\n");
    assert.equal(spawnSync("git", ["add", "source.ts"], { cwd: workspace, env: gitEnvironment }).status, 0);
    assert.equal(
      spawnSync("git", ["commit", "--quiet", "-m", "completed mutation"], { cwd: workspace, env: gitEnvironment })
        .status,
      0,
    );
    writeFileSync(sourcePath, "transient change\n");
    writeFileSync(sourcePath, "export const value = 2;\n");
    assert.equal(
      spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8", env: gitEnvironment }).stdout,
      "",
    );
    const activeRecordingPath = join(directory, "p-run-1-task.jsonl.active");
    const finalRecordingPath = join(directory, "p-run-1-task.jsonl.br");
    const progressPath = join(directory, "monitor.jsonl");
    let elapsedMs = 0;
    writeFileSync(activeRecordingPath, `${JSON.stringify({ type: "session" })}\n`);
    const monitor = createCellLivenessMonitor({
      progressPath,
      activeRecordingPath,
      finalRecordingPath,
      now: () => 10_000 + elapsedMs,
      workspace,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    monitor.observe();
    elapsedMs = 1_234;
    const events = [
      { type: "tool_execution_start", toolCallId: "write-1", toolName: "write", args: { path: "src/π.ts" } },
      {
        type: "tool_execution_start",
        toolCallId: "define-1",
        toolName: "record_requirement_audit",
        args: { action: "define" },
      },
      {
        type: "tool_execution_start",
        toolCallId: "define-2",
        toolName: "record_requirement_audit",
        args: { action: "define" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "define-2",
        toolName: "record_requirement_audit",
        args: { action: "define" },
      },
      {
        type: "tool_execution_start",
        toolCallId: "verdict-1",
        toolName: "record_requirement_audit",
        args: { action: "verdict" },
      },
      { type: "message_end", message: { toolName: "record_requirement_audit", args: { action: "define" } } },
    ];
    const streamedEvents = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    const encodedEvents = Buffer.from(streamedEvents);
    const split = encodedEvents.indexOf(Buffer.from("π")) + 1;
    appendFileSync(activeRecordingPath, encodedEvents.subarray(0, split));
    monitor.observe();
    appendFileSync(activeRecordingPath, encodedEvents.subarray(split));
    monitor.observe();
    elapsedMs = 5_000;
    writeFileSync(
      finalRecordingPath,
      brotliCompressSync(Buffer.from(`${JSON.stringify({ type: "session" })}\n${streamedEvents}`)),
    );
    rmSync(activeRecordingPath);
    const evidence = await monitor.finalize({
      outcome: "process_completed",
      captureMetadataValid: true,
      recordingCapture: { bytes: 1_024, limitBytes: 2_048, partial: false },
    });
    assert.equal(evidence.firstMutationElapsedMs, 1_234);
    assert.equal(evidence.requirementDefinitionAttemptCount, 2);
    assert.equal(evidence.observedRequirementDefinitionAttemptCount, 2);
    assert.equal(evidence.semanticSequence, 4);
    assert.equal(evidence.semanticEvidenceAvailable, true);
    assert.equal(evidence.mutationCount, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("semantic recording payloads never enter compressed progress evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-progress-sanitization-"));
  try {
    const activeRecordingPath = join(directory, "recording.jsonl.active");
    const progressPath = join(directory, "progress.jsonl");
    writeFileSync(
      activeRecordingPath,
      `${JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "private-write",
        toolName: "write",
        args: { path: "/private/workspace/secret.txt", content: "Authorization: private-value" },
      })}\n`,
    );
    const monitor = createCellLivenessMonitor({
      progressPath,
      activeRecordingPath,
      finalRecordingPath: join(directory, "recording.jsonl.br"),
      inspectWorkspace: () => 0,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    monitor.observe();
    const summary = await monitor.finalize({ outcome: "failed" });
    assert.equal(summary.semanticEvidenceAvailable, true);
    assert.equal(summary.semanticEvidenceComplete, false);
    assert.equal(summary.requirementDefinitionAttemptCount, null);
    assert.equal(summary.observedRequirementDefinitionAttemptCount, 0);
    const evidence = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8");
    assert.doesNotMatch(evidence, /Authorization|private-value|secret\.txt|\/private\/workspace|"args"/u);
    assert.match(evidence, /"mutationCount":1/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a capped finalized recording never reports lower-bound definition counts as complete", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-partial-recording-"));
  try {
    const finalRecordingPath = join(directory, "recording.jsonl.br");
    writeFileSync(
      finalRecordingPath,
      brotliCompressSync(
        Buffer.from(
          `${JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "partial-define",
            toolName: "record_requirement_audit",
            args: { action: "define" },
          })}\n`,
        ),
      ),
    );
    const monitor = createCellLivenessMonitor({
      progressPath: join(directory, "progress.jsonl"),
      finalRecordingPath,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    const summary = await monitor.finalize({
      outcome: "failed",
      captureMetadataValid: true,
      recordingCapture: { bytes: 64, limitBytes: 64, partial: true },
      captureOverflow: {
        kind: "capture_overflow",
        captureName: "raw recording",
        limitBytes: 64,
        observedBytesAtLeast: 65,
      },
    });
    assert.equal(summary.semanticSequence, 1);
    assert.equal(summary.semanticEvidenceAvailable, true);
    assert.equal(summary.semanticEvidenceComplete, false);
    assert.equal(summary.requirementDefinitionAttemptCount, null);
    assert.equal(summary.observedRequirementDefinitionAttemptCount, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed finalized recordings remain incomplete when capture metadata is missing or malformed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p-paired-unknown-recording-"));
  try {
    const finalRecordingPath = join(directory, "recording.jsonl.br");
    writeFileSync(
      finalRecordingPath,
      brotliCompressSync(
        Buffer.from(
          `${JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "unknown-define",
            toolName: "record_requirement_audit",
            args: { action: "define" },
          })}\n`,
        ),
      ),
    );
    const variants: Array<[string, string | undefined, string]> = [
      ["missing", undefined, "failed"],
      ["malformed", "{not-json\n", "failed"],
      ["completed-missing", undefined, "process_completed"],
    ];
    for (const [variant, captureResult, outcome] of variants) {
      const captureResultPath = join(directory, `${variant}-results.json`);
      if (captureResult !== undefined) writeFileSync(captureResultPath, captureResult);
      const monitorOptions = {
        progressPath: join(directory, `${variant}-progress.jsonl`),
        finalRecordingPath,
        captureResultPath,
        schedule: () => ({ fake: true }),
        cancel: () => {},
      };
      const monitor = createCellLivenessMonitor(monitorOptions);
      const summary = await monitor.finalize({ outcome });
      assert.equal(summary.semanticEvidenceAvailable, true, variant);
      assert.equal(summary.semanticEvidenceComplete, false, variant);
      assert.equal(summary.requirementDefinitionAttemptCount, null, variant);
      assert.equal(summary.observedRequirementDefinitionAttemptCount, 1, variant);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
