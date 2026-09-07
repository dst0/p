import assert from "node:assert/strict";
import { test } from "node:test";
import type { BenchmarkRecordingEvent } from "../../src/harness/p-recording.ts";
import { parsePRecording } from "../../src/harness/p-recording.ts";

test("records runtime pending batches and classifies every supported shell argument key", () => {
  const shellArgumentCases = [{ script: "npm test" }, { code: "npm test" }, { CommandLine: "npm test" }];
  const events: BenchmarkRecordingEvent[] = shellArgumentCases.flatMap((args, index) => [
    {
      type: "tool_execution_start",
      toolCallId: `shell-${index}`,
      toolName: "bash",
      args,
      benchmarkEventOrdinal: index * 2 + 1,
    },
    {
      type: "tool_execution_end",
      toolCallId: `shell-${index}`,
      toolName: "bash",
      isError: true,
      result: {
        content: [
          {
            type: "text",
            text: 'Call read_rules with each selected authoritative batch before continuing: [{"links":["rules/testing.md"]}].',
          },
        ],
      },
      benchmarkEventOrdinal: index * 2 + 2,
    },
  ]);

  const metrics = parsePRecording(events, () => "");

  for (const action of metrics.phaseRelevantToolCalls) {
    assert.equal(
      action.actionQueries.some((query) => query.includes("test testing verification")),
      true,
    );
    assert.deepEqual(action.pendingRuleBatches, [["rules/testing.md"]]);
  }
});

test("does not classify words embedded inside one quoted shell argument as commands", () => {
  const metrics = parsePRecording(
    [
      {
        type: "tool_execution_start",
        toolCallId: "quoted",
        toolName: "bash",
        args: { command: "npm test; printf 'git release'" },
        benchmarkEventOrdinal: 1,
      },
      {
        type: "tool_execution_end",
        toolCallId: "quoted",
        toolName: "bash",
        isError: false,
        benchmarkEventOrdinal: 2,
      },
    ],
    () => "",
  );
  const action = metrics.phaseRelevantToolCalls[0];
  assert.ok(action);
  assert.equal(
    action.actionQueries.some((query) => query.includes("git version control repository")),
    false,
  );
});
