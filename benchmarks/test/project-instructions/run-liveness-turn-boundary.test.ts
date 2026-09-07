import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { createCellLivenessMonitor } from "../../src/project-instructions/run-liveness.ts";

test("liveness does not pair a dangling tool start across a recorded turn boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-liveness-turn-boundary-"));
  const finalRecordingPath = join(root, "recording.jsonl.br");
  const events = [
    {
      type: "tool_execution_start",
      toolCallId: "reused",
      toolName: "finish_work",
      args: { status: "success", verification_token: "token" },
    },
    { type: "turn_end" },
    {
      type: "tool_execution_end",
      toolCallId: "reused",
      toolName: "finish_work",
      isError: false,
      result: { content: [{ type: "text", text: "done" }] },
    },
  ];
  writeFileSync(
    finalRecordingPath,
    brotliCompressSync(Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`)),
  );
  const monitor = createCellLivenessMonitor({
    progressPath: join(root, "progress.jsonl"),
    finalRecordingPath,
    schedule: () => ({ fake: true }),
    cancel: () => {},
  });
  try {
    const result = await monitor.finalize({
      outcome: "process_completed",
      captureMetadataValid: true,
      recordingCapture: { bytes: 1_024, limitBytes: 2_048, partial: false },
    });
    assert.equal(result.semanticEvidenceComplete, true);
    assert.equal(result.taskVerification?.acceptedFinishCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
