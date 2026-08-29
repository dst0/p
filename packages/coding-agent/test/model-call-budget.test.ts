import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { guardProviderPayloadBudget } from "../src/core/compaction/compaction/model-call-budget.ts";
import { compactCompletedToolCallArguments } from "../src/core/compaction/completed-tool-call-compaction.ts";
import {
  createModelCallContextBudgetReport,
  estimatePreparedModelCallTokens,
  getPreparedModelCallMaxTokens,
} from "../src/core/compaction/index.ts";

const model = { contextWindow: 65_536, maxTokens: 16_384 };
const settings = { enabled: true, triggerReserveTokens: 2000, triggerRatio: 1, targetContextTokens: 8000 };

describe("model-call context budget", () => {
  it("reserves advertised output plus a safety margin", () => {
    expect(createModelCallContextBudgetReport(48_129, model, settings)).toMatchObject({
      reservedOutputTokens: 16_384,
      safetyMarginTokens: 1024,
      triggerReserveTokens: 17_408,
      triggerThreshold: 48_128,
      shouldCompact: true,
    });
    expect(
      createModelCallContextBudgetReport(8001, { contextWindow: 65_536, maxTokens: 65_536 }, settings),
    ).toMatchObject({ reservedOutputTokens: 65_536, triggerThreshold: 0, shouldCompact: true });
    expect(getPreparedModelCallMaxTokens(8001, { contextWindow: 65_536, maxTokens: 65_536 }, settings)).toBe(56_511);
  });

  it("estimates a tool-less provider context", () => {
    expect(estimatePreparedModelCallTokens({ systemPrompt: "system", messages: [] })).toBeGreaterThan(0);
  });

  it("does not treat serialized bytes as tokens for a realistic unchanged baseline", () => {
    const payload = {
      instructions: "s".repeat(37_132),
      tools: [{ description: "t".repeat(15_000) }],
      max_output_tokens: 16_384,
    };
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeGreaterThan(48_128);
    expect(() => guardProviderPayloadBudget(payload, model, settings, 16_384, payload)).not.toThrow();
  });

  it("fails closed for non-ASCII payloads and missing or expanded output limits", () => {
    const certifiedPayload = { messages: "aa".repeat(13_000), max_output_tokens: 16_384 };
    const nonAsciiPayload = { messages: "😀".repeat(13_000), max_output_tokens: 16_384 };
    expect(JSON.stringify(nonAsciiPayload).length).toBe(JSON.stringify(certifiedPayload).length);
    expect(() => guardProviderPayloadBudget(nonAsciiPayload, model, settings, 16_384, certifiedPayload)).toThrow(
      "final provider payload expanded beyond its certified baseline",
    );
    expect(() => guardProviderPayloadBudget({}, model, settings, 16_384, {})).toThrow(
      "final provider payload changed the certified output limit",
    );
    expect(() =>
      guardProviderPayloadBudget({ max_tokens: 16_384 }, model, settings, 16_384, {
        config: { maxOutputTokens: 16_384 },
      }),
    ).toThrow("final provider payload changed the certified output limit");
    expect(() =>
      guardProviderPayloadBudget({ max_tokens: Number.NaN }, model, settings, 16_384, certifiedPayload),
    ).toThrow("final provider payload changed the certified output limit");
    expect(() =>
      guardProviderPayloadBudget(
        { messages: [], max_output_tokens: 65_536 },
        model,
        settings,
        16_384,
        certifiedPayload,
      ),
    ).toThrow("final provider payload changed the certified output limit");
    expect(() =>
      guardProviderPayloadBudget({ messages: [], max_output_tokens: 8192 }, model, settings, 16_384, {
        messages: [],
        max_output_tokens: 4096,
      }),
    ).toThrow("final provider payload changed the certified output limit");
    expect(() =>
      guardProviderPayloadBudget({ config: { maxOutputTokens: 4096 }, max_tokens: 16_384 }, model, settings, 16_384, {
        padding: "p".repeat(100),
        config: { maxOutputTokens: 4096 },
      }),
    ).toThrow("final provider payload changed the certified output limit");
  });

  it("never compacts an incomplete tool call", () => {
    const payload = "w".repeat(52_000);
    const message = fauxAssistantMessage(fauxToolCall("write_atomically", { content: payload }));
    expect(compactCompletedToolCallArguments([message])[0]).toBe(message);
    expect(JSON.stringify(message)).toContain(payload);
  });

  it("does not label failed tool execution as successful", () => {
    const call = fauxToolCall("write_atomically", { content: "w".repeat(52_000) });
    const compacted = compactCompletedToolCallArguments([
      fauxAssistantMessage(call),
      {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "write failed" }],
        isError: true,
        timestamp: Date.now(),
      },
    ]);
    expect(JSON.stringify(compacted)).toContain("after execution completed");
    expect(JSON.stringify(compacted)).not.toContain("successful execution");
  });
});
