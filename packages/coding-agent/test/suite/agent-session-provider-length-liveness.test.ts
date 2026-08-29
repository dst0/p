import type { AgentTool } from "@dst0/p-agent-core";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("AgentSession provider-length liveness", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("continues repeated segments until a complete tool call without executing partial calls", async () => {
    const executed: string[] = [];
    const tool: AgentTool = {
      name: "bounded_write",
      label: "Bounded write",
      description: "Record content",
      parameters: Type.Object({ content: Type.String() }),
      async execute(_toolCallId, args) {
        executed.push(String((args as { content: string }).content));
        return { content: [{ type: "text", text: "recorded" }], details: {} };
      },
    };
    const harness = await createHarness({
      completionMode: "implicit",
      tools: [tool],
      initialActiveToolNames: [tool.name],
    });
    harnesses.push(harness);
    const prefixes = ["segment one", "segment two", "segment three", "segment four", "segment five", "segment six"];
    const lengthResponses = prefixes.map((prefix, index) =>
      fauxAssistantMessage(
        [
          { type: "text" as const, text: prefix },
          fauxToolCall(tool.name, { content: `partial-${index}` }, { id: `partial-${index}` }),
        ],
        { stopReason: "length" },
      ),
    );
    const continuationGateStates: boolean[] = [];
    const captureContinuationGateState = (): void => {
      continuationGateStates.push(
        harness.session._processingQueuedProjectRuleTurn || harness.session._stateUpdateRequiredForCurrentUserTurn,
      );
    };
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type !== "message_end" || event.message.role !== "assistant" || event.message.stopReason !== "length") {
        return;
      }
      harness.session._processingQueuedProjectRuleTurn = false;
      harness.session._stateUpdateRequiredForCurrentUserTurn = false;
    });
    harness.setResponses([
      lengthResponses[0],
      ...lengthResponses.slice(1).map((response) => () => {
        captureContinuationGateState();
        return response;
      }),
      () => {
        captureContinuationGateState();
        return fauxAssistantMessage(fauxToolCall(tool.name, { content: "complete" }, { id: "complete" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("generation complete"),
    ]);

    await harness.session.prompt("Preserve every bounded segment and execute only the final complete write.");
    unsubscribe();

    const persisted = harness.sessionManager
      .getEntries()
      .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
    const lengthMessages = persisted.flatMap((message) =>
      message.role === "assistant" && message.stopReason === "length" ? [message as AssistantMessage] : [],
    );
    const terminal = persisted.at(-1);
    expect(executed).toEqual(["complete"]);
    expect(lengthMessages.map(getMessageText)).toEqual(prefixes);
    expect(
      lengthMessages.map((message) => message.content.find((part) => part.type === "toolCall")?.arguments),
    ).toEqual(prefixes.map((_prefix, index) => ({ content: `partial-${index}` })));
    expect(
      persisted.filter(
        (message) => message.role === "user" && message.metadata?.pInternal === "provider_length_continuation",
      ),
    ).toHaveLength(prefixes.length);
    expect(terminal?.role === "assistant" ? terminal.stopReason : undefined).toBe("stop");
    expect(getMessageText(terminal)).toBe("generation complete");
    expect(harness.getPendingResponseCount()).toBe(0);
    expect(continuationGateStates).toEqual(prefixes.map(() => false));
  });
});
