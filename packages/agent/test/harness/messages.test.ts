import { describe, expect, it } from "vitest";
import {
  BRANCH_SUMMARY_PREFIX,
  BRANCH_SUMMARY_SUFFIX,
  bashExecutionToText,
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../../src/harness/messages.ts";
import type { AgentMessage } from "../../src/types.ts";

describe("src/harness/messages.ts unit tests", () => {
  it("bashExecutionToText handles all output/cancellation/exitCode/truncation branches", () => {
    const text1 = bashExecutionToText({
      role: "bashExecution",
      command: "ls -la",
      output: "file1.txt\nfile2.txt",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1000,
    });
    expect(text1).toContain("Ran `ls -la`");
    expect(text1).toContain("```\nfile1.txt\nfile2.txt\n```");

    const textNoOutput = bashExecutionToText({
      role: "bashExecution",
      command: "touch test",
      output: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1000,
    });
    expect(textNoOutput).toContain("(no output)");

    const textCancelled = bashExecutionToText({
      role: "bashExecution",
      command: "sleep 100",
      output: "",
      exitCode: undefined,
      cancelled: true,
      truncated: false,
      timestamp: 1000,
    });
    expect(textCancelled).toContain("(command cancelled)");

    const textExitCode = bashExecutionToText({
      role: "bashExecution",
      command: "false",
      output: "error output",
      exitCode: 2,
      cancelled: false,
      truncated: false,
      timestamp: 1000,
    });
    expect(textExitCode).toContain("Command exited with code 2");

    const textTruncated = bashExecutionToText({
      role: "bashExecution",
      command: "cat bigfile",
      output: "partial",
      exitCode: 0,
      cancelled: false,
      truncated: true,
      fullOutputPath: "/tmp/output.log",
      timestamp: 1000,
    });
    expect(textTruncated).toContain("[Output truncated. Full output: /tmp/output.log]");
  });

  it("createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage create valid objects", () => {
    const tsStr = "2026-07-25T10:00:00.000Z";
    const tsNum = new Date(tsStr).getTime();

    const branchMsg = createBranchSummaryMessage("branch summary text", "branch-1", tsStr);
    expect(branchMsg).toEqual({
      role: "branchSummary",
      summary: "branch summary text",
      fromId: "branch-1",
      timestamp: tsNum,
    });

    const compactMsg = createCompactionSummaryMessage("compact summary text", 500, tsStr);
    expect(compactMsg).toEqual({
      role: "compactionSummary",
      summary: "compact summary text",
      tokensBefore: 500,
      timestamp: tsNum,
    });

    const customMsg = createCustomMessage("custom_event", "custom text", true, { foo: "bar" }, tsStr);
    expect(customMsg).toEqual({
      role: "custom",
      customType: "custom_event",
      content: "custom text",
      display: true,
      details: { foo: "bar" },
      timestamp: tsNum,
    });
  });

  it("convertToLlm converts custom agent message types to standard LLM messages", () => {
    const messages: AgentMessage[] = [
      {
        role: "bashExecution",
        command: "echo hi",
        output: "hi",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 1000,
      },
      {
        role: "bashExecution",
        command: "secret",
        output: "hidden",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        excludeFromContext: true,
        timestamp: 1001,
      },
      {
        role: "custom",
        customType: "info",
        content: "string content",
        display: true,
        timestamp: 1002,
      },
      {
        role: "custom",
        customType: "info",
        content: [{ type: "text", text: "array content" }],
        display: true,
        timestamp: 1003,
      },
      {
        role: "branchSummary",
        summary: "summarized branch",
        fromId: "b1",
        timestamp: 1004,
      },
      {
        role: "compactionSummary",
        summary: "summarized compaction",
        tokensBefore: 1000,
        timestamp: 1005,
      },
      {
        role: "user",
        content: [{ type: "text", text: "standard user" }],
        timestamp: 1006,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "standard assistant" }],
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
        timestamp: 1007,
      },
      {
        role: "unknown_role" as any,
        content: "invalid",
        timestamp: 1008,
      },
    ];

    const llmMsgs = convertToLlm(messages);
    expect(llmMsgs).toHaveLength(7);
    expect(llmMsgs[0].role).toBe("user");
    expect((llmMsgs[0].content as any)[0].text).toContain("Ran `echo hi`");
    expect(llmMsgs[1].content).toEqual([{ type: "text", text: "string content" }]);
    expect(llmMsgs[2].content).toEqual([{ type: "text", text: "array content" }]);
    expect((llmMsgs[3].content as any)[0].text).toBe(
      `${BRANCH_SUMMARY_PREFIX}summarized branch${BRANCH_SUMMARY_SUFFIX}`,
    );
    expect((llmMsgs[4].content as any)[0].text).toBe(
      `${COMPACTION_SUMMARY_PREFIX}summarized compaction${COMPACTION_SUMMARY_SUFFIX}`,
    );
    expect(llmMsgs[5].role).toBe("user");
    expect(llmMsgs[6].role).toBe("assistant");
  });
});
