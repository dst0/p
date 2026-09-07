import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePRecording } from "../../src/harness/p-recording.ts";

function phaseAction(metrics: ReturnType<typeof parsePRecording>, index: number) {
  const action = metrics.phaseRelevantToolCalls[index];
  assert.ok(action);
  return action;
}

test("keeps read-only discovery, closure, and instruction helpers outside mutation evidence", () => {
  const toolNames = ["read", "bash", "finish_work", "list_skills", "read_skills", "read_rules", "ask_user"];
  const events = toolNames.flatMap((toolName, index) => [
    {
      type: "tool_execution_start",
      toolCallId: `${toolName}-${index}`,
      toolName,
      args:
        toolName === "read" ? { path: "src/app.ts" } : toolName === "bash" ? { command: "cat requirements.md" } : {},
      benchmarkEventOrdinal: index * 2 + 1,
    },
    {
      type: "tool_execution_end",
      toolCallId: `${toolName}-${index}`,
      toolName,
      isError: false,
      benchmarkEventOrdinal: index * 2 + 2,
    },
  ]);

  const metrics = parsePRecording(events, () => "");

  assert.deepEqual(metrics.phaseRelevantToolCalls, []);
});

test("records only completed read_rules batches as successful", () => {
  const events = [
    {
      type: "tool_execution_start",
      toolCallId: "ok",
      toolName: "read_rules",
      args: { links: ["rules/a.md"] },
      benchmarkEventOrdinal: 12,
    },
    { type: "tool_execution_end", toolCallId: "ok", toolName: "read_rules", isError: false, benchmarkEventOrdinal: 13 },
    {
      type: "tool_execution_start",
      toolCallId: "failed",
      toolName: "read_rules",
      args: { links: ["rules/b.md"] },
      benchmarkEventOrdinal: 20,
    },
    {
      type: "tool_execution_end",
      toolCallId: "failed",
      toolName: "read_rules",
      isError: true,
      benchmarkEventOrdinal: 21,
    },
    {
      type: "tool_execution_start",
      toolCallId: "unfinished",
      toolName: "read_rules",
      args: { links: ["rules/c.md"] },
      benchmarkEventOrdinal: 30,
    },
    {
      type: "tool_execution_start",
      toolCallId: "bash",
      toolName: "bash",
      args: { command: "npm test" },
      benchmarkEventOrdinal: 40,
    },
    {
      type: "tool_execution_end",
      toolCallId: "bash",
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
      benchmarkEventOrdinal: 41,
    },
    { type: "tool_execution_start", toolCallId: "edit", toolName: "edit", benchmarkEventOrdinal: 50 },
    { type: "tool_execution_end", toolCallId: "edit", toolName: "edit", isError: false, benchmarkEventOrdinal: 51 },
    {
      type: "tool_execution_start",
      toolCallId: "cap",
      toolName: "bash",
      args: { command: "git push origin main" },
      benchmarkEventOrdinal: 55,
    },
    {
      type: "tool_execution_end",
      toolCallId: "cap",
      toolName: "bash",
      isError: true,
      result: {
        content: [{ type: "text", text: "This user turn already selected the maximum three project-rule links." }],
      },
      benchmarkEventOrdinal: 56,
    },
    { type: "tool_execution_start", toolCallId: "fixed", toolName: "edit", benchmarkEventOrdinal: 57 },
    {
      type: "tool_execution_end",
      toolCallId: "fixed",
      toolName: "edit",
      isError: true,
      result: {
        content: [{ type: "text", text: "This user turn already fixed its authoritative project-rule batch." }],
      },
      benchmarkEventOrdinal: 58,
    },
  ];

  const metrics = parsePRecording(events, () => "");

  assert.deepEqual(metrics.readRulesBatches, [
    { links: ["rules/a.md"], succeeded: true, startOrdinal: 12, endOrdinal: 13 },
    { links: ["rules/b.md"], succeeded: false, startOrdinal: 20, endOrdinal: 21 },
  ]);
  assert.deepEqual(metrics.phaseRelevantToolCalls, [
    {
      toolName: "bash",
      phases: ["testing"],
      eventOrdinal: 40,
      endOrdinal: 41,
      blockedByProjectRuleGate: true,
      projectRuleGateBlockKind: "pending",
      pendingRuleBatches: [["rules/testing.md"]],
    },
    { toolName: "edit", phases: ["implementation"], eventOrdinal: 50, endOrdinal: 51, blockedByProjectRuleGate: false },
    {
      toolName: "bash",
      phases: ["delivery"],
      eventOrdinal: 55,
      endOrdinal: 56,
      blockedByProjectRuleGate: true,
      projectRuleGateBlockKind: "cap",
    },
    {
      toolName: "edit",
      phases: ["implementation"],
      eventOrdinal: 57,
      endOrdinal: 58,
      blockedByProjectRuleGate: true,
      projectRuleGateBlockKind: "fixed",
    },
  ]);
  assert.equal(metrics.toolNames.read_rules, 3);
  assert.equal(metrics.toolErrors, 4);
  assert.equal(
    phaseAction(metrics, 0).actionQueries.some((query) => query.includes("work phases testing")),
    true,
  );
  assert.equal(Object.keys(phaseAction(metrics, 0)).includes("actionQueries"), false);
});

