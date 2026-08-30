import type { ToolResultMessage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { createToolResultStub } from "../src/core/compaction/compaction/token-counting.ts";

function createMessage(content: string, details?: Record<string, unknown>): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_task_exec_123",
    toolName: "execute_benchmark_verification",
    content: [{ type: "text", text: content }],
    isError: false,
    details,
    timestamp: 1_700_000_000_000,
  };
}

describe("compaction tool result raw pointer evidence preservation", () => {
  it("preserves authoritative trailing line alongside initial lines in raw pointer summary for long tool results", () => {
    const lines = [
      "TASK INITIALIZATION: benchmark harness loaded configuration",
      "STATUS: pre-flight checks passed successfully",
      ...Array.from({ length: 25 }, (_, index) => `STEP ${index + 1}: intermediate worker log payload ${index + 1}`),
      "FINAL EXECUTION STATUS: suite completed with 0 errors",
      "NEXT REQUIRED ACTION: call record_task_verification with verification_id=v_48291",
    ];
    const message = createMessage(lines.join("\n"));

    const { stub } = createToolResultStub(message, 0, 8000);
    const summary = stub.rawPointer.summary;

    expect(summary).toContain("TASK INITIALIZATION: benchmark harness loaded configuration");
    expect(summary).toContain("STATUS: pre-flight checks passed successfully");
    expect(summary).toContain("NEXT REQUIRED ACTION: call record_task_verification with verification_id=v_48291");
  });

  it.each([
    [["Line 1: single"], "Evidence: Line 1: single"],
    [["Line 1: first", "Line 2: second", "Line 1: first"], "Evidence: Line 1: first | Line 2: second"],
    [
      ["Line 1: alpha", "Line 2: beta", "Line 3: gamma", "Line 4: delta"],
      "Evidence: Line 1: alpha | Line 2: beta | Line 4: delta",
    ],
    [
      ["Line 1: start", "Line 2: progress", "Line 3: checkpoint", "Line 2: progress"],
      "Evidence: Line 1: start | Line 2: progress | Line 3: checkpoint",
    ],
  ])("bounds and deduplicates raw-pointer evidence %#", (relevantLines, expected) => {
    const message = createMessage("fallback text", { contextExtract: { summary: "Bounded", relevantLines } });
    const { stub } = createToolResultStub(message, 0, 4_000);
    expect(stub.rawPointer.summary).toBe(`Bounded ${expected}`);
  });

  it("preserves distinct head and tail evidence when contextExtract relevantLines are provided", () => {
    const relevantLines = [
      "EXTRACT 1: setup",
      "EXTRACT 2: compile",
      "EXTRACT 3: test",
      "EXTRACT 4: benchmark",
      "EXTRACT 5: final action token",
    ];
    const message = createMessage("fallback text", {
      contextExtract: {
        summary: "Custom tool extract",
        relevantLines,
      },
    });

    const { stub } = createToolResultStub(message, 0, 4000);
    const summary = stub.rawPointer.summary;

    expect(summary).toContain(
      "Custom tool extract Evidence: EXTRACT 1: setup | EXTRACT 2: compile | EXTRACT 5: final action token",
    );
  });
});
