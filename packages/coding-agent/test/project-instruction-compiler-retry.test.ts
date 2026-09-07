import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Model } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectInstructionCompilerFailureTelemetry } from "../src/core/project-instructions/compiler-attempt-diagnostics.ts";
import { compileProjectInstructionsWithModel } from "../src/core/project-instructions/model-compiler.ts";
import { prepareProjectInstructions } from "../src/core/project-instructions/processor.ts";
import type { ProjectInstructionCompilerRequest } from "../src/core/project-instructions/types.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));
const temporaryDirectories: string[] = [];

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
  sources: [{ path: "/repo/AGENTS.md", content: "# Rules\nAlways preserve evidence.\n" }],
  modules: [
    {
      id: "1-rules",
      link: "rules/1-rules.md",
      title: "Rules",
      sourcePath: "/repo/AGENTS.md",
      content: "# Rules\nAlways preserve evidence.\n",
    },
  ],
  constraints: [
    {
      id: "constraint-1",
      moduleId: "1-rules",
      kind: "content",
      headingContext: [],
      content: "Always preserve evidence.",
      sourceText: "Always preserve evidence.",
    },
  ],
};

const oversizedSourceMarker = "sensitive-source-marker-compiler-budget";
const oversizedConstraintText = (name: string): string =>
  `When editing ${name}, preserve its local invariant. ${oversizedSourceMarker}. ${"Keep the implementation detail scoped to this activity. ".repeat(36)}\n`;
const oversizedRequest: ProjectInstructionCompilerRequest = {
  sources: [
    {
      path: "/repo/AGENTS.md",
      content: `# Local edits\n${oversizedConstraintText("alpha")}\n${oversizedConstraintText("beta")}`,
    },
  ],
  modules: [
    {
      id: "1-local-edits",
      link: "rules/1-local-edits.md",
      title: "Local edits",
      sourcePath: "/repo/AGENTS.md",
      content: `# Local edits\n${oversizedConstraintText("alpha")}\n${oversizedConstraintText("beta")}`,
    },
  ],
  constraints: [
    {
      id: "oversized-alpha",
      moduleId: "1-local-edits",
      kind: "content",
      headingContext: [],
      content: oversizedConstraintText("alpha"),
      sourceText: oversizedConstraintText("alpha"),
    },
    {
      id: "oversized-beta",
      moduleId: "1-local-edits",
      kind: "content",
      headingContext: [],
      content: oversizedConstraintText("beta"),
      sourceText: oversizedConstraintText("beta"),
    },
  ],
};

function response(text: string, usage: number, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: usage,
      output: usage + 1,
      cacheRead: usage + 2,
      cacheWrite: usage + 3,
      totalTokens: usage + 4,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage: stopReason === "error" ? text : undefined,
    timestamp: Date.now(),
  };
}

