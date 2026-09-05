import type { AgentMessage } from "@dst0/p-agent-core";
import { describe, expect, test } from "vitest";
import { getMessageTextForState } from "../src/core/compaction/structured-state/message-analysis.ts";

describe("getMessageTextForState", () => {
  test("extracts text from user message string content", () => {
    const msg = { role: "user", content: "hello" } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello");
  });

  test("extracts text from user message array content", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "image", mimeType: "image/png", data: "bla" },
        { type: "text", text: "world" },
      ],
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello\nworld");
  });

  test("extracts text from custom message string content", () => {
    const msg = { role: "custom", content: "hello" } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello");
  });

  test("extracts text from custom message array content", () => {
    const msg = {
      role: "custom",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello\nworld");
  });

  test("extracts text from assistant message", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "hello" },
        { type: "toolCall", id: "1", name: "test", arguments: {} },
        { type: "text", text: "world" },
      ],
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello\nworld");
  });

  test("extracts text from toolResult message", () => {
    const msg = {
      role: "toolResult",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
      id: "1",
      name: "test",
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello\nworld");
  });

  test("handles empty array or invalid blocks gracefully", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "image" } as any, { type: "text", text: undefined } as any, { type: "text", text: "hello" }],
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello");
  });

  test("returns empty string if content is not array for assistant", () => {
    const msg = {
      role: "assistant",
      content: "hello" as any, // Technically invalid for assistant but we handle it defensively
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("");
  });

  test("formats bashExecution message", () => {
    const msg = {
      role: "bashExecution",
      command: "ls",
      output: "file.txt",
      exitCode: 0,
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("ls\nfile.txt");
  });

  test("formats branchSummary message", () => {
    const msg = {
      role: "branchSummary",
      summary: "did a thing",
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("did a thing");
  });

  test("formats compactionSummary message", () => {
    const msg = {
      role: "compactionSummary",
      summary: "did another thing",
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("did another thing");
  });
});
