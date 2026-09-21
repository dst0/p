import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileProjectInstructionsWithModel } from "../src/core/project-instructions/model-compiler.ts";
import type { ProjectInstructionCompilerRequest } from "../src/core/project-instructions/types.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return { ...actual, completeSimple: completeSimpleMock };
});

const model: Model<"openai-completions"> = {
  id: "compiler-model",
  name: "Compiler Model",
  api: "openai-completions",
  provider: "test",
  baseUrl: "https://example.invalid",
  reasoning: true,
  thinkingLevelMap: { off: "disabled", high: "high" },
  compat: { thinkingFormat: "qwen" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 8_192,
};

const request: ProjectInstructionCompilerRequest = {
  sources: [{ path: "/repo/AGENTS.md", content: "# Rules\n" }],
  modules: [
    {
      id: "1-rules-abcd1234",
      link: "rules/1-rules-abcd1234.md",
      title: "Rules",
      sourcePath: "/repo/AGENTS.md",
      content: "# Rules\n",
    },
  ],
  constraints: [],
};

function response(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: '{"alwaysOn":[]}' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

beforeEach(() => completeSimpleMock.mockReset());

describe("project instruction compiler thinking", () => {
  it("forwards enabled reasoning and normalizes an explicit off level", async () => {
    completeSimpleMock.mockResolvedValue(response());
    await compileProjectInstructionsWithModel(request, { model, reasoning: "high" });
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({ reasoning: "high" });

    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(response());
    await compileProjectInstructionsWithModel(request, { model, reasoning: "off" });
    expect(completeSimpleMock.mock.calls[0][2].reasoning).toBeUndefined();
  });
});
