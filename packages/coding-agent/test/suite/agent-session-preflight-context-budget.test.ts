import type { AgentTool } from "@dst0/p-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession next-request context budget", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("allows a realistic first request with the default active tools", async () => {
    let toolCount = 0;
    let serializedBytes = 0;
    let estimatedTokens = 0;
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 }],
      extensionFactories: [
        (pi) => {
          pi.on("before_agent_start", async (event) => ({
            systemPrompt: `${event.systemPrompt}\n${"s".repeat(37_132)}`,
          }));
        },
      ],
    });
    harnesses.push(harness);
    harness.setResponses([
      (context) => {
        toolCount = (context.tools ?? []).length;
        const serialized = JSON.stringify(context);
        serializedBytes = new TextEncoder().encode(serialized).length;
        estimatedTokens = Math.ceil(serialized.length / 4);
        return fauxAssistantMessage("first request completed");
      },
    ]);
    await harness.session.prompt("Inspect the project safely");
    expect(toolCount).toBeGreaterThan(5);
    expect(serializedBytes).toBeGreaterThan(48_128);
    expect(estimatedTokens + 16_384 + 1024).toBeLessThanOrEqual(65_536);
    expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
  });
  it("fails before provider invocation when static tool context cannot fit after compaction", async () => {
    let providerCalls = 0;
    const oversizedTool: AgentTool = {
      name: "oversized_static_tool",
      label: "Oversized static tool",
      description: "d".repeat(300_000),
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "unused" }], details: {} }),
    };
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 }],
      tools: [oversizedTool],
      extensionFactories: [
        (pi) => {
          pi.on("session_before_compact", async (event) => ({
            compaction: {
              summary: "Static tool context cannot be compacted.",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    });
    harnesses.push(harness);
    harness.sessionManager.appendMessage({
      role: "user",
      content: `old request ${"h".repeat(100_000)}`,
      timestamp: Date.now() - 2,
    });
    harness.sessionManager.appendMessage(fauxAssistantMessage("old response", { timestamp: Date.now() - 1 }));
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    harness.setResponses([
      () => {
        providerCalls++;
        return fauxAssistantMessage("must not run");
      },
    ]);
    await harness.session.prompt("Do not start an unsafe request");
    expect(providerCalls).toBe(0);
    expect(harness.session.agent.state.errorMessage).toContain(
      "Model-call preflight could not reserve a positive response budget.",
    );
    expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["threshold"]);
  });
  it("recomputes the provider cap after an in-run model switch", async () => {
    const noOpTool: AgentTool = {
      name: "no_op",
      label: "No op",
      description: "Complete without output",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
    };
    const harness = await createHarness({
      completionMode: "implicit",
      models: [
        { id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 },
        { id: "small-output", contextWindow: 65_536, maxTokens: 4096 },
      ],
      tools: [noOpTool],
    });
    harnesses.push(harness);
    const requestCaps: Array<number | undefined> = [];
    const requestModels: string[] = [];
    harness.setResponses([
      (context, options) => {
        requestCaps.push(options?.maxTokens);
        requestModels.push(context.messages.length > 0 ? (harness.session.model?.id ?? "") : "");
        harness.session.agent.state.model = harness.getModel("small-output")!;
        return fauxAssistantMessage(fauxToolCall("no_op", {}), { stopReason: "toolUse" });
      },
      (_context, options) => {
        requestCaps.push(options?.maxTokens);
        requestModels.push(harness.session.model?.id ?? "");
        return fauxAssistantMessage("finished");
      },
    ]);
    await harness.session.prompt("Switch models between requests");
    expect(requestModels).toEqual(["bounded-output", "small-output"]);
    expect(requestCaps).toEqual([16_384, 4096]);
  });
  it("does not execute or mark an incomplete oversized tool call complete during preflight", async () => {
    let executions = 0;
    let providerCalls = 0;
    let providerContext = "";
    const incompletePayload = "i".repeat(220_000);
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 }],
      tools: [
        {
          name: "incomplete_write",
          label: "Incomplete write",
          description: "Must execute only after a complete call",
          parameters: Type.Object({ content: Type.String() }),
          execute: async () => {
            executions++;
            return { content: [{ type: "text", text: "unexpected" }], details: {} };
          },
        },
      ],
      extensionFactories: [
        (pi) => {
          pi.on("session_before_compact", async (event) => ({
            compaction: {
              summary: "Incomplete call must remain unexecuted.",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    });
    harnesses.push(harness);
    harness.sessionManager.appendMessage({ role: "user", content: "h".repeat(100_000), timestamp: Date.now() - 3 });
    harness.sessionManager.appendMessage(
      fauxAssistantMessage(fauxToolCall("incomplete_write", { content: incompletePayload }), {
        stopReason: "aborted",
        timestamp: Date.now() - 2,
      }),
    );
    harness.sessionManager.appendMessage({ role: "user", content: "Retry safely", timestamp: Date.now() - 1 });
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    harness.setResponses([
      (context) => {
        providerCalls++;
        providerContext = JSON.stringify(context.messages);
        return fauxAssistantMessage("safe retry");
      },
    ]);
    await harness.session.prompt("Continue without executing partial work");
    expect(providerCalls).toBe(1);
    expect(executions).toBe(0);
    expect(providerContext).not.toContain("after execution completed");
    expect(JSON.stringify(harness.sessionManager.getEntries())).toContain(incompletePayload);
  });
  it("compacts before a completed large tool call can exhaust the next generation budget", async () => {
    const completedWrites: string[] = [];
    const writeTool: AgentTool = {
      name: "write_atomically",
      label: "Write atomically",
      description: "Record one complete write payload",
      parameters: Type.Object({ content: Type.String() }),
      execute: async (_toolCallId, input) => {
        const content = typeof input === "object" && input !== null && "content" in input ? input.content : undefined;
        if (typeof content !== "string") throw new Error("Expected complete write content");
        completedWrites.push(content);
        return { content: [{ type: "text", text: "write committed" }], details: {} };
      },
    };
    const harness = await createHarness({
      completionMode: "implicit",
      models: [{ id: "bounded-output", contextWindow: 65_536, maxTokens: 16_384 }],
      tools: [writeTool],
      extensionFactories: [
        (pi) => {
          pi.on("session_before_compact", async (event) => ({
            compaction: {
              summary: "Large completed write preserved by preflight compaction.",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    });
    harnesses.push(harness);
    harness.session.agent.cacheRetention = "none";
    harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "h".repeat(100_000) }],
      timestamp: Date.now() - 2,
    });
    harness.sessionManager.appendMessage(fauxAssistantMessage("History acknowledged", { timestamp: Date.now() - 1 }));
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    const writePayload = "w".repeat(52_000);
    const queuedSteer = `QUEUED_STEER_START:${"s".repeat(52_000)}:QUEUED_STEER_END`;
    const queuedFollowUp = "QUEUED_FOLLOW_UP_AFTER_COMPACTION";
    const requestMaxTokens: Array<number | undefined> = [];
    const requestInputTokens: number[] = [];
    const laterRequestContexts: string[] = [];
    harness.setResponses([
      (context, options) => {
        requestMaxTokens.push(options?.maxTokens);
        requestInputTokens.push(Math.ceil(JSON.stringify(context).length / 4));
        harness.session.agent.steer({ role: "user", content: queuedSteer, timestamp: Date.now() });
        harness.session.agent.followUp({ role: "user", content: queuedFollowUp, timestamp: Date.now() + 1 });
        return fauxAssistantMessage(fauxToolCall("write_atomically", { content: writePayload }), {
          stopReason: "toolUse",
        });
      },
      (context, options) => {
        requestMaxTokens.push(options?.maxTokens);
        requestInputTokens.push(Math.ceil(JSON.stringify(context).length / 4));
        laterRequestContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("done");
      },
      (context, options) => {
        requestMaxTokens.push(options?.maxTokens);
        requestInputTokens.push(Math.ceil(JSON.stringify(context).length / 4));
        laterRequestContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("follow-up done");
      },
    ]);
    await harness.session.prompt("Complete the write and continue");
    expect(completedWrites).toEqual([writePayload]);
    expect(requestMaxTokens).toEqual([16_384, 16_384, 16_384]);
    expect(requestInputTokens.every((tokens, index) => tokens + (requestMaxTokens[index] ?? 0) + 1024 <= 65_536)).toBe(
      true,
    );
    expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["threshold"]);
    expect(laterRequestContexts).toHaveLength(2);
    expect(laterRequestContexts[0]).toContain("Large completed write preserved by preflight compaction.");
    expect(laterRequestContexts[0]).toContain("QUEUED_STEER_START");
    expect(laterRequestContexts[0]).toContain("QUEUED_STEER_END");
    expect(laterRequestContexts[0]).not.toContain(writePayload);
    expect(laterRequestContexts[1]).toContain(queuedFollowUp);
    expect(
      harness.sessionManager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            entry.message.content.some(
              (block) => block.type === "toolCall" && block.arguments.content === writePayload,
            ),
        ),
    ).toBe(true);
    expect(
      harness.sessionManager
        .getEntries()
        .some(
          (entry) => entry.type === "message" && entry.message.role === "user" && entry.message.content === queuedSteer,
        ),
    ).toBe(true);
    expect(
      harness.sessionManager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "message" && entry.message.role === "user" && entry.message.content === queuedFollowUp,
        ),
    ).toBe(true);
  });
});
