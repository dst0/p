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

const request: ProjectInstructionCompilerRequest = {
  sources: [{ path: "/repo/AGENTS.md", content: "Deploy after checks.\nProtect evidence across every task.\n" }],
  modules: [
    { id: "module-one", link: "rules/one.md", title: "Deploy", sourcePath: "/repo/AGENTS.md", content: "" },
    { id: "module-two", link: "rules/two.md", title: "Safety", sourcePath: "/repo/AGENTS.md", content: "" },
  ],
  constraints: [
    {
      id: "constraint-one",
      moduleId: "module-one",
      kind: "content",
      headingContext: [],
      content: "Deploy after checks.",
      sourceText: "Deploy after checks.",
    },
    {
      id: "constraint-two",
      moduleId: "module-two",
      kind: "content",
      headingContext: [],
      content: "Protect evidence across every task.",
      sourceText: "Protect evidence across every task.",
    },
  ],
};

function response(value: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

beforeEach(() => completeSimpleMock.mockReset());

describe("project instruction compiler attempt diagnostics", () => {
  it("reports only granular safe failure kinds for each invalid response stage", async () => {
    const cases = [
      ["not json", "envelope"],
      [{ classifications: {} }, "root-schema"],
      [{ alwaysOn: ["private-unknown-constraint"] }, "constraint-set"],
      [{ alwaysOn: ["constraint-one", "constraint-one"] }, "constraint-set"],
    ] as const;
    for (const [value, kind] of cases) {
      completeSimpleMock.mockReset();
      completeSimpleMock.mockResolvedValue(response(value));
      const failure = await compileProjectInstructionsWithModel(request, { model }).catch((error: unknown) => error);
      expect(getProjectInstructionCompilerFailureTelemetry(failure)).toMatchObject({
        attemptCount: 2,
        failureKinds: [kind, kind],
        usage: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, total: 10 },
      });
      expect(String(failure)).not.toMatch(/module-one|constraint-one|private-unknown/iu);
    }
  });

  it("preserves ordered failure kinds across the single retry", async () => {
    completeSimpleMock
      .mockResolvedValueOnce(response("not json"))
      .mockResolvedValueOnce(response({ alwaysOn: ["private-unknown-constraint"] }));
    const failure = await compileProjectInstructionsWithModel(request, { model }).catch((error: unknown) => error);
    expect(getProjectInstructionCompilerFailureTelemetry(failure)?.failureKinds).toEqual([
      "envelope",
      "constraint-set",
    ]);
  });
});
