import { describe, expect, it } from "vitest";
import { withCompletionProtocolTools } from "../src/agent-loop/message-preparation.ts";
import {
  createFinishWorkTool,
  FINISH_WORK_SCHEMA,
  FINISH_WORK_TOOL_NAME,
  getFinishWorkPayload,
  isFinishWorkToolResult,
  normalizeFinishWorkPayload,
} from "../src/completion-protocol.ts";
import type { AgentContext, AgentMessage } from "../src/types.ts";

describe("completion-protocol unit tests", () => {
  it("exports correct constant name and schema", () => {
    expect(FINISH_WORK_TOOL_NAME).toBe("finish_work");
    expect(FINISH_WORK_SCHEMA).toBeDefined();
  });

  it("normalizeFinishWorkPayload normalizes optional array properties", () => {
    const payload = normalizeFinishWorkPayload({
      status: "success",
      summary: "Task finished",
      files_changed: [], // empty list -> undefined
      tests_run: ["test1.ts"],
      remaining_work: undefined,
      notes: "all good",
    });

    expect(payload).toEqual({
      status: "success",
      summary: "Task finished",
      files_changed: undefined,
      tests_run: ["test1.ts"],
      remaining_work: undefined,
      notes: "all good",
    });
  });

  it("createFinishWorkTool creates tool and executes valid payload", async () => {
    const tool = createFinishWorkTool();
    expect(tool.name).toBe("finish_work");
    expect(tool.executionMode).toBe("sequential");
    expect(tool.effect).toEqual({ kind: "read", risk: "normal" });

    const result = await tool.execute("call-1", {
      status: "success",
      summary: "Built all components",
      files_changed: ["src/index.ts"],
    });

    expect(result.terminate).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Built all components" }]);
    expect(result.details).toEqual({
      status: "success",
      summary: "Built all components",
      files_changed: ["src/index.ts"],
      tests_run: undefined,
      remaining_work: undefined,
      notes: undefined,
    });
  });

  it.each(["explicit_finish", "hybrid"] as const)(
    "replaces a spoofed mutating finish tool in %s mode",
    (completionMode) => {
      const ordinaryTool = { ...createFinishWorkTool(), name: "ordinary_read" } as unknown as NonNullable<
        AgentContext["tools"]
      >[number];
      const spoofedFinish = {
        ...createFinishWorkTool(),
        effect: { kind: "external_write" as const, risk: "high" as const },
      } as unknown as NonNullable<AgentContext["tools"]>[number];

      const context = withCompletionProtocolTools(
        { systemPrompt: "test", messages: [], tools: [ordinaryTool, spoofedFinish] },
        completionMode,
      );
      const finishTools = context.tools?.filter((tool) => tool.name === FINISH_WORK_TOOL_NAME) ?? [];

      expect(context.tools?.[0]).toBe(ordinaryTool);
      expect(finishTools).toHaveLength(1);
      expect(finishTools[0]?.effect).toEqual({ kind: "read", risk: "normal" });
      expect(finishTools[0]?.executionMode).toBe("sequential");
    },
  );

  it("createFinishWorkTool throws validation error for empty summary or status success with remaining_work", async () => {
    const tool = createFinishWorkTool();

    await expect(
      tool.execute("call-2", {
        status: "success",
        summary: "   ",
      }),
    ).rejects.toThrow("summary is required and must not be empty");

    await expect(
      tool.execute("call-3", {
        status: "success",
        summary: "Done but work remains",
        remaining_work: ["task 2"],
      }),
    ).rejects.toThrow('status "success" is incompatible with non-empty remaining_work');
  });

  it("isFinishWorkToolResult identifies finish_work tool result messages", () => {
    const validMsg: AgentMessage = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "finish_work",
      content: [{ type: "text", text: "Done" }],
      isError: false,
      details: { status: "success", summary: "Done" },
      timestamp: Date.now(),
    };

    const otherToolMsg: AgentMessage = {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "read_file",
      content: [{ type: "text", text: "content" }],
      isError: false,
      timestamp: Date.now(),
    };

    const userMsg: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.now(),
    };

    expect(isFinishWorkToolResult(validMsg)).toBe(true);
    expect(isFinishWorkToolResult(otherToolMsg)).toBe(false);
    expect(isFinishWorkToolResult(userMsg)).toBe(false);
    expect(isFinishWorkToolResult(undefined)).toBe(false);
  });

  it("getFinishWorkPayload extracts last finish_work payload from messages", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Do task" }],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "finish_work",
        content: [{ type: "text", text: "Partial" }],
        isError: false,
        details: { status: "partial", summary: "First attempt" },
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "finish_work",
        content: [{ type: "text", text: "Success" }],
        isError: false,
        details: { status: "success", summary: "Second attempt" },
        timestamp: 3,
      },
    ];

    const payload = getFinishWorkPayload(messages);
    expect(payload).toEqual({ status: "success", summary: "Second attempt" });

    const nonFinishMessages: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
      {
        role: "toolResult",
        toolCallId: "call-99",
        toolName: "read",
        content: [{ type: "text", text: "read result" }],
        isError: false,
        timestamp: 2,
      },
    ];
    expect(getFinishWorkPayload(nonFinishMessages)).toBeUndefined();
    expect(getFinishWorkPayload([])).toBeUndefined();
  });
});
