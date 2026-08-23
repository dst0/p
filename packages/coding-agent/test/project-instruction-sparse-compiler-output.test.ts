import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidProjectInstructionTrigger } from "../src/core/project-instructions/compiler-validation.ts";
import { compileProjectInstructionsWithModel } from "../src/core/project-instructions/model-compiler.ts";
import type {
  ProjectInstructionCompilerRequest,
  ProjectInstructionConstraintInput,
} from "../src/core/project-instructions/types.ts";

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

function constraint(
  id: string,
  moduleId: string,
  content: string,
  headingContext: ProjectInstructionConstraintInput["headingContext"] = [],
): ProjectInstructionConstraintInput {
  return { id, moduleId, kind: "content", headingContext, content, sourceText: `${content}\n` };
}

function requestFixture(): ProjectInstructionCompilerRequest {
  const heading = { id: "heading-delivery", content: "## Delivery", sourceText: "## Delivery\n" };
  const constraints = [
    constraint("constraint-a", "module-one", "Deploy releases after verification.", [heading]),
    constraint("constraint-b", "module-two", "Protect evidence across every task."),
    constraint("constraint-c", "module-one", "Run focused calculator tests.", [heading]),
  ];
  return {
    sources: [{ path: "/repo/AGENTS.md", content: constraints.map(({ sourceText }) => sourceText).join("") }],
    modules: [
      {
        id: "module-one",
        link: "rules/module-one.md",
        title: "Delivery",
        sourcePath: "/repo/AGENTS.md",
        sourceOrdinal: 3,
        content: "",
      },
      {
        id: "module-two",
        link: "rules/module-two.md",
        title: "Safety",
        sourcePath: "/repo/AGENTS.md",
        sourceOrdinal: 7,
        content: "",
      },
    ],
    constraints,
  };
}

function response(value: unknown, usage = 2): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: usage,
      output: usage,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage * 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function activityTerms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
}

beforeEach(() => completeSimpleMock.mockReset());

describe("project instruction sparse compiler output", () => {
  it("derives exhaustive classifications, exact bodies, and stable source-grounded triggers from selected ids", async () => {
    const request = requestFixture();
    completeSimpleMock.mockResolvedValue(response({ alwaysOn: ["constraint-c"] }));

    const first = await compileProjectInstructionsWithModel(request, { model });
    const second = await compileProjectInstructionsWithModel(request, { model });

    expect(first.classifications.constraints).toEqual({
      "constraint-a": "routed",
      "constraint-b": "always-on",
      "constraint-c": "always-on",
    });
    expect(first.classifications.modules).toEqual({ "module-one": "always-on", "module-two": "always-on" });
    expect(first.alwaysOn).toEqual({
      "constraint-b": "Protect evidence across every task.\n",
      "constraint-c": "## Delivery\nRun focused calculator tests.\n",
    });
    expect(first.body).toContain("Protect evidence across every task.");
    expect(first.body).toContain("## Delivery\nRun focused calculator tests.");
    expect(first.triggers).toEqual(second.triggers);
    expect(Object.keys(first.triggers)).toEqual(["module-one"]);
    const trigger = first.triggers["module-one"]!;
    const sourceTerms = activityTerms("## Delivery Deploy releases after verification.");
    expect(isValidProjectInstructionTrigger(trigger)).toBe(true);
    expect(trigger.length).toBeLessThanOrEqual(180);
    expect([...activityTerms(trigger)].some((term) => sourceTerms.has(term))).toBe(true);
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a production-shaped full input together and omits positional wire ordinals", async () => {
    const counts = [0, ...Array.from({ length: 15 }, () => 8), 7, 7, 47];
    const modules = counts.map((_, index) => ({
      id: `module-${index}`,
      link: `rules/module-${index}.md`,
      title: `Module ${index}`,
      sourcePath: "/repo/AGENTS.md",
      sourceOrdinal: index + 11,
      content: "",
    }));
    let ordinal = 0;
    const constraints = counts.flatMap((count, moduleIndex) =>
      Array.from({ length: count }, () => {
        const index = ordinal++;
        return constraint(`constraint-${index}`, `module-${moduleIndex}`, `Run focused compiler check ${index}.`, [
          {
            id: `heading-${moduleIndex}`,
            content: `## Module ${moduleIndex}`,
            sourceText: `## Module ${moduleIndex}\n`,
          },
        ]);
      }),
    );
    const request: ProjectInstructionCompilerRequest = {
      sources: [{ path: "/repo/AGENTS.md", content: constraints.map(({ sourceText }) => sourceText).join("") }],
      modules,
      constraints,
    };
    completeSimpleMock.mockResolvedValue(response({ alwaysOn: [] }));

    const result = await compileProjectInstructionsWithModel(request, { model });

    expect(counts).toHaveLength(19);
    expect(constraints).toHaveLength(181);
    expect(counts.at(-1)).toBe(47);
    expect(Object.values(result.classifications.constraints)).toHaveLength(181);
    expect(Object.values(result.classifications.constraints).every((scope) => scope === "routed")).toBe(true);
    expect(result.classifications.modules["module-0"]).toBe("always-on");
    expect(Object.keys(result.triggers)).toHaveLength(18);
    expect(completeSimpleMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(completeSimpleMock.mock.calls[0][1].messages[0].content)) as {
      modules: Array<Record<string, unknown>>;
    };
    expect(payload.modules).toHaveLength(19);
    expect(payload.modules.every((module) => !("wireOrdinal" in module))).toBe(true);
    expect(payload.modules[18]).toEqual({
      id: "module-18",
      title: "Module 18",
      sourceOrdinal: 29,
      headings: [["heading-18", "## Module 18"]],
      constraints: constraints
        .slice(-47)
        .map(({ id, kind, headingContext, content }) => [
          id,
          kind,
          headingContext.map((heading) => heading.id),
          content,
        ]),
    });
  });

  it("rejects every non-exact sparse schema, duplicate id, and unknown id", async () => {
    const invalid = [
      {},
      { alwaysOn: {} },
      { alwaysOn: [1] },
      { alwaysOn: ["constraint-a"], body: "invented" },
      { alwaysOn: ["constraint-a", "constraint-a"] },
      { alwaysOn: ["unknown-constraint"] },
    ];
    for (const value of invalid) {
      completeSimpleMock.mockReset();
      completeSimpleMock.mockResolvedValue(response(value));
      await expect(compileProjectInstructionsWithModel(requestFixture(), { model })).rejects.toThrow(/validation/iu);
      expect(completeSimpleMock).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects ambiguous input identities before invoking the provider", async () => {
    const duplicateConstraint = requestFixture();
    duplicateConstraint.constraints[1] = {
      ...duplicateConstraint.constraints[1]!,
      id: duplicateConstraint.constraints[0]!.id,
    };
    await expect(compileProjectInstructionsWithModel(duplicateConstraint, { model })).rejects.toThrow(
      /duplicate constraint/iu,
    );
    const duplicateModule = requestFixture();
    duplicateModule.modules[1] = { ...duplicateModule.modules[1]!, id: duplicateModule.modules[0]!.id };
    await expect(compileProjectInstructionsWithModel(duplicateModule, { model })).rejects.toThrow(/duplicate module/iu);
    const unknownModule = requestFixture();
    unknownModule.constraints[0] = { ...unknownModule.constraints[0]!, moduleId: "missing" };
    await expect(compileProjectInstructionsWithModel(unknownModule, { model })).rejects.toThrow(/unknown module/iu);
    expect(completeSimpleMock).not.toHaveBeenCalled();
  });
});
