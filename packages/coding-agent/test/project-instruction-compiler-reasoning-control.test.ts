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
  it("binds cache identity to the exact compiler reasoning-control metadata", () => {
    const input = model({ compat: { thinkingFormat: "qwen" } });
    const identity = buildProjectInstructionCompilerModelIdentity(input, "contract-v1");

    expect(matchesProjectInstructionCompilerModelIdentity(identity, input, "contract-v1")).toBe(true);
    expect(matchesProjectInstructionCompilerModelIdentity(identity, input, "contract-v2")).toBe(false);
    expect(
      matchesProjectInstructionCompilerModelIdentity(
        identity,
        model({ compat: { thinkingFormat: "qwen-chat-template" } }),
        "contract-v1",
      ),
    ).toBe(false);
    expect(matchesProjectInstructionCompilerModelIdentity(identity, model({ reasoning: false }), "contract-v1")).toBe(
      false,
    );
    expect(
      matchesProjectInstructionCompilerModelIdentity(
        identity,
        model({ compat: { thinkingFormat: "qwen" }, thinkingLevelMap: { off: "disabled" } }),
        "contract-v1",
      ),
    ).toBe(false);
    expect(
      matchesProjectInstructionCompilerModelIdentity(
        identity,
        { ...input, api: "anthropic-messages" } as Model<"anthropic-messages">,
        "contract-v1",
      ),
    ).toBe(false);
  });

  it("materializes a Qwen thinking-disable field through the actual simple-stream boundary", async () => {
    const controlled = enforceProjectInstructionCompilerReasoningControl(model({ compat: { thinkingFormat: "qwen" } }));
    let payload: Record<string, unknown> | undefined;
    const stream = streamSimpleOpenAICompletions(
      controlled,
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

    expect(controlled.compat?.thinkingFormat).toBe("qwen");
    expect(payload).toMatchObject({ enable_thinking: false });
    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("fails closed for an unknown reasoning model without an explicit off mapping", () => {
    expect(() =>
      enforceProjectInstructionCompilerReasoningControl(model({ id: "unknown-reasoner", name: "Unknown reasoner" })),
    ).toThrow(/thinking-disable compatibility/iu);
  });

  it("does not infer provider compatibility from a Qwen-looking model identity", () => {
    expect(() => enforceProjectInstructionCompilerReasoningControl(model())).toThrow(
      /thinking-disable compatibility/iu,
    );
  });

  it("rejects configured formats when the model declares thinking off unsupported", () => {
    expect(() =>
      enforceProjectInstructionCompilerReasoningControl(
        model({ compat: { thinkingFormat: "qwen" }, thinkingLevelMap: { off: null } }),
      ),
    ).toThrow(/does not support thinking off/iu);
  });

  it("preserves non-reasoning compiler models", () => {
    const input = model({ reasoning: false });
    expect(enforceProjectInstructionCompilerReasoningControl(input)).toBe(input);
  });
});
