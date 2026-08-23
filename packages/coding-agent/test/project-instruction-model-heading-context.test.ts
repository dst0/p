import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileProjectInstructionsWithModel } from "../src/core/project-instructions/model-compiler.ts";
import type { ProjectInstructionCompilerRequest } from "../src/core/project-instructions/types.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return { ...actual, completeSimple: completeSimpleMock };
});

const model: Model<"anthropic-messages"> = {
  id: "compiler-model",
  name: "Compiler Model",
  api: "anthropic-messages",
  provider: "test",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 8_192,
};

const request: ProjectInstructionCompilerRequest = {
  sources: [{ path: "/repo/AGENTS.md", content: "# Rules\nNever lose this exact text.\n" }],
  modules: [
    {
      id: "1-rules-abcd1234",
      link: "rules/1-rules-abcd1234.md",
      title: "Rules",
      sourcePath: "/repo/AGENTS.md",
      content: "# Rules\nNever lose this exact text.\n",
    },
  ],
  constraints: [
    {
      id: "constraint-1",
      moduleId: "1-rules-abcd1234",
      kind: "content",
      headingContext: [{ id: "heading-1", content: "# Rules", sourceText: "# Rules\n" }],
      content: "Never lose this exact text.",
      sourceText: "Never lose this exact text.\n",
    },
  ],
};

function response(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "test",
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

describe("project instruction model heading context", () => {
  it("sends typed exact heading context and materializes it with an always-on child", async () => {
    completeSimpleMock.mockResolvedValue(response('```json\n{"alwaysOn":["constraint-1"]}\n```'));

    const result = await compileProjectInstructionsWithModel(request, {
      model,
      apiKey: "test-key",
      headers: { "x-test": "yes" },
      timeoutMs: 1234,
      maxTokens: 567,
    });

    expect(result.body).toBe("# Rules\nNever lose this exact text.");
    expect(result.alwaysOn).toEqual({ "constraint-1": "# Rules\nNever lose this exact text.\n" });
    const context = completeSimpleMock.mock.calls[0][1];
    expect(context.systemPrompt).toContain("heading tuples");
    expect(JSON.parse(String(context.messages[0].content))).toEqual({
      modules: [
        {
          id: "1-rules-abcd1234",
          title: "Rules",
          sourceOrdinal: 0,
          headings: [["heading-1", "# Rules"]],
          constraints: [["constraint-1", "content", ["heading-1"], "Never lose this exact text."]],
        },
      ],
    });
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: "test-key",
      headers: { "x-test": "yes" },
      timeoutMs: 1234,
      maxTokens: 567,
      temperature: 0,
    });
  });

  it("forces a non-English global child always-on when the model routes it", async () => {
    const nonEnglishRequest: ProjectInstructionCompilerRequest = {
      sources: [{ path: "/repo/AGENTS.md", content: "# Безпека\nЗахищай секрети в кожному завданні.\n" }],
      modules: [{ ...request.modules[0]!, content: "# Безпека\nЗахищай секрети в кожному завданні.\n" }],
      constraints: [
        {
          id: "constraint-1",
          moduleId: "1-rules-abcd1234",
          kind: "content",
          headingContext: [{ id: "heading-1", content: "# Безпека", sourceText: "# Безпека\n" }],
          content: "Захищай секрети в кожному завданні.",
          sourceText: "Захищай секрети в кожному завданні.\n",
        },
      ],
    };
    completeSimpleMock.mockResolvedValue(response('{"alwaysOn":[]}'));

    const result = await compileProjectInstructionsWithModel(nonEnglishRequest, { model, apiKey: "test-key" });

    expect(result.classifications.constraints).toEqual({ "constraint-1": "always-on" });
    expect(result.body).toBe("# Безпека\nЗахищай секрети в кожному завданні.");
    expect(result.triggers).toEqual({});
  });
});
