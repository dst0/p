import { describe, expect, it } from "vitest";
import { createExecutedToolCallBatch, shouldTerminateToolBatch } from "../src/agent-loop/streaming-handler.ts";
import type { FinalizedToolCallOutcome } from "../src/agent-loop/types.ts";
import type { AgentToolCall } from "../src/types.ts";

const toolCall: AgentToolCall = { type: "toolCall", id: "tc_1", name: "mock_tool", arguments: {} };
const terminal = { content: [], details: {}, terminate: true };

describe("trusted terminal completion batches", () => {
  it("does not terminate for an error result", () => {
    const finalized: FinalizedToolCallOutcome[] = [{ toolCall, result: terminal, isError: true, executed: true }];
    expect(shouldTerminateToolBatch(finalized)).toBe(false);
  });

  it("propagates one trusted completion only from a successful terminating batch", () => {
    const completion = { status: "success" as const, summary: "Verified.", files_changed: ["result.txt"] };
    const finalized: FinalizedToolCallOutcome[] = [
      { toolCall, result: { ...terminal, completion }, isError: false, executed: true },
    ];

    expect(createExecutedToolCallBatch([], finalized)).toMatchObject({ terminate: true, completion });
    expect(createExecutedToolCallBatch([], [{ ...finalized[0]!, isError: true }])).not.toHaveProperty("completion");
  });

  it("does not propagate completion authority from a multi-call batch", () => {
    const completion = { status: "success" as const, summary: "Verified.", files_changed: [] };
    const first: FinalizedToolCallOutcome = {
      toolCall,
      result: { ...terminal, completion },
      isError: false,
      executed: true,
    };
    const second: FinalizedToolCallOutcome = {
      toolCall: { ...toolCall, id: "tc_2" },
      result: terminal,
      isError: false,
      executed: true,
    };

    expect(createExecutedToolCallBatch([], [first, second])).not.toHaveProperty("completion");
    expect(
      createExecutedToolCallBatch([], [first, { ...second, result: { ...terminal, completion } }]),
    ).not.toHaveProperty("completion");
  });
});
