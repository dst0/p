import { afterEach, describe, expect, it, vi } from "vitest";
import { getTextModeFinalOutput, runPrintMode } from "../src/modes/print-mode.ts";
import {
  captureStdout,
  createAssistantMessage,
  createCompletionProtocolRepairMessage,
  createFinishWorkResult,
  createProviderLengthContinuationMessage,
  createRuntimeHost,
  createToolResult,
} from "./print-mode-test-support.ts";

const MISSING_FINISH_REASON = "missing_finish_work_or_tool_call";

afterEach(() => {
  vi.restoreAllMocks();
});

function createSuccessfulFinish(summary: string) {
  return [
    createAssistantMessage({
      stopReason: "toolUse",
      toolCall: {
        id: "finish-1",
        name: "finish_work",
        arguments: { status: "success", summary },
      },
    }),
    createFinishWorkResult({ status: "success", summary }),
  ];
}

function createProtocolToolTurn(toolName: string, id: string, isError = false) {
  return [
    createAssistantMessage({ stopReason: "toolUse", toolCall: { id, name: toolName, arguments: {} } }),
    { ...createToolResult(), toolCallId: id, toolName, isError },
  ];
}

describe("print-mode repaired final response", () => {
  it("prints an exact two-bullet answer across missing-finish repair", async () => {
    const answer = [
      "- **Confirmed evidence:** The prototype passed focused checks; no full load test ran.",
      "- **Recommendation and unresolved risk:** Run a limited pilot; production-scale reliability remains unverified.",
    ].join("\n");

    const response = [
      createAssistantMessage({ text: answer }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      ...createSuccessfulFinish("Produced the requested decision note."),
    ];
    const runtimeHost = createRuntimeHost(response[response.length - 1]!, { promptAgentEnds: [response] });
    const stdout = captureStdout();
    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Produce exactly two decision-note bullets",
    });
    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe(`${answer}\n`);
  });
  it("preserves the public answer across verification-only completion repair turns", () => {
    const answer = "- Codename: Lighthouse\n- Status: Ready for launch";
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: answer }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        text: "The response-only task is complete.",
        stopReason: "toolUse",
        toolCall: {
          id: "verification-1",
          name: "record_task_verification",
          arguments: { action: "ready_to_finish", verification_scope: "response_only" },
        },
      }),
      {
        ...createToolResult("Record one completion checklist first."),
        toolCallId: "verification-1",
        toolName: "record_task_verification",
      },
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: {
          id: "failed-finish",
          name: "finish_work",
          arguments: { status: "success", summary: "Compressed summary" },
        },
      }),
      {
        ...createToolResult("Cannot finish before recording the checklist."),
        toolCallId: "failed-finish",
        toolName: "finish_work",
        isError: true,
      },
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: {
          id: "verification-2",
          name: "record_task_verification",
          arguments: { action: "record_completion_checklist", verification_scope: "response_only" },
        },
      }),
      {
        ...createToolResult("Completion checklist recorded."),
        toolCallId: "verification-2",
        toolName: "record_task_verification",
      },
      ...createSuccessfulFinish("Compressed summary"),
    ]);
    expect(output).toEqual({ text: answer, exitCode: 0 });
  });
  it("retains summary precedence for an ordinary earlier assistant response", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Earlier commentary" }),
      ...createSuccessfulFinish("Authoritative finish summary"),
    ]);
    expect(output).toEqual({ text: "Authoritative finish summary", exitCode: 0 });
  });
  it("retains summary precedence for a non-missing-finish repair", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Malformed response text" }),
      createCompletionProtocolRepairMessage("malformed_or_truncated_tool_call"),
      ...createSuccessfulFinish("Recovered finish summary"),
    ]);
    expect(output).toEqual({ text: "Recovered finish summary", exitCode: 0 });
  });
  it("does not recover a response across a later direct user message", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Stale answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      {
        role: "user",
        content: [{ type: "text", text: "Use a different format instead." }],
        timestamp: Date.now(),
      },
      ...createSuccessfulFinish("Updated response summary"),
    ]);
    expect(output).toEqual({ text: "Updated response summary", exitCode: 0 });
  });
  it("does not recover from a repair without a following finish result", () => {
    const output = getTextModeFinalOutput([
      ...createSuccessfulFinish("Earlier completed task"),
      createAssistantMessage({ text: "Unfinished later answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
    ]);
    expect(output).toEqual({ text: "Earlier completed task", exitCode: 0 });
  });
  it("does not recover when the finish result does not match the finish call", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Candidate answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: {
          id: "different-finish-id",
          name: "finish_work",
          arguments: { status: "success", summary: "Compressed summary" },
        },
      }),
      createFinishWorkResult({ status: "success", summary: "Compressed summary" }),
    ]);
    expect(output).toEqual({ text: "Compressed summary", exitCode: 0 });
  });
  it("does not recover an answer when work continued after its repair", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Premature answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: { id: "tool-1", name: "read", arguments: { path: "new-evidence.txt" } },
      }),
      createToolResult("new evidence"),
      ...createSuccessfulFinish("Summary after continued work"),
    ]);
    expect(output).toEqual({ text: "Summary after continued work", exitCode: 0 });
  });
  it("does not recover an older answer when the finish turn contains new public text", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Older answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        text: "Correction: use the newer conclusion.",
        stopReason: "toolUse",
        toolCall: {
          id: "finish-1",
          name: "finish_work",
          arguments: { status: "success", summary: "Newer conclusion" },
        },
      }),
      createFinishWorkResult({ status: "success", summary: "Newer conclusion" }),
    ]);
    expect(output).toEqual({ text: "Newer conclusion", exitCode: 0 });
  });
  it("retains the failed finish diagnostic and nonzero status", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Premature success answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: {
          id: "finish-1",
          name: "finish_work",
          arguments: { status: "failed", summary: "Blocked by missing evidence" },
        },
      }),
      createFinishWorkResult({ status: "failed", summary: "Blocked by missing evidence" }),
    ]);
    expect(output).toEqual({ text: "Blocked by missing evidence", exitCode: 1 });
  });
  it("retains the partial finish summary", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Overstated complete answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: {
          id: "finish-1",
          name: "finish_work",
          arguments: { status: "partial", summary: "Some evidence remains unresolved" },
        },
      }),
      createFinishWorkResult({ status: "partial", summary: "Some evidence remains unresolved" }),
    ]);
    expect(output).toEqual({ text: "Some evidence remains unresolved", exitCode: 0 });
  });
  it("preserves every provider-length segment before missing-finish repair", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "first bullet ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "second bullet" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      ...createSuccessfulFinish("Compressed summary"),
    ]);
    expect(output).toEqual({ text: "first bullet second bullet", exitCode: 0 });
  });
  it("uses only the newest response acknowledged by missing-finish repair", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "stale answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      createAssistantMessage({ text: "corrected answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      ...createSuccessfulFinish("Compressed final summary"),
    ]);
    expect(output).toEqual({ text: "corrected answer", exitCode: 0 });
  });
  it("preserves the public answer across a requirement-audit-only repair", () => {
    const answer = "Complete public answer";
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: answer }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
      ...createProtocolToolTurn("record_requirement_audit", "audit-1"),
      ...createSuccessfulFinish("Compressed summary"),
    ]);
    expect(output).toEqual({ text: answer, exitCode: 0 });
  });
  it("fails closed for malformed, errored, stale, or unbounded repair corridors", () => {
    const summary = "Authoritative finish summary";
    const prefix = [
      createAssistantMessage({ text: "Candidate answer" }),
      createCompletionProtocolRepairMessage(MISSING_FINISH_REASON),
    ];
    const duplicateCall = createAssistantMessage({
      stopReason: "toolUse",
      toolCall: { id: "duplicate", name: "record_task_verification", arguments: {} },
    });
    duplicateCall.content.push({ type: "toolCall", id: "duplicate", name: "record_task_verification", arguments: {} });
    const statusMismatch = createAssistantMessage({
      stopReason: "toolUse",
      toolCall: { id: "finish-1", name: "finish_work", arguments: { status: "failed", summary } },
    });
    const directUser = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "Continue" }],
      timestamp: Date.now(),
    };
    const cases = [
      [
        ...Array.from({ length: 8 }, (_, index) =>
          createProtocolToolTurn("record_task_verification", `verification-${index}`),
        ).flat(),
        ...createSuccessfulFinish(summary),
      ],
      [
        ...createProtocolToolTurn("record_task_verification", "errored-verification", true),
        ...createSuccessfulFinish(summary),
      ],
      [...createSuccessfulFinish("Premature success"), ...createSuccessfulFinish(summary)],
      [
        duplicateCall,
        { ...createToolResult(), toolCallId: "duplicate", toolName: "record_task_verification" },
        ...createSuccessfulFinish(summary),
      ],
      [statusMismatch, createFinishWorkResult({ status: "success", summary })],
      [...createSuccessfulFinish(summary), directUser],
    ];
    for (const corridor of cases) {
      expect(getTextModeFinalOutput([...prefix, ...corridor])).toEqual({ text: summary, exitCode: 0 });
    }
  });
});
