import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePRecording } from "../../src/harness/p-recording.ts";

const ruleBlockText =
  'Call read_rules with each selected authoritative batch before continuing: [{"links":["rules/testing.md"]}].';

function events(executed: boolean | undefined, text: string) {
  return [
    {
      type: "tool_execution_start",
      toolCallId: "bash-1",
      toolName: "bash",
      args: { command: "npm test" },
      benchmarkEventOrdinal: 40,
    },
    {
      type: "tool_execution_end",
      toolCallId: "bash-1",
      toolName: "bash",
      isError: true,
      executed,
      result: { content: [{ type: "text", text }] },
      benchmarkEventOrdinal: 41,
    },
  ];
}

test("does not treat a pre-execution verification block as a completed mutation", () => {
  const metrics = parsePRecording(
    events(false, "Call record_requirement_audit with action prepare_definition before mutation."),
    () => "",
  );

  assert.deepEqual(metrics.phaseRelevantToolCalls, [
    {
      toolName: "bash",
      phases: ["testing"],
      eventOrdinal: 40,
      endOrdinal: 41,
    },
  ]);
});

test("keeps executed failures fail-closed even when their text resembles a project-rule block", () => {
  const failed = parsePRecording(events(true, "Tests failed."), () => "");
  assert.equal(failed.phaseRelevantToolCalls[0]?.blockedByProjectRuleGate, false);

  const misleadingFailure = parsePRecording(events(true, ruleBlockText), () => "");
  assert.equal(misleadingFailure.phaseRelevantToolCalls[0]?.blockedByProjectRuleGate, false);
  assert.equal(misleadingFailure.phaseRelevantToolCalls[0]?.pendingRuleBatches, undefined);
});

test("recognizes current and historical project-rule blocks", () => {
  const projectRuleBlocked = parsePRecording(events(false, ruleBlockText), () => "");
  assert.equal(projectRuleBlocked.phaseRelevantToolCalls[0]?.blockedByProjectRuleGate, true);
  assert.deepEqual(projectRuleBlocked.phaseRelevantToolCalls[0]?.pendingRuleBatches, [["rules/testing.md"]]);

  const historicalBlock = parsePRecording(events(undefined, ruleBlockText), () => "");
  assert.equal(historicalBlock.phaseRelevantToolCalls[0]?.blockedByProjectRuleGate, true);
});
