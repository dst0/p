import type { AgentMessage } from "@dst0/p-agent-core";
import { describe, expect, test } from "vitest";
import { getMessageTextForState } from "../src/core/compaction/structured-state/message-analysis.ts";
import { getAgentMessageText } from "../src/core/compaction/structured-state/state-extraction.ts";

describe("structured-state message text extraction", () => {
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
      content: [{ type: "image" }, { type: "text", text: undefined }, { type: "text", text: "hello" }],
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("hello");
  });

  test("returns empty string if content is not array for assistant", () => {
    const msg = {
      role: "assistant",
      content: "hello", // Technically invalid for assistant but we handle it defensively
    } as unknown as AgentMessage;
    expect(getMessageTextForState(msg)).toBe("");
  });

  test("active extractor avoids intermediate array operations", () => {
    const content = [
      { type: "text", text: "hello" },
      { type: "image", data: "opaque-test-data", mimeType: "image/png" },
      { type: "text", text: "world" },
    ] satisfies Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
    for (const method of ["filter", "map", "join"] as const) {
      Object.defineProperty(content, method, {
        value: () => {
          throw new Error(`${method} must not be called`);
        },
      });
    }
    const message: AgentMessage = {
      role: "user",
      content,
      timestamp: 0,
    };

    expect(getAgentMessageText(message)).toBe("hello\nworld");
  });

  test("active extractor uses the shared loop for custom, assistant, and tool results", () => {
    const custom = {
      role: "custom",
      content: [{ type: "text", text: "custom" }],
    } as unknown as AgentMessage;
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text: "assistant" }],
    } as unknown as AgentMessage;
    const toolResult = {
      role: "toolResult",
      content: [{ type: "text", text: "tool result" }],
    } as unknown as AgentMessage;

    expect(getAgentMessageText(custom)).toBe("custom");
    expect(getAgentMessageText(assistant)).toBe("assistant");
    expect(getAgentMessageText(toolResult)).toBe("tool result");
  });

  test("active extractor skips non-string text blocks", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: 123 },
        { type: "text", text: "valid" },
      ],
    } as unknown as AgentMessage;

    expect(getAgentMessageText(message)).toBe("valid");
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
