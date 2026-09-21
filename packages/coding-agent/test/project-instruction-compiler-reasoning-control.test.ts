import type { Model } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { streamSimpleOpenAICompletions } from "../../ai/src/providers/openai-completions/stream-simple-openai-completions.ts";
import {
  buildProjectInstructionCompilerModelIdentity,
  enforceProjectInstructionCompilerReasoningControl,
  matchesProjectInstructionCompilerModelIdentity,
} from "../src/core/project-instructions/compiler-reasoning-control.ts";

function model(overrides: Partial<Model<"openai-completions">> = {}): Model<"openai-completions"> {
  return {
    id: "qwen3.6-27b-q3km",
    name: "Qwen compiler",
    api: "openai-completions",
    provider: "private-llm",
    baseUrl: "http://compiler.invalid/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65_536,
    maxTokens: 4_096,
    ...overrides,
  };
}

describe("project instruction compiler reasoning control", () => {
  it("binds cache identity to the compiler contract and reasoning controls", () => {
    const input = model({
      compat: { thinkingFormat: "qwen", supportsReasoningEffort: true },
      thinkingLevelMap: { medium: "medium", off: "disabled" },
    });
    const identity = buildProjectInstructionCompilerModelIdentity(input, "contract-v2", "medium");

    expect(matchesProjectInstructionCompilerModelIdentity(identity, input, "contract-v2", "medium")).toBe(true);
    expect(matchesProjectInstructionCompilerModelIdentity(identity, input, "contract-v1", "medium")).toBe(false);
    expect(matchesProjectInstructionCompilerModelIdentity(identity, input, "contract-v2", "high")).toBe(false);
    expect(
      matchesProjectInstructionCompilerModelIdentity(
        identity,
        model({
          compat: { thinkingFormat: "openai", supportsReasoningEffort: true },
          thinkingLevelMap: { medium: "medium", off: "disabled" },
        }),
        "contract-v2",
        "medium",
      ),
    ).toBe(false);
  });

  it("passes enabled reasoning through the actual simple-stream boundary", async () => {
    const controlled = enforceProjectInstructionCompilerReasoningControl(model({ compat: { thinkingFormat: "qwen" } }));
    let payload: Record<string, unknown> | undefined;
    const stream = streamSimpleOpenAICompletions(
      controlled,
      { systemPrompt: "compiler", messages: [{ role: "user", content: "compile", timestamp: 1 }] },
      {
        apiKey: "test-key",
        reasoning: "medium",
        onPayload: (value) => {
          payload = value as Record<string, unknown>;
          throw new Error("stop after payload capture");
        },
      },
    );

    await stream.result();

    expect(controlled.compat?.thinkingFormat).toBe("qwen");
    expect(payload).toMatchObject({ enable_thinking: true });
    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("disables Qwen reasoning when no level is requested", async () => {
    let payload: Record<string, unknown> | undefined;
    const stream = streamSimpleOpenAICompletions(
      model({ compat: { thinkingFormat: "qwen" } }),
      { systemPrompt: "compiler", messages: [{ role: "user", content: "compile", timestamp: 1 }] },
      {
        apiKey: "test-key",
        onPayload: (value) => {
          payload = value as Record<string, unknown>;
          throw new Error("stop after payload capture");
        },
      },
    );

    await stream.result();

    expect(payload).toMatchObject({ enable_thinking: false });
    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("does not guess a reasoning control when no level is requested", async () => {
    let payload: Record<string, unknown> | undefined;
    const stream = streamSimpleOpenAICompletions(
      model(),
      { systemPrompt: "compiler", messages: [{ role: "user", content: "compile", timestamp: 1 }] },
      {
        apiKey: "test-key",
        onPayload: (value) => {
          payload = value as Record<string, unknown>;
          throw new Error("stop after payload capture");
        },
      },
    );

    await stream.result();

    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("accepts an unknown reasoning model without an explicit off mapping", () => {
    const input = model({ id: "unknown-reasoner", name: "Unknown reasoner" });
    expect(enforceProjectInstructionCompilerReasoningControl(input)).toBe(input);
  });

  it("does not infer provider compatibility from a Qwen-looking model identity", () => {
    const input = model();
    expect(enforceProjectInstructionCompilerReasoningControl(input)).toBe(input);
  });

  it("accepts configured formats when the model declares thinking off unsupported", () => {
    const input = model({ compat: { thinkingFormat: "qwen" }, thinkingLevelMap: { off: null } });
    expect(enforceProjectInstructionCompilerReasoningControl(input)).toBe(input);
  });

  it("preserves non-reasoning compiler models", () => {
    const input = model({ reasoning: false });
    expect(enforceProjectInstructionCompilerReasoningControl(input)).toBe(input);
  });
});
