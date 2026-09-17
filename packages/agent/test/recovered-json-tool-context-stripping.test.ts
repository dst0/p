import type { AssistantMessage } from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { extractMisplacedToolCalls } from "../src/agent-loop/tool-dispatch.ts";
import {
  recoverMisplacedToolCalls,
  removeRecoveredJsonToolCallBlocks,
  removeRecoveredToolCallMarkup,
} from "../src/agent-loop/tool-execution.ts";
import type { AgentTool } from "../src/types.ts";

const toolNames = new Set(["echo"]);

function jsonFence(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

function assistantMessage(content: string | AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "Echo",
  parameters: Type.Object({ value: Type.String() }),
  execute: async () => ({ content: [], details: {} }),
};

describe("recovered JSON tool context stripping", () => {
  it("preserves unrecovered and unknown JSON blocks", () => {
    const text = `Data:\n${jsonFence({ total: 42, items: [] })}\nUnknown:\n${jsonFence({ name: "unknown_tool", arguments: {} })}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it("preserves a block containing known and unknown calls", () => {
    const value = [
      { name: "echo", arguments: { value: "known" } },
      { name: "unknown_tool", arguments: { secret: "KEEP" } },
    ];
    const text = `Mixed calls:\n${jsonFence(value)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it("preserves a block containing a known call and non-call data", () => {
    const value = [{ name: "echo", arguments: { value: "known" } }, { evidence: "KEEP" }];
    const text = `Mixed action and data:\n${jsonFence(value)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it.each([
    [
      "known and unknown calls",
      [
        { name: "echo", arguments: { value: "known" } },
        { name: "unknown_tool", arguments: { evidence: "KEEP" } },
      ],
    ],
    ["a known call and non-call data", [{ name: "echo", arguments: { value: "known" } }, { evidence: "KEEP" }]],
  ])("does not partially recover a block containing %s", (_label, value) => {
    const message = assistantMessage(jsonFence(value));
    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("preserves a tool-call wrapper containing unrelated sibling data", () => {
    const value = {
      tool_calls: [{ name: "echo", arguments: { value: "known" } }],
      final_answer: "KEEP THIS",
    };
    const text = `Mixed wrapper:\n${jsonFence(value)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it.each([
    [
      "multiple tool-list aliases",
      {
        tool_calls: [{ name: "echo", arguments: { value: "first" } }],
        tools: [{ name: "echo", arguments: { value: "KEEP SECOND" } }],
      },
    ],
    [
      "an ignored scalar tool-list alias",
      { tool_calls: [{ name: "echo", arguments: { value: "first" } }], toolCalls: "KEEP" },
    ],
    ["multiple direct argument aliases", { name: "echo", arguments: { value: "first" }, input: { evidence: "KEEP" } }],
    [
      "multiple nested argument aliases",
      { function: { name: "echo", arguments: { value: "first" }, input: { evidence: "KEEP" } } },
    ],
    [
      "nested and outer argument aliases",
      { function: { name: "echo", arguments: { value: "first" } }, input: { evidence: "KEEP" } },
    ],
    ["multiple name aliases", { name: "echo", tool: "KEEP", arguments: { value: "first" } }],
  ])("preserves a recognized envelope with %s", (_label, value) => {
    const text = `Alias collision:\n${jsonFence(value)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it.each([
    ["a non-JSON argument string", { name: "echo", arguments: "KEEP THIS" }],
    ["an argument array", { name: "echo", input: ["KEEP THIS"] }],
    ["a nested non-JSON argument string", { function: { name: "echo", arguments: "KEEP THIS" } }],
    ["an outer scalar argument", { function: { name: "echo" }, arguments: 42 }],
    ["an unknown type", { name: "echo", arguments: {}, type: "KEEP" }],
    ["a non-string id", { name: "echo", arguments: {}, id: { evidence: "KEEP" } }],
  ])("preserves a recognized envelope containing %s", (_label, value) => {
    const text = `Invalid envelope:\n${jsonFence(value)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text);
  });

  it("removes a losslessly parsed OpenAI function envelope", () => {
    const value = {
      id: "call_1",
      type: "function",
      function: { name: "echo", arguments: JSON.stringify({ value: "parsed" }) },
    };
    expect(removeRecoveredJsonToolCallBlocks(jsonFence(value), toolNames)).toBe("");
  });

  it("removes a fully recovered raw JSON text block", () => {
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "raw text" } });
    const recovered = recoverMisplacedToolCalls(assistantMessage(rawJson), [echoTool]);

    expect(recovered.content).toHaveLength(1);
    expect(recovered.content[0]).toMatchObject({
      type: "toolCall",
      name: "echo",
      arguments: { value: "raw text" },
    });
  });

  it("removes a fully recovered raw JSON thinking block", () => {
    const thinking = JSON.stringify({ name: "echo", arguments: { value: "raw thinking" } });
    const recovered = recoverMisplacedToolCalls(assistantMessage([{ type: "thinking", thinking }]), [echoTool]);

    expect(recovered.content).toHaveLength(1);
    expect(recovered.content[0]).toMatchObject({
      type: "toolCall",
      name: "echo",
      arguments: { value: "raw thinking" },
    });
  });

  it("does not recover a JSON fence closed by a shorter marker", () => {
    const text = `\`\`\`\`json\n${JSON.stringify({ name: "echo", arguments: { value: "preserved" } })}\n\`\`\``;
    const message = assistantMessage(text);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("does not expose trailing JSON through a shorter fence marker", () => {
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "still fenced" } });
    const text = `\`\`\`\`json\nnot a tool call\n\`\`\`\n${rawJson}`;
    const message = assistantMessage(text);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("does not close a markdown fence when marker text has a non-whitespace suffix", () => {
    const toolJson = JSON.stringify({ name: "echo", arguments: { value: "still fenced" } });
    const text = `\`\`\`text\nstill code\n\`\`\`still-code\n<tool_call>${toolJson}</tool_call>`;
    const message = assistantMessage(text);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("does not assemble an XML tool call across a markdown fence", () => {
    const toolJson = JSON.stringify({ value: "must not run" });
    const text = `<tool_call><function=echo>\n\`\`\`text\nexample\n\`\`\`\n<arguments>${toolJson}</arguments></function></tool_call>`;
    const message = assistantMessage(text);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("does not recover XML assembled across separate content blocks", () => {
    const message = assistantMessage([
      {
        type: "text",
        text: `<tool_call><function=echo><arguments>${JSON.stringify({ value: "cross block" })}</arguments></function>`,
      },
      { type: "text", text: "</tool_call>" },
    ]);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("preserves unrecovered XML-shaped data beside a recovered JSON block", () => {
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "run" } });
    const xmlShapedData = "Before <tool_call>KEEP THIS</tool_call> after";
    const recovered = recoverMisplacedToolCalls(
      assistantMessage([
        { type: "text", text: rawJson },
        { type: "text", text: xmlShapedData },
      ]),
      [echoTool],
    );

    expect(recovered.content[0]).toEqual({ type: "text", text: xmlShapedData });
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
  });

  it("does not partially recover XML containing unrelated sibling data", () => {
    const xml = `<tool_call><function=echo><arguments>${JSON.stringify({ value: "run" })}</arguments></function><note>KEEP</note></tool_call>`;
    const message = assistantMessage(xml);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("preserves raw JSON beside XML when only the XML call was recovered", () => {
    const xml = `<tool_call><function=echo><arguments>${JSON.stringify({ value: "xml" })}</arguments></function></tool_call>`;
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "raw" } });
    const recovered = recoverMisplacedToolCalls(assistantMessage(`${xml}\n${rawJson}`), [echoTool]);

    expect(recovered.content[0]).toEqual({ type: "text", text: rawJson });
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
    expect(recovered.content[1]).toMatchObject({ name: "echo", arguments: { value: "xml" } });
  });

  it("does not recover raw JSON beside an unrelated markdown fence", () => {
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "raw" } });
    const message = assistantMessage(`\`\`\`bash\necho example\n\`\`\`\n${rawJson}`);

    expect(recoverMisplacedToolCalls(message, [echoTool])).toEqual(message);
  });

  it("preserves raw JSON beside a separately recovered fenced call", () => {
    const rawJson = JSON.stringify({ name: "echo", arguments: { value: "raw" } });
    const fencedJson = jsonFence({ name: "echo", arguments: { value: "fenced" } });
    const recovered = recoverMisplacedToolCalls(assistantMessage(`${fencedJson}\n${rawJson}`), [echoTool]);

    expect(recovered.content[0]).toEqual({ type: "text", text: rawJson });
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
    expect(recovered.content[1]).toMatchObject({ name: "echo", arguments: { value: "fenced" } });
  });

  it("deduplicates deeply nested cross-format calls without overflowing", () => {
    const argumentsJson = `${'{"child":'.repeat(6_000)}0${"}".repeat(6_000)}`;
    const xml = `<tool_call><function=echo><arguments>${argumentsJson}</arguments></function></tool_call>`;
    const json = jsonFence({
      tool_calls: [{ id: "call_1", type: "function", function: { name: "echo", arguments: argumentsJson } }],
    });

    const recovered = recoverMisplacedToolCalls(assistantMessage(`${xml}\n${json}`), [echoTool]);
    expect(recovered.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
  });

  it("removes fully recovered blocks while preserving data blocks", () => {
    const text = `Step 1:\n${jsonFence({ name: "echo", arguments: { value: "part1" } })}\nStep 2:\n${jsonFence({ data: true })}\nStep 3:\n${jsonFence({ name: "echo", arguments: { value: "part3" } })}\nFinished.`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(
      `Step 1:\n\nStep 2:\n${jsonFence({ data: true })}\nStep 3:\n\nFinished.`,
    );
  });

  it("preserves an unterminated markdown fence while stripping nothing from it", () => {
    const text = `Before\n${jsonFence({ name: "echo", arguments: { value: "open" } }).slice(0, -3)}`;
    expect(removeRecoveredJsonToolCallBlocks(text, toolNames)).toBe(text.trim());
  });

  it("preserves native tool-call blocks while cleaning textual recovery markup", () => {
    const message = assistantMessage([
      { type: "toolCall", id: "native", name: "echo", arguments: { value: "native" } },
      { type: "text", text: "keep this explanation" },
    ]);

    expect(removeRecoveredToolCallMarkup(message, toolNames)).toEqual(message);
  });

  it("ignores native tool calls while recovering textual JSON", () => {
    const message = assistantMessage([
      { type: "toolCall", id: "native", name: "echo", arguments: { value: "native" } },
      { type: "text", text: JSON.stringify({ name: "echo", arguments: { value: "recovered" } }) },
    ]);
    expect(extractMisplacedToolCalls(message, [echoTool])).toEqual([
      expect.objectContaining({ name: "echo", arguments: { value: "recovered" } }),
    ]);
  });
});
