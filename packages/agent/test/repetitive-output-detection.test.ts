import type { AssistantMessage, Usage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { hasRepetitiveModelOutput } from "../src/agent-loop/response-processing.ts";
import { detectCompletionProtocolRepair } from "../src/agent-loop/tool-result-formatting.ts";

const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createAssistantMessage(stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: "faux",
    provider: "faux",
    model: "main",
    usage,
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

describe("hasRepetitiveModelOutput", () => {
  it("detects repetitive loop in streamed text truncated by length", () => {
    const message = createAssistantMessage("length", "streamed text entered a repetitive loop and stopped");
    expect(hasRepetitiveModelOutput(message)).toBe(true);
    expect(detectCompletionProtocolRepair(message, [], true)?.reason).toBe("repetitive_model_output");
  });

  it("detects repetitive loop in streamed reasoning truncated by length", () => {
    const message = createAssistantMessage("length", "Streamed reasoning entered a repetitive loop and was truncated");
    expect(hasRepetitiveModelOutput(message)).toBe(true);
    expect(detectCompletionProtocolRepair(message, [], true)?.reason).toBe("repetitive_model_output");
  });

  it("detects repetitive loop in streamed tool arguments truncated by length", () => {
    const message = createAssistantMessage("length", "Streamed arguments entered a repetitive loop and was truncated");
    expect(hasRepetitiveModelOutput(message)).toBe(true);
    expect(detectCompletionProtocolRepair(message, [], true)?.reason).toBe("repetitive_model_output");
  });

  it("returns false when message stopped due to max length without repetitive loop marker", () => {
    const message = createAssistantMessage("length", "max completion tokens reached");
    expect(hasRepetitiveModelOutput(message)).toBe(false);
  });

  it("returns false when length stop reason has no error message", () => {
    const message = createAssistantMessage("length", undefined);
    expect(hasRepetitiveModelOutput(message)).toBe(false);
  });

  it("returns false when stop reason is normal stop even with matching error text", () => {
    const message = createAssistantMessage("stop", "streamed text entered a repetitive loop");
    expect(hasRepetitiveModelOutput(message)).toBe(false);
  });

  it("returns false when stop reason is toolUse", () => {
    const message = createAssistantMessage("toolUse", undefined);
    expect(hasRepetitiveModelOutput(message)).toBe(false);
  });

  it("returns false when stop reason is error", () => {
    const message = createAssistantMessage("error", "network error");
    expect(hasRepetitiveModelOutput(message)).toBe(false);
  });
});