test("retains a 500-character action trigger that straddles the first chunk boundary", () => {
  const token = "b".repeat(500);
  const prefix = "edit\n";
  const serializedPrefix = '{"payload":"';
  const payloadLength = 16_384 - prefix.length;
  const tokenStart = payloadLength - Math.floor(token.length / 2);
  const payload = `${"x".repeat(tokenStart - serializedPrefix.length - 1)} ${token}`;
  const metrics = parsePRecording(
    [
      {
        type: "tool_execution_start",
        toolCallId: "boundary",
        toolName: "edit",
        args: { payload },
        benchmarkEventOrdinal: 1,
      },
      {
        type: "tool_execution_end",
        toolCallId: "boundary",
        toolName: "edit",
        isError: false,
        benchmarkEventOrdinal: 2,
      },
    ],
    () => "",
  );

  assert.equal(phaseAction(metrics, 0).actionQueries.length > 1, true);
  assert.equal(
    phaseAction(metrics, 0).actionQueries.some((query) => query.includes(token)),
    true,
  );
});

test("records process and custom potentially mutating tools with semantic labels", () => {
  const metrics = parsePRecording(
    [
      {
        type: "tool_execution_start",
        toolCallId: "process",
        toolName: "process",
        args: { action: "kill" },
        benchmarkEventOrdinal: 1,
      },
      {
        type: "tool_execution_end",
        toolCallId: "process",
        toolName: "process",
        isError: false,
        benchmarkEventOrdinal: 2,
      },
      {
        type: "tool_execution_start",
        toolCallId: "custom",
        toolName: "remote_operation",
        toolDescription: "Deploy production services",
        args: { target: "primary" },
        benchmarkEventOrdinal: 3,
      },
      {
        type: "tool_execution_end",
        toolCallId: "custom",
        toolName: "remote_operation",
        isError: false,
        benchmarkEventOrdinal: 4,
      },
    ],
    () => "",
  );

  assert.deepEqual(
    metrics.phaseRelevantToolCalls.map((call) => call.toolName),
    ["process", "remote_operation"],
  );
  assert.equal(
    phaseAction(metrics, 0).actionQueries.some((query) => query.includes("process execution")),
    true,
  );
  assert.equal(
    phaseAction(metrics, 1).actionQueries.some((query) => query.includes("custom tool action")),
    true,
  );
  assert.equal(
    phaseAction(metrics, 1).actionQueries.some((query) => query.includes("Deploy production services")),
    true,
  );
});

test("keeps accepted finish and trusted controller terminal counts distinct", () => {
  const events = [
    {
      type: "tool_execution_start",
      toolCallId: "finish",
      toolName: "finish_work",
      args: { status: "success", verification_token: "finish-token" },
    },
    { type: "tool_execution_end", toolCallId: "finish", toolName: "finish_work", isError: false },
    {
      type: "tool_execution_start",
      toolCallId: "terminal",
      toolName: "record_requirement_audit",
      args: { action: "verdict" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "terminal",
      toolName: "record_requirement_audit",
      isError: false,
      result: {
        details: {
          verifiedCompletion: {
            kind: "task_verification_completion",
            version: 1,
            status: "success",
            summary: "Verified benchmark completion.",
            files_changed: ["finish_notes.md"],
            certificate_hash: "a".repeat(64),
          },
        },
      },
    },
  ];

  const finishOnly = parsePRecording(events.slice(0, 2), () => "");
  const terminalOnly = parsePRecording(events.slice(2), () => "");

  assert.equal(finishOnly.acceptedFinishCount, 1);
  assert.equal(finishOnly.acceptedTerminalCompletionCount, 0);
  assert.equal(terminalOnly.acceptedFinishCount, 0);
  assert.equal(terminalOnly.acceptedTerminalCompletionCount, 1);
});
