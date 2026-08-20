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
};

function response(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
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
    stopReason,
    errorMessage: stopReason === "error" ? "provider failed" : undefined,
    timestamp: Date.now(),
  };
}

beforeEach(() => completeSimpleMock.mockReset());

describe("project instruction model compiler", () => {
  it("sends the full source and parses fenced JSON output", async () => {
    completeSimpleMock.mockResolvedValue(
      response('```json\n{"body":"Use read_rules.","triggers":{"1-rules-abcd1234":"Before edits"}}\n```'),
    );

    const result = await compileProjectInstructionsWithModel(request, {
      model,
      apiKey: "test-key",
      headers: { "x-test": "yes" },
      timeoutMs: 1234,
      maxTokens: 567,
    });

    expect(result).toEqual({ body: "Use read_rules.", triggers: { "1-rules-abcd1234": "Before edits" } });
    const context = completeSimpleMock.mock.calls[0][1];
    expect(context.systemPrompt).toContain("Return one JSON object only");
    expect(context.messages[0].content).toContain("Never lose this exact text.");
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: "test-key",
      headers: { "x-test": "yes" },
      timeoutMs: 1234,
      maxTokens: 567,
    });
  });

  it("rejects provider failures and malformed output", async () => {
    completeSimpleMock.mockResolvedValueOnce(response("", "error")).mockResolvedValueOnce(response("not json"));
    await expect(compileProjectInstructionsWithModel(request, { model })).rejects.toThrow("provider failed");
    await expect(compileProjectInstructionsWithModel(request, { model })).rejects.toThrow();
  });

  it("accepts a compact body without redundant trigger overrides", async () => {
    completeSimpleMock.mockResolvedValue(response('{"body":"Use read_rules."}'));

    await expect(compileProjectInstructionsWithModel(request, { model })).resolves.toEqual({
      body: "Use read_rules.",
      triggers: {},
    });
  });

  it("fails before provider invocation when complete sources exceed the model context", async () => {
    const oversizedRequest: ProjectInstructionCompilerRequest = {
      ...request,
      sources: [{ path: "/repo/AGENTS.md", content: "x".repeat(model.contextWindow + 1) }],
    };

    await expect(compileProjectInstructionsWithModel(oversizedRequest, { model })).rejects.toThrow(/context window/i);
    expect(completeSimpleMock).not.toHaveBeenCalled();
  });
});
