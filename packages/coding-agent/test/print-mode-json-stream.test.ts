import type { AssistantMessage, ToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session/session-types.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { captureStdout, createAssistantMessage, createRuntimeHost } from "./print-mode-test-support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function createStreamingMessage(text: string, rawArgs: string): AssistantMessage {
  const message = createAssistantMessage();
  const toolCall: ToolCall & { partialArgs: string; streamIndex: number } = {
    type: "toolCall",
    id: "call-linear",
    name: "read",
    arguments: { path: rawArgs },
    partialArgs: rawArgs,
    streamIndex: 0,
  };
  message.content = [{ type: "text", text }, toolCall];
  return message;
}

describe("runPrintMode JSON stream", () => {
  it("retains terminal provider events and their final payload without a cumulative update wrapper", async () => {
    const message = createAssistantMessage({ text: "Checked result.txt against the acceptance criteria." });
    const terminal: AgentSessionEvent = {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "done", reason: "stop", message },
    };
    const expected = structuredClone([
      { type: "message_update", assistantMessageEvent: terminal.assistantMessageEvent },
      { type: "message_end", message },
    ]);
    const runtimeHost = createRuntimeHost(message, {
      promptEventBatches: [[terminal, { type: "message_end", message }]],
    });
    const stdout = captureStdout();

    expect(
      await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
        mode: "json",
        initialMessage: "Validate the result and preserve its final response payload",
      }),
    ).toBe(0);
    const output = stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(output).toEqual(expected);
  });

  it("emits bounded deltas without cumulative assistant snapshots or provider scratch arguments", async () => {
    const deltaCount = 200;
    const events: AgentSessionEvent[] = [];
    const initial = createStreamingMessage("", "");
    events.push({ type: "message_start", message: initial });

    let text = "";
    for (let index = 0; index < deltaCount; index++) {
      text += "x";
      const partial = createStreamingMessage(text, "");
      events.push({
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial },
      });
    }

    const toolStartPartial = createStreamingMessage(text, "");
    events.push({
      type: "message_update",
      message: toolStartPartial,
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: toolStartPartial },
    });

    let rawArgs = "";
    for (let index = 0; index < deltaCount; index++) {
      rawArgs += "y";
      const partial = createStreamingMessage(text, rawArgs);
      events.push({
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "y", partial },
      });
    }

    const finalMessage = createStreamingMessage(text, rawArgs);
    delete (finalMessage.content[1] as ToolCall & { partialArgs?: string }).partialArgs;
    events.push({ type: "message_end", message: finalMessage });

    const runtimeHost = createRuntimeHost(finalMessage, { promptEventBatches: [events] });
    const stdout = captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "json",
      initialMessage: "Stream a long response and tool call",
    });

    expect(exitCode).toBe(0);
    const output = stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const updates = output.filter((event) => event.type === "message_update");
    expect(updates).toHaveLength(deltaCount * 2 + 1);
    expect(Math.max(...updates.map((event) => JSON.stringify(event).length))).toBeLessThan(600);

    const textUpdates = updates.slice(0, deltaCount);
    const toolStart = updates[deltaCount];
    const toolUpdates = updates.slice(deltaCount + 1);
    expect(textUpdates.map((event) => (event.assistantMessageEvent as { delta: string }).delta).join("")).toBe(text);
    expect(toolUpdates.map((event) => (event.assistantMessageEvent as { delta: string }).delta).join("")).toBe(rawArgs);
    for (const update of updates) {
      expect(update).not.toHaveProperty("message");
      expect(update.assistantMessageEvent).not.toHaveProperty("partial");
      expect(JSON.stringify(update)).not.toContain("partialArgs");
    }
    expect(toolStart?.assistantMessageEvent).toMatchObject({
      type: "toolcall_start",
      contentIndex: 1,
      toolCall: { id: "call-linear", name: "read" },
    });
    expect(toolUpdates[0]?.assistantMessageEvent).toMatchObject({
      type: "toolcall_delta",
      contentIndex: 1,
      toolCall: { id: "call-linear", name: "read" },
    });
    expect(output.at(-1)).toMatchObject({ type: "message_end", message: { content: finalMessage.content } });
  });
});
