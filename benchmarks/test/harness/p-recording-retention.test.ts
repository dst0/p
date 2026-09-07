import assert from "node:assert/strict";
import test from "node:test";
import { createPRecordingAccumulator } from "../../src/harness/p-recording.ts";
import { createTaskVerificationSemanticTracker } from "../../src/project-instructions/verification-semantic-proof.ts";

test("P metrics fail closed before retained action evidence exceeds its byte budget", () => {
  const accumulator = createPRecordingAccumulator(() => "", {
    maxRetainedCollectionEntries: 32,
    maxRetainedEvidenceBytes: 128,
  });
  assert.throws(
    () =>
      accumulator.observe({
        type: "tool_execution_start",
        toolCallId: "write-large",
        toolName: "write",
        args: { path: "large.txt", content: "x".repeat(256) },
      }),
    /P metric evidence exceeded 128 bytes/u,
  );
});

test("P metrics cap every retained phase-action collection", () => {
  const accumulator = createPRecordingAccumulator(() => "", {
    maxRetainedCollectionEntries: 1,
    maxRetainedEvidenceBytes: 1024 * 1024,
  });
  accumulator.observe({
    type: "tool_execution_start",
    toolCallId: "write-1",
    toolName: "write",
    args: { path: "one.txt", content: "one" },
  });
  assert.throws(
    () =>
      accumulator.observe({
        type: "tool_execution_start",
        toolCallId: "write-2",
        toolName: "write",
        args: { path: "two.txt", content: "two" },
      }),
    /P metric phase actions exceeded 1 entries/u,
  );
});

test("task verification metrics bound unmatched call correlations", () => {
  const tracker = createTaskVerificationSemanticTracker({
    maxPendingCallIdBytes: 1024,
    maxPendingCalls: 1,
  });
  tracker.start({
    type: "tool_execution_start",
    toolCallId: "finish-1",
    toolName: "finish_work",
    args: { status: "success", verification_token: "token" },
  });
  assert.throws(
    () =>
      tracker.start({
        type: "tool_execution_start",
        toolCallId: "finish-2",
        toolName: "finish_work",
        args: { status: "success", verification_token: "token" },
      }),
    /task verification pending calls exceeded 1 entries/u,
  );
});

test("P metric correlations cannot cross subprocess turn boundaries", () => {
  const accumulator = createPRecordingAccumulator(() => "");
  accumulator.observe({
    type: "tool_execution_start",
    toolCallId: "reused",
    toolName: "write",
    args: { path: "one.txt", content: "one" },
    benchmarkEventOrdinal: 1,
  });
  accumulator.endTurn();
  accumulator.observe({
    type: "tool_execution_end",
    toolCallId: "reused",
    toolName: "write",
    isError: false,
    executed: true,
    benchmarkEventOrdinal: 2,
  });
  assert.equal(accumulator.snapshot().phaseRelevantToolCalls[0]?.endOrdinal, undefined);
});
