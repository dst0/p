import { describe, expect, it } from "vitest";
import {
  appendSubagentRuntimeArguments,
  formatParentModel,
  parseSubagentThinkingLevel,
  resolveSubagentRuntimeSettings,
} from "../examples/extensions/subagent/runtime-settings.ts";

describe("subagent extension runtime inheritance", () => {
  it("accepts supported profile thinking levels and ignores invalid values", () => {
    expect(parseSubagentThinkingLevel("off")).toBe("off");
    expect(parseSubagentThinkingLevel("high")).toBe("high");
    expect(parseSubagentThinkingLevel("turbo")).toBeUndefined();
  });

  it("inherits the exact parent model and thinking level when the profile omits them", () => {
    const settings = resolveSubagentRuntimeSettings(
      {
        tools: ["read"],
      },
      "mini-pc/qwen3.6-27b",
      "high",
    );

    expect(settings).toEqual({ model: "mini-pc/qwen3.6-27b", thinking: "high" });
  });

  it("keeps explicit profile overrides, including thinking off", () => {
    const settings = resolveSubagentRuntimeSettings(
      {
        model: "openai/gpt-5-mini",
        thinking: "off",
        tools: ["read"],
      },
      "mini-pc/qwen3.6-27b",
      "high",
    );

    expect(settings).toEqual({ model: "openai/gpt-5-mini", thinking: "off" });
  });

  it("formats the parent model with its provider exactly once", () => {
    expect(formatParentModel({ provider: "mini-pc", id: "qwen3.6-27b" })).toBe("mini-pc/qwen3.6-27b");
    expect(formatParentModel(undefined)).toBeUndefined();
  });

  it("adds inherited model and thinking flags to the actual child invocation", () => {
    const args = ["--mode", "json"];
    appendSubagentRuntimeArguments(args, { tools: ["read", "grep"] }, "mini-pc/qwen3.6-27b", "high");
    expect(args).toEqual([
      "--mode",
      "json",
      "--model",
      "mini-pc/qwen3.6-27b",
      "--tools",
      "read,grep",
      "--thinking",
      "high",
    ]);
  });
});
