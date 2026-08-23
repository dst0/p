import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectInstructionCompilerFailureTelemetry } from "../src/core/project-instructions/compiler-attempt-diagnostics.ts";
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

const globalText = (name: string): string =>
  `Protect ${name} evidence across every task. ${"Keep this exact universal detail. ".repeat(58)}\n`;
const firstText = globalText("alpha");
const secondText = globalText("beta");
const request: ProjectInstructionCompilerRequest = {
  sources: [{ path: "/repo/AGENTS.md", content: `${firstText}${secondText}` }],
  modules: [
    {
      id: "global-controls",
      link: "rules/global-controls.md",
      title: "Global controls",
      sourcePath: "/repo/AGENTS.md",
      content: `${firstText}${secondText}`,
    },
  ],
  constraints: [
    {
      id: "forced-alpha",
      moduleId: "global-controls",
      kind: "content",
      headingContext: [],
      content: firstText,
      sourceText: firstText,
    },
    {
      id: "forced-beta",
      moduleId: "global-controls",
      kind: "content",
      headingContext: [],
      content: secondText,
      sourceText: secondText,
    },
  ],
};

function response(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: '{"alwaysOn":[]}' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 11,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  completeSimpleMock.mockReset();
  completeSimpleMock.mockResolvedValue(response());
});

describe("project instruction forced body-budget diagnostics", () => {
  it("counts deterministic always-on constraints omitted by the model", async () => {
    const expectedBodyChars = firstText.length + secondText.length - 1;
    expect(expectedBodyChars).toBeGreaterThan(3_500);

    const failure = await compileProjectInstructionsWithModel(request, { model }).catch((error: unknown) => error);

    expect(getProjectInstructionCompilerFailureTelemetry(failure)?.attemptDiagnostics).toEqual([
      expect.objectContaining({
        invariant: "body-budget",
        selectedCount: 2,
        materializedBodyChars: expectedBodyChars,
        hardLimitChars: 3_500,
      }),
      expect.objectContaining({
        invariant: "body-budget",
        selectedCount: 2,
        materializedBodyChars: expectedBodyChars,
        hardLimitChars: 3_500,
      }),
    ]);
    const firstContent = String(completeSimpleMock.mock.calls[0]?.[1].messages[0]?.content);
    const retryContent = String(completeSimpleMock.mock.calls[1]?.[1].messages[0]?.content);
    expect(retryContent.slice(firstContent.length)).toContain("selectedCount=2");
  });
});