beforeEach(() => completeSimpleMock.mockReset());
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler bounded retry", () => {
  it("retries an unknown sparse id with failure-specific safe feedback and aggregates both attempts", async () => {
    completeSimpleMock
      .mockResolvedValueOnce(response('{"alwaysOn":["private-unknown-constraint"]}', 10))
      .mockResolvedValueOnce(response('{"alwaysOn":["constraint-1"]}', 20));

    const result = await compileProjectInstructionsWithModel(request, { model });

    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
    expect(completeSimpleMock.mock.calls[1][1].systemPrompt).toBe(completeSimpleMock.mock.calls[0][1].systemPrompt);
    const firstUserContent = String(completeSimpleMock.mock.calls[0][1].messages[0]?.content);
    const retryFeedback = String(completeSimpleMock.mock.calls[1][1].messages[0]?.content).slice(
      firstUserContent.length,
    );
    expect(retryFeedback).toMatch(/unknown constraint id/iu);
    expect(retryFeedback).not.toContain("private-unknown-constraint");
    expect(retryFeedback).not.toContain("Always preserve evidence.");
    expect(result.usage).toEqual({ input: 30, output: 32, cacheRead: 34, cacheWrite: 36, total: 38 });
  });

  it("calibrates sparse selection without routing explicit every-task or every-turn rules", async () => {
    completeSimpleMock.mockResolvedValue(response('{"alwaysOn":[]}', 10));

    await compileProjectInstructionsWithModel(request, { model });

    const prompt = String(completeSimpleMock.mock.calls[0][1].systemPrompt);
    expect(prompt).toContain(
      "Activity-bound security, privacy, and preservation rules are routed when their concrete activity or condition is retrievable.",
    );
    expect(prompt).toContain(
      "Mutation actions such as editing, writing, deleting, committing, and publishing are concrete retrievable activities.",
    );
    expect(prompt).toContain(
      "A typical always-on selection is minimal and often contains 0-10 IDs; this range is nonbinding and never overrides explicit scope.",
    );
    expect(prompt).toContain("Rules explicitly applying to every task or every turn remain always-on.");
    expect(prompt).not.toContain(
      "Keep cross-cutting security, privacy, interaction, freshness, monitoring, and preservation controls always-on when they can apply before a matching route can be inferred.",
    );
  });

  it("retries a sparse selection that exceeds the exact always-on body budget", async () => {
    const oversizedSelection = '{"alwaysOn":["oversized-alpha","oversized-beta"]}';
    const expectedBodyChars = oversizedConstraintText("alpha").length + oversizedConstraintText("beta").length - 1;
    completeSimpleMock
      .mockResolvedValueOnce(response(oversizedSelection, 10))
      .mockResolvedValueOnce(response('{"alwaysOn":[]}', 20));

    const result = await compileProjectInstructionsWithModel(oversizedRequest, { model });

    expect(result.body).toBe("No source constraints apply to every task.");
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
    const firstPrompt = String(completeSimpleMock.mock.calls[0][1].systemPrompt);
    const retryPrompt = String(completeSimpleMock.mock.calls[1][1].systemPrompt);
    expect(retryPrompt).toBe(firstPrompt);

    const firstUserContent = String(completeSimpleMock.mock.calls[0][1].messages[0]?.content);
    const retryUserContent = String(completeSimpleMock.mock.calls[1][1].messages[0]?.content);
    const parsedFirstUserContent: unknown = JSON.parse(firstUserContent);
    expect(JSON.stringify(parsedFirstUserContent)).toBe(firstUserContent);
    expect(expectedBodyChars).toBeGreaterThan(3_500);
    const expectedRetryFeedback =
      `\n\nRetry feedback: failure=always-on-body-budget; selectedCount=2; ` +
      `materializedBodyChars=${expectedBodyChars}; maxBodyChars=3500. ` +
      "Re-evaluate all input constraints under the system scope rules and return only the exact contract object.";
    expect(retryUserContent).toBe(`${firstUserContent}${expectedRetryFeedback}`);
    const actualRetryFeedback = retryUserContent.slice(firstUserContent.length);
    for (const sourceText of [oversizedConstraintText("alpha"), oversizedConstraintText("beta")]) {
      const encodedSourceText = JSON.stringify(sourceText).slice(1, -1);
      expect(retryUserContent.split(encodedSourceText)).toHaveLength(2);
      expect(actualRetryFeedback).not.toContain(sourceText);
      expect(actualRetryFeedback).not.toContain(encodedSourceText);
    }
    for (const privateValue of [
      oversizedSourceMarker,
      oversizedSelection,
      "1-local-edits",
      "rules/1-local-edits.md",
      "Local edits",
      "/repo/AGENTS.md",
      oversizedRequest.sources[0]?.content ?? "missing source content",
      "oversized-alpha",
      "oversized-beta",
    ]) {
      expect(actualRetryFeedback).not.toContain(privateValue);
    }
    expect(result.usage).toEqual({ input: 30, output: 32, cacheRead: 34, cacheWrite: 36, total: 38 });
  });

  it("reports sanitized grounding telemetry after two oversized sparse selections", async () => {
    completeSimpleMock.mockResolvedValue(response('{"alwaysOn":["oversized-alpha","oversized-beta"]}', 10));

    const failure = await compileProjectInstructionsWithModel(oversizedRequest, { model }).catch(
      (error: unknown) => error,
    );

    expect(getProjectInstructionCompilerFailureTelemetry(failure)).toMatchObject({
      attemptCount: 2,
      failureKinds: ["grounding-semantic", "grounding-semantic"],
      usage: { input: 20, output: 22, cacheRead: 24, cacheWrite: 26, total: 28 },
    });
    expect(String(failure)).not.toContain(oversizedSourceMarker);
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });

  it("publishes no result after two invalid responses", async () => {
    completeSimpleMock.mockResolvedValue(response("not json", 10));
    const failure = await compileProjectInstructionsWithModel(request, { model }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(getProjectInstructionCompilerFailureTelemetry(failure)).toMatchObject({
      attemptCount: 2,
      failureKinds: ["envelope", "envelope"],
      usage: { input: 20, output: 22, cacheRead: 24, cacheWrite: 26, total: 28 },
    });
    expect(getProjectInstructionCompilerFailureTelemetry(failure)?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(String(failure)).not.toContain("not json");
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider failure", async () => {
    completeSimpleMock.mockResolvedValue(response("provider unavailable", 10, "error"));
    const failure = await compileProjectInstructionsWithModel(request, { model }).catch((error: unknown) => error);
    expect(getProjectInstructionCompilerFailureTelemetry(failure)).toMatchObject({
      attemptCount: 1,
      failureKinds: ["provider"],
      usage: { input: 10, output: 11, cacheRead: 12, cacheWrite: 13, total: 14 },
    });
    expect(String(failure)).not.toContain("provider unavailable");
    expect(completeSimpleMock).toHaveBeenCalledOnce();
  });

  it("publishes only a failure record when both validation attempts fail", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-project-compiler-retry-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, ".git"));
    const content = `# Rules\n${Array.from({ length: 240 }, (_, index) => `- When code changes, run check ${index}.`).join("\n")}\n`;
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, content);
    completeSimpleMock.mockResolvedValue(response("not json", 10));

    const prepared = await prepareProjectInstructions({
      cwd: root,
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
      compilerIdentity: "test/compiler",
      compiler: (compilerRequest) => compileProjectInstructionsWithModel(compilerRequest, { model }),
    });

    expect(prepared.manifest).toMatchObject({
      mode: "fallback",
      compilerStatus: "failed",
      compilerDiagnostic: "project instruction compiler output validation failed",
    });
    const records = readdirSync(join(root, ".pdev", "instructions", "compilations"));
    expect(records.filter((name) => name.endsWith(".failure.json"))).toHaveLength(1);
    expect(records.filter((name) => name.endsWith(".json") && !name.endsWith(".failure.json"))).toHaveLength(0);
    expect(completeSimpleMock).toHaveBeenCalledTimes(2);
  });
});
