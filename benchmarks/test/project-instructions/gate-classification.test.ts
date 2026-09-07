import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECT_RULE_BATCH_CUSTOM_TYPE,
  PROJECT_RULE_RECEIPT_CUSTOM_TYPE,
  PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE,
  restoreProjectRuleGateFromHistory,
} from "../../../packages/coding-agent/src/core/agent-session/project-instruction-integrity.ts";
import { parsePRecording } from "../../src/harness/p-recording.ts";

const currentInputHash = "b".repeat(64);
const staleInputHash = "a".repeat(64);

function restoredFailure(entry: unknown): string {
  const gate = restoreProjectRuleGateFromHistory(
    [entry as Parameters<typeof restoreProjectRuleGateFromHistory>[0][number]],
    currentInputHash,
    () => 1,
  );
  assert.ok(gate);
  assert.ok(gate.failure);
  return gate.failure;
}

test("records every restored integrity-gate failure as a blocked state action", () => {
  const failures = [
    restoredFailure({
      type: "custom",
      customType: PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE,
      data: { version: 1, inputHash: staleInputHash, source: "reload" },
    }),
    restoredFailure({
      type: "custom",
      customType: PROJECT_RULE_BATCH_CUSTOM_TYPE,
      data: { version: 1, source: "action", inputHash: staleInputHash, links: ["rules/testing.md"] },
    }),
    restoredFailure({ type: "custom", customType: PROJECT_RULE_RECEIPT_CUSTOM_TYPE, data: {} }),
  ];
  const events = failures.flatMap((failure, index) => [
    {
      type: "tool_execution_start",
      toolCallId: `call-${index}`,
      toolName: "bash",
      args: { command: "echo hello" },
      benchmarkEventOrdinal: index * 2 + 1,
    },
    {
      type: "tool_execution_end",
      toolCallId: `call-${index}`,
      toolName: "bash",
      isError: true,
      result: { content: [{ type: "text", text: failure }] },
      benchmarkEventOrdinal: index * 2 + 2,
    },
  ]);

  const metrics = parsePRecording(events, () => "");
  assert.deepEqual(
    metrics.phaseRelevantToolCalls.map((call) => [call.blockedByProjectRuleGate, call.projectRuleGateBlockKind]),
    failures.map(() => [true, "state"]),
  );
});
