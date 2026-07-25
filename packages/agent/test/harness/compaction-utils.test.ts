import type { Message } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  formatFileOperations,
  serializeConversation,
} from "../../src/harness/compaction/utils.ts";
import type { AgentMessage } from "../../src/types.ts";

describe("src/harness/compaction/utils.ts unit tests", () => {
  it("extractFileOpsFromMessage extracts read, write, and edit tool operations", () => {
    const fileOps = createFileOps();
    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "1", name: "read", arguments: { path: "read.txt" } },
        { type: "toolCall", id: "2", name: "write", arguments: { path: "write.txt" } },
        { type: "toolCall", id: "3", name: "edit", arguments: { path: "edit.txt" } },
        { type: "toolCall", id: "4", name: "unknown", arguments: { path: "other.txt" } },
        { type: "toolCall", id: "5", name: "read", arguments: {} }, // no path
        "invalid_block" as any,
        null as any,
      ],
      api: "openai",
      provider: "openai",
      model: "gpt-4",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    };

    extractFileOpsFromMessage(assistantMsg, fileOps);
    expect(Array.from(fileOps.read)).toEqual(["read.txt"]);
    expect(Array.from(fileOps.written)).toEqual(["write.txt"]);
    expect(Array.from(fileOps.edited)).toEqual(["edit.txt"]);

    // Non-assistant message should be ignored
    extractFileOpsFromMessage({ role: "user", content: "hi", timestamp: Date.now() }, fileOps);
  });

  it("computeFileLists and formatFileOperations format XML tags correctly", () => {
    const fileOps = createFileOps();
    fileOps.read.add("a.txt");
    fileOps.read.add("b.txt");
    fileOps.written.add("b.txt"); // b.txt is modified, so read.txt only has a.txt
    fileOps.edited.add("c.txt");

    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    expect(readFiles).toEqual(["a.txt"]);
    expect(modifiedFiles).toEqual(["b.txt", "c.txt"]);

    const formatted = formatFileOperations(readFiles, modifiedFiles);
    expect(formatted).toContain("<read-files>\na.txt\n</read-files>");
    expect(formatted).toContain("<modified-files>\nb.txt\nc.txt\n</modified-files>");

    expect(formatFileOperations([], [])).toBe("");
  });

  it("serializeConversation formats user, assistant (thinking, text, toolCall), and toolResult messages", () => {
    const circular: any = {};
    circular.self = circular;

    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "User query" }],
        timestamp: 1000,
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Deep thought" },
          { type: "text", text: "Assistant response" },
          { type: "toolCall", id: "c1", name: "func", arguments: { arg1: "val1", circ: circular } },
        ],
        api: "openai",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 1001,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "func",
        content: [{ type: "text", text: `Result: ${"X".repeat(2500)}` }],

        isError: false,
        timestamp: 1002,
      },
    ];

    const text = serializeConversation(messages);
    expect(text).toContain("[User]: User query");
    expect(text).toContain("[Assistant thinking]: Deep thought");
    expect(text).toContain("[Assistant]: Assistant response");
    expect(text).toContain('[Assistant tool calls]: func(arg1="val1", circ=[unserializable])');
    expect(text).toContain("[Tool result]: Result: ");
    expect(text).toContain("more characters truncated]");
  });

  it("handles string user content, empty tool result, and non-array assistant content", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "string user prompt",
        timestamp: 1000,
      },
      {
        role: "user",
        content: [{ type: "image" as any, mimeType: "image/png", data: "123" }],
        timestamp: 1001,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "func",
        content: [],
        isError: false,
        timestamp: 1002,
      },
    ];

    const text = serializeConversation(messages);
    expect(text).toContain("[User]: string user prompt");
    expect(text).not.toContain("[Tool result]:");

    const fileOps = createFileOps();
    extractFileOpsFromMessage(
      {
        role: "assistant",
        content: "string content" as any,
        api: "openai",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
      fileOps,
    );
  });
});
