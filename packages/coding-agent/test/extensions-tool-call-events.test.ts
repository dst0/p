import { describe, expect, it } from "vitest";
import {
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  isRgToolResult,
  isToolCallEventType,
  isWriteToolResult,
  type ToolCallEvent,
  type ToolResultEvent,
} from "../src/core/extensions/tool-call-events.ts";

/** Every toolName a ToolCallEvent/ToolResultEvent can carry, including a non-built-in (custom) tool. */
const ALL_TOOL_NAMES = ["bash", "read", "edit", "write", "grep", "rg", "find", "ls", "my_custom_tool"] as const;

/** Builds a real, correctly-shaped ToolCallEvent for the given tool name. */
function toolCallEvent(toolName: (typeof ALL_TOOL_NAMES)[number]): ToolCallEvent {
  const toolCallId = "call-1";
  switch (toolName) {
    case "bash":
      return { type: "tool_call", toolCallId, toolName, input: { command: "echo hi" } };
    case "read":
      return { type: "tool_call", toolCallId, toolName, input: { path: "README.md" } };
    case "edit":
      return {
        type: "tool_call",
        toolCallId,
        toolName,
        input: { path: "a.ts", edits: [{ oldText: "old", newText: "new" }] },
      };
    case "write":
      return { type: "tool_call", toolCallId, toolName, input: { path: "b.ts", content: "export {}" } };
    case "grep":
    case "rg":
      return { type: "tool_call", toolCallId, toolName, input: { pattern: "TODO" } };
    case "find":
      return { type: "tool_call", toolCallId, toolName, input: { pattern: "*.ts" } };
    case "ls":
      return { type: "tool_call", toolCallId, toolName, input: {} };
    default:
      return { type: "tool_call", toolCallId, toolName, input: { action: "list" } };
  }
}

/** Builds a real, correctly-shaped ToolResultEvent for the given tool name (details omitted: undefined). */
function toolResultEvent(toolName: (typeof ALL_TOOL_NAMES)[number]): ToolResultEvent {
  const base = {
    type: "tool_result" as const,
    toolCallId: "call-1",
    input: {},
    content: [{ type: "text" as const, text: "ok" }],
    isError: false,
  };
  switch (toolName) {
    case "bash":
    case "read":
    case "edit":
    case "write":
    case "grep":
    case "rg":
    case "find":
    case "ls":
      return { ...base, toolName, details: undefined };
    default:
      return { ...base, toolName, details: { note: "custom tool detail" } };
  }
}

const TOOL_RESULT_GUARDS: Array<{
  guardName: string;
  guard: (event: ToolResultEvent) => boolean;
  matches: readonly (typeof ALL_TOOL_NAMES)[number][];
}> = [
  { guardName: "isBashToolResult", guard: isBashToolResult, matches: ["bash"] },
  { guardName: "isReadToolResult", guard: isReadToolResult, matches: ["read"] },
  { guardName: "isEditToolResult", guard: isEditToolResult, matches: ["edit"] },
  { guardName: "isWriteToolResult", guard: isWriteToolResult, matches: ["write"] },
  { guardName: "isGrepToolResult", guard: isGrepToolResult, matches: ["grep", "rg"] },
  { guardName: "isRgToolResult", guard: isRgToolResult, matches: ["grep", "rg"] },
  { guardName: "isFindToolResult", guard: isFindToolResult, matches: ["find"] },
  { guardName: "isLsToolResult", guard: isLsToolResult, matches: ["ls"] },
];

describe("ToolResultEvent type guards", () => {
  for (const { guardName, guard, matches } of TOOL_RESULT_GUARDS) {
    it(`${guardName} returns true only for ${matches.join("/")}, false for every other toolName`, () => {
      for (const toolName of ALL_TOOL_NAMES) {
        expect(guard(toolResultEvent(toolName))).toBe((matches as readonly string[]).includes(toolName));
      }
    });
  }
});

// Each closure below pins its own literal overload of isToolCallEventType (the overloads only accept
// specific literals), so the table stays generic while every call site type-checks correctly.
const TOOL_CALL_NARROWERS: Array<{
  toolName: (typeof ALL_TOOL_NAMES)[number];
  narrow: (event: ToolCallEvent) => boolean;
}> = [
  { toolName: "bash", narrow: (event) => isToolCallEventType("bash", event) },
  { toolName: "read", narrow: (event) => isToolCallEventType("read", event) },
  { toolName: "edit", narrow: (event) => isToolCallEventType("edit", event) },
  { toolName: "write", narrow: (event) => isToolCallEventType("write", event) },
  { toolName: "grep", narrow: (event) => isToolCallEventType("grep", event) },
  { toolName: "rg", narrow: (event) => isToolCallEventType("rg", event) },
  { toolName: "find", narrow: (event) => isToolCallEventType("find", event) },
  { toolName: "ls", narrow: (event) => isToolCallEventType("ls", event) },
];

describe("isToolCallEventType", () => {
  for (const { toolName: expected, narrow } of TOOL_CALL_NARROWERS) {
    it(`narrows to ${expected} only, false for every other toolName`, () => {
      for (const toolName of ALL_TOOL_NAMES) {
        expect(narrow(toolCallEvent(toolName))).toBe(toolName === expected);
      }
    });
  }

  it("matches a custom (non-built-in) tool name via the generic overload", () => {
    const event = toolCallEvent("my_custom_tool");
    expect(isToolCallEventType<"my_custom_tool", { action: string }>("my_custom_tool", event)).toBe(true);
    expect(isToolCallEventType("bash", event)).toBe(false);
  });
});
