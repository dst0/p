import type { Context } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent/agent.ts";
import { streamAssistantResponse } from "../src/agent-loop/response-processing.ts";
import type { AgentContext, StreamFn } from "../src/types.ts";
import { baseConfig, createMockStream, mkAssistant, testModel } from "./response-streaming-helpers.ts";

describe("model-call preparation", () => {
  it("rebuilds the provider request once from a compacted retry context", async () => {
    const retryContext: AgentContext = {
      systemPrompt: "compacted system",
      messages: [{ role: "user", content: [{ type: "text", text: "compacted user" }], timestamp: 2 }],
      tools: [],
    };
    const context: AgentContext = {
      systemPrompt: "original system",
      messages: [{ role: "user", content: [{ type: "text", text: "original user" }], timestamp: 1 }],
      tools: [],
    };
    const attempts: number[] = [];
    const maxTokensByAttempt: Array<number | undefined> = [];
    let providerContext: Context | undefined;
    let providerMaxTokens: number | undefined;
    const final = mkAssistant("prepared");
    const streamFn: StreamFn = (model, llmContext, options) => {
      providerContext = llmContext;
      providerMaxTokens = options?.maxTokens;
      return createMockStream([{ type: "done", reason: "stop", message: final }])(model, llmContext, options);
    };

    await streamAssistantResponse(
      context,
      baseConfig({
        prepareModelCall: ({ attempt, maxTokens }) => {
          attempts.push(attempt);
          maxTokensByAttempt.push(maxTokens);
          return attempt === 0 ? { retryContext, maxTokens: 512 } : undefined;
        },
      }),
      undefined,
      async () => {},
      streamFn,
    );

    expect(attempts).toEqual([0, 1]);
    expect(maxTokensByAttempt).toEqual([undefined, 512]);
    expect(providerMaxTokens).toBe(512);
    expect(context.systemPrompt).toBe(retryContext.systemPrompt);
    expect(context.tools).toBe(retryContext.tools);
    expect(providerContext?.systemPrompt).toBe("compacted system");
    expect(providerContext?.messages).toEqual([retryContext.messages[0]]);
  });

  it("fails closed when preparation requests a second compaction", async () => {
    const context: AgentContext = { systemPrompt: "system", messages: [], tools: [] };
    const streamFn = vi.fn<StreamFn>();

    await expect(
      streamAssistantResponse(
        context,
        baseConfig({ prepareModelCall: () => ({ retryContext: { ...context } }) }),
        undefined,
        async () => {},
        streamFn,
      ),
    ).rejects.toThrow(/could not produce a request that fits after compaction/iu);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("forwards the active run signal through the Agent wrapper", async () => {
    const prepareModelCall = vi.fn();
    const agent = new Agent({ prepareModelCall });
    const input = { context: { systemPrompt: "", messages: [] }, model: testModel, attempt: 0 };

    await agent.runWithLifecycle(async (signal) => {
      await agent.createLoopConfig().prepareModelCall?.(input);
      expect(prepareModelCall).toHaveBeenCalledWith(input, signal);
    });
  });
});
