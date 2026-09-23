import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}

const model: Model<"openai-responses"> = {
  id: "mock",
  name: "mock",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 2048,
};

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

const readTool: AgentTool = {
  name: "read",
  label: "Read",
  description: "Read a file",
  parameters: Type.Object({ path: Type.String() }),
  async execute() {
    return { content: [{ type: "text", text: "contents" }], details: undefined };
  },
};

/** Runs a model that answers from `respond(callIndex)` until the loop stops, with a hard safety cap. */
async function run(respond: (call: number) => AssistantMessage, config: Partial<AgentLoopConfig> = {}) {
  const events: AgentEvent[] = [];
  let calls = 0;
  const stream = agentLoop(
    [{ role: "user", content: "fix the bug", timestamp: Date.now() }],
    { systemPrompt: "", messages: [], tools: [readTool] },
    {
      model,
      completionMode: "explicit_finish",
      convertToLlm: (messages: AgentMessage[]) => messages as Message[],
      ...config,
    },
    undefined,
    () => {
      calls++;
      if (calls > 50) throw new Error("repair loop is unbounded");
      const message = respond(calls);
      const response = new MockAssistantStream();
      queueMicrotask(() =>
        response.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }),
      );
      return response;
    },
  );
  for await (const event of stream) events.push(event);
  const messages = await stream.result();
  const last = messages.at(-1);
  const protocol = events.filter(
    (event): event is Extract<AgentEvent, { type: "completion_protocol" }> => event.type === "completion_protocol",
  );
  return { calls, last, protocol };
}

const text = () => assistant([{ type: "text", text: "It is fixed." }], "stop");
const read = (call: number) =>
  assistant([{ type: "toolCall", id: `read-${call}`, name: "read", arguments: { path: "a.ts" } }], "toolUse");

describe("explicit completion repair limits", () => {
  it("stops a text-only model after three repairs with a user-facing reason", async () => {
    const { calls, last, protocol } = await run(text);

    expect(calls).toBe(4);
    expect(protocol.map((event) => event.event)).toEqual([
      "completion_mode",
      "missing_finish_work_retry",
      "missing_finish_work_retry",
      "missing_finish_work_retry",
      "no_progress_stop",
    ]);
    expect(
      protocol.filter((event) => event.event === "missing_finish_work_retry").map((event) => event.maxRetries),
    ).toEqual([3, 3, 3]);
    expect(last?.role).toBe("assistant");
    expect(last?.role === "assistant" && last.stopReason).toBe("error");
    expect(last?.role === "assistant" && last.errorMessage).toBe(
      "Agent stopped because the model answered 4 times in a row without calling `finish_work` to complete the task. Its last answer is shown above; reply to continue.",
    );
  });

  it("resets the repair budget whenever a tool call makes progress", async () => {
    const script = [text, text, text, read, text, text, text, text];
    const { calls, protocol } = await run((call) => script[call - 1]!(call));

    expect(calls).toBe(8);
    expect(protocol.filter((event) => event.event === "missing_finish_work_retry")).toHaveLength(6);
    expect(protocol.at(-1)?.event).toBe("no_progress_stop");
  });

  it("stops a model whose tool calls never make progress", async () => {
    const failing = (call: number) =>
      assistant([{ type: "toolCall", id: `missing-${call}`, name: "missing_tool", arguments: {} }], "toolUse");
    const { calls, last } = await run(failing);

    expect(calls).toBe(6);
    expect(last?.role === "assistant" && last.errorMessage).toBe(
      "Agent stopped because the model did not call `finish_work` and made no progress for 6 turns.",
    );
  });

  it("stops a model that keeps returning empty responses and names that cause", async () => {
    const empty = () => assistant([], "stop");
    const { calls, last } = await run(empty);

    expect(calls).toBe(4);
    expect(last?.role === "assistant" && last.errorMessage).toBe(
      "Agent stopped because the provider returned 4 empty responses without a valid tool call.",
    );
  });

  it("honors explicit limits over the defaults", async () => {
    const { calls } = await run(text, { completionLimits: { maxMissingFinishRetries: 1 } });

    expect(calls).toBe(2);
  });
});
