import type { AssistantMessage } from "@dst0/p-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { finalizeExecutedToolCall } from "../src/agent-loop/streaming-handler.ts";
import { prepareToolCall } from "../src/agent-loop/tool-result-formatting.ts";
import { type ResolvedToolEffect, resolveToolEffect } from "../src/tool-effects.ts";
import type { AgentContext, AgentLoopConfig, AgentTool, AgentToolCall } from "../src/types.ts";

const assistantMessage = {
  role: "assistant",
  content: [],
  stopReason: "toolUse",
  timestamp: 1,
} as unknown as AssistantMessage;

function createContext(tool: AgentTool): AgentContext {
  return { systemPrompt: "test", messages: [], tools: [tool] };
}

describe("tool effect metadata", () => {
  it("passes normalized declared effects to before and after hooks", async () => {
    const tool: AgentTool = {
      name: "send_email",
      label: "Send email",
      description: "Send a message",
      parameters: Type.Object({}),
      effect: { kind: "external_write", risk: "high", domains: ["network_send"] },
      execute: async () => ({ content: [{ type: "text", text: "sent" }], details: {} }),
    };
    const toolCall: AgentToolCall = {
      type: "toolCall",
      id: "send-1",
      name: tool.name,
      arguments: {},
    };
    const observed: ResolvedToolEffect[] = [];
    const config: AgentLoopConfig = {
      model: {} as never,
      convertToLlm: () => [],
      beforeToolCall: async ({ effect }) => {
        if (!effect) throw new Error("runtime omitted normalized before-hook effect");
        observed.push(effect);
        return undefined;
      },
      afterToolCall: async ({ effect }) => {
        if (!effect) throw new Error("runtime omitted normalized after-hook effect");
        observed.push(effect);
        return undefined;
      },
    };
    const context = createContext(tool);

    const prepared = await prepareToolCall(context, assistantMessage, toolCall, config, undefined);
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    await finalizeExecutedToolCall(
      context,
      assistantMessage,
      prepared,
      { result: { content: [], details: {} }, isError: false },
      config,
      undefined,
    );

    expect(observed).toEqual([
      { kind: "external_write", risk: "high", domains: ["network_send"], source: "declared" },
      { kind: "external_write", risk: "high", domains: ["network_send"], source: "declared" },
    ]);
  });

  it("classifies missing custom metadata as unknown high risk", async () => {
    const tool: AgentTool = {
      name: "opaque_writer",
      label: "Opaque writer",
      description: "Legacy custom tool",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: {} }),
    };
    let observed: ResolvedToolEffect | undefined;
    const toolCall: AgentToolCall = {
      type: "toolCall",
      id: "opaque-1",
      name: tool.name,
      arguments: {},
    };

    await prepareToolCall(
      createContext(tool),
      assistantMessage,
      toolCall,
      {
        model: {} as never,
        convertToLlm: () => [],
        beforeToolCall: async ({ effect }) => {
          observed = effect;
          return undefined;
        },
      },
      undefined,
    );

    expect(observed).toEqual({ kind: "unknown", risk: "high", domains: [], source: "default_unknown" });
  });

  it("rejects malformed domains and ignores untrusted source claims", () => {
    expect(
      resolveToolEffect({
        kind: "read",
        risk: "normal",
        domains: ["not_a_domain"],
        source: "builtin",
      } as never),
    ).toEqual({ kind: "unknown", risk: "high", domains: [], source: "default_unknown" });
    expect(
      resolveToolEffect({ kind: "external_write", risk: "high", domains: [], source: "builtin" } as never),
    ).toMatchObject({ source: "declared" });
  });

  it("copies and freezes declarations before exposing them to hooks", () => {
    const domains = ["network_send"] as const;
    const declaration = { kind: "external_write" as const, risk: "high" as const, domains: [...domains] };
    const resolved = resolveToolEffect(declaration);
    declaration.domains.length = 0;

    expect(resolved.domains).toEqual(["network_send"]);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.domains)).toBe(true);
  });
});
