import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  EventStream,
  type Message,
  type Model,
} from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import { FINISH_WORK_TOOL_NAME } from "../src/completion-protocol.ts";
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

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop") {
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
  } satisfies AssistantMessage;
}

const text = (value: string, stopReason: AssistantMessage["stopReason"] = "stop") =>
  assistant([{ type: "text", text: value }], stopReason);
const toolCall = (id: string, name: string, args: Record<string, unknown>) =>
  assistant([{ type: "toolCall", id, name, arguments: args }], "toolUse");

const editTool: AgentTool = {
  name: "edit",
  label: "Edit",
  description: "Edit a file",
  parameters: Type.Object({ path: Type.String() }),
  async execute() {
    return { content: [{ type: "text", text: "edited" }], details: undefined };
  },
};

async function run(responses: AssistantMessage[], config: Partial<AgentLoopConfig>) {
  const contexts: Context[] = [];
  const events: AgentEvent[] = [];
  let index = 0;
  const stream = agentLoop(
    [{ role: "user", content: "do the task", timestamp: Date.now() }],
    { systemPrompt: "", messages: [], tools: [editTool] },
    {
      model,
      convertToLlm: (messages: AgentMessage[]) => messages as Message[],
      ...config,
    },
    undefined,
    (_model, context) => {
      contexts.push(context);
      const message = responses[index++];
      if (!message) throw new Error(`Missing scripted response ${index}`);
      const response = new MockAssistantStream();
      queueMicrotask(() =>
        response.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }),
      );
      return response;
    },
  );
  for await (const event of stream) events.push(event);
  const messages = await stream.result();
  const protocolEvents = events.filter(
    (event): event is Extract<AgentEvent, { type: "completion_protocol" }> => event.type === "completion_protocol",
  );
  return { contexts, messages, protocolEvents };
}

function repairTexts(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "user" && message.metadata?.pInternal === "completion_protocol_repair"
      ? [JSON.stringify(message.content)]
      : [],
  );
}

describe("completion mode escalation within a run", () => {
  it("switches an implicit run to explicit_finish from a turn update", async () => {
    const { contexts, messages, protocolEvents } = await run(
      [
        toolCall("edit-1", "edit", { path: "src/a.ts" }),
        text("All done."),
        toolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "partial", summary: "edited src/a.ts" }),
      ],
      { completionMode: "implicit", prepareNextTurn: () => ({ completionMode: "explicit_finish" }) },
    );

    expect(contexts).toHaveLength(3);
    expect(contexts[0]?.tools?.map((tool) => tool.name)).toEqual(["edit"]);
    expect(contexts[1]?.tools?.map((tool) => tool.name)).toEqual(["edit", FINISH_WORK_TOOL_NAME]);
    expect(protocolEvents.map((event) => [event.event, event.completionMode])).toEqual([
      ["completion_mode", "explicit_finish"],
      ["missing_finish_work_retry", "explicit_finish"],
      ["finish_work_called", "explicit_finish"],
    ]);
    expect(repairTexts(messages)).toHaveLength(1);
  });

  it("keeps the current protocol when the turn update omits the completion mode", async () => {
    const { contexts, protocolEvents } = await run(
      [toolCall("edit-1", "edit", { path: "src/a.ts" }), text("All done.")],
      { completionMode: "implicit", prepareNextTurn: () => ({}) },
    );

    expect(contexts).toHaveLength(2);
    expect(protocolEvents).toEqual([]);
  });

  it("ends on a text answer after switching back to implicit, without announcing the switch", async () => {
    const { contexts, messages, protocolEvents } = await run(
      [toolCall("edit-1", "edit", { path: "src/a.ts" }), text("All done.")],
      { completionMode: "explicit_finish", prepareNextTurn: () => ({ completionMode: "implicit" }) },
    );

    expect(contexts).toHaveLength(2);
    expect(repairTexts(messages)).toEqual([]);
    expect(protocolEvents.map((event) => event.event)).toEqual(["completion_mode"]);
  });

  it("accepts a non-empty text answer as completion when the hook allows it", async () => {
    let hookCalls = 0;
    const { contexts, messages, protocolEvents } = await run([text("391")], {
      completionMode: "explicit_finish",
      allowImplicitCompletion: () => {
        hookCalls++;
        return true;
      },
    });

    expect(contexts).toHaveLength(1);
    expect(hookCalls).toBe(1);
    expect(repairTexts(messages)).toEqual([]);
    expect(protocolEvents.map((event) => event.event)).toEqual(["completion_mode"]);
  });

  it("repairs the text answer when the hook declines", async () => {
    const { contexts, messages } = await run(
      [text("done"), toolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "success", summary: "done" })],
      { completionMode: "explicit_finish", allowImplicitCompletion: () => false },
    );

    expect(contexts).toHaveLength(2);
    expect(repairTexts(messages)).toHaveLength(1);
  });

  it("never accepts an empty answer, even when the hook allows implicit completion", async () => {
    let hookCalls = 0;
    const { contexts, messages } = await run([text("   "), text("391")], {
      completionMode: "explicit_finish",
      allowImplicitCompletion: () => {
        hookCalls++;
        return true;
      },
    });

    expect(contexts).toHaveLength(2);
    expect(repairTexts(messages)).toHaveLength(1);
    expect(hookCalls).toBe(1);
  });

  it("does not consult the hook for tool turns or truncated answers", async () => {
    let hookCalls = 0;
    const { contexts } = await run(
      [toolCall("edit-1", "edit", { path: "src/a.ts" }), text("partial ans", "length"), text("wer: done")],
      {
        completionMode: "explicit_finish",
        allowImplicitCompletion: () => {
          hookCalls++;
          return true;
        },
      },
    );

    expect(contexts).toHaveLength(3);
    expect(hookCalls).toBe(1);
  });

  it("restarts the protocol turn budget when a run switches into explicit completion", async () => {
    const { contexts, protocolEvents } = await run(
      [
        toolCall("edit-1", "edit", { path: "src/a.ts" }),
        toolCall("edit-2", "edit", { path: "src/b.ts" }),
        toolCall("edit-3", "edit", { path: "src/c.ts" }),
        toolCall("finish-1", FINISH_WORK_TOOL_NAME, { status: "partial", summary: "edited three files" }),
      ],
      {
        completionMode: "implicit",
        completionLimits: { maxTurns: 2 },
        prepareNextTurn: ({ toolResults }) =>
          toolResults.some((result) => result.toolCallId === "edit-2") ? { completionMode: "explicit_finish" } : {},
      },
    );

    expect(contexts).toHaveLength(4);
    expect(protocolEvents.map((event) => event.event)).toEqual(["completion_mode", "finish_work_called"]);
  });

  it("accepts the hooked text answer in hybrid mode too, and passes the repair count", async () => {
    const seen: number[] = [];
    const { contexts } = await run([text("first"), text("second")], {
      completionMode: "hybrid",
      allowImplicitCompletion: ({ missingFinishRetries }) => {
        seen.push(missingFinishRetries);
        return missingFinishRetries > 0;
      },
    });

    expect(contexts).toHaveLength(2);
    expect(seen).toEqual([0, 1]);
  });
});
