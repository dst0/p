import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectInstructionConstraints } from "../src/core/project-instructions/compiler-constraints.ts";
import { requiresConservativeAlwaysOn } from "../src/core/project-instructions/compiler-validation.ts";
import { splitInstructionSources } from "../src/core/project-instructions/content.ts";
import { compileProjectInstructionsWithModel } from "../src/core/project-instructions/model-compiler.ts";

const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return { ...actual, completeSimple: completeSimpleMock };
});

const model: Model<"anthropic-messages"> = {
  id: "provider-model",
  name: "Provider model",
  api: "anthropic-messages",
  provider: "test",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 65_536,
  maxTokens: 16_384,
};

function providerResponse(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: stopReason === "stop" ? [{ type: "text", text }] : [],
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
    stopReason,
    errorMessage: stopReason === "stop" ? undefined : text,
    timestamp: Date.now(),
  };
}

function repositoryRequest() {
  const content = readFileSync(resolve(import.meta.dirname, "../../../AGENTS.md"), "utf8");
  const sources = [{ path: "/repo/AGENTS.md", content }];
  const modules = splitInstructionSources(sources);
  return { content, request: { sources, modules, constraints: buildProjectInstructionConstraints(modules) } };
}

beforeEach(() => {
  completeSimpleMock.mockReset();
});

describe("project instruction compiler context capacity", () => {
  it("submits the repository's forty-kilobyte source to a 65k-context provider", async () => {
    const { content, request } = repositoryRequest();
    completeSimpleMock.mockResolvedValue(providerResponse("provider invocation reached", "error"));

    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(39_000);
    expect(request.constraints.length).toBeGreaterThanOrEqual(180);
    await expect(compileProjectInstructionsWithModel(request, { model })).rejects.toThrow(/provider call failed/iu);
    expect(completeSimpleMock).toHaveBeenCalledOnce();
  });

  it("keeps every module and constraint together for global scope inference", async () => {
    const { request } = repositoryRequest();
    completeSimpleMock.mockImplementation(async (_model, context) => {
      const payload = JSON.parse(String(context.messages[0]?.content)) as {
        modules: Array<{ id: string; constraints: Array<[string, string, string[], string]> }>;
      };
      const byId = new Map(request.constraints.map((constraint) => [constraint.id, constraint]));
      return providerResponse(
        JSON.stringify({
          alwaysOn: payload.modules
            .flatMap((module) => module.constraints.map(([id]) => id))
            .filter((id) => requiresConservativeAlwaysOn(byId.get(id)!)),
        }),
      );
    });

    const result = await compileProjectInstructionsWithModel(request, { model });
    const payload = JSON.parse(String(completeSimpleMock.mock.calls[0][1].messages[0]?.content)) as {
      modules: Array<{ id: string; constraints: Array<[string]> }>;
    };
    expect(completeSimpleMock).toHaveBeenCalledOnce();
    expect(payload.modules.every((module) => !("wireOrdinal" in module))).toBe(true);
    expect(payload.modules.map((module) => module.id)).toEqual(request.modules.map((module) => module.id));
    expect(payload.modules.flatMap((module) => module.constraints.map(([id]) => id))).toEqual(
      request.constraints.map((constraint) => constraint.id),
    );
    expect(result.usage?.total).toBe(2);
  });

  it("preserves a provider context-window error", async () => {
    const { request } = repositoryRequest();
    completeSimpleMock.mockResolvedValue(providerResponse("provider input exceeds context window", "error"));

    await expect(compileProjectInstructionsWithModel(request, { model })).rejects.toThrow(
      /provider context window failed/iu,
    );
    expect(completeSimpleMock).toHaveBeenCalledOnce();
  });

  it("does not split a global preamble from the later rules it governs", async () => {
    const content = [
      "# Scope",
      "The following requirements apply to every task.",
      "# Deployment",
      "Verify rollback before deployment.",
    ].join("\n");
    const sources = [{ path: "/repo/AGENTS.md", content }];
    const modules = splitInstructionSources(sources);
    const request = { sources, modules, constraints: buildProjectInstructionConstraints(modules) };
    completeSimpleMock.mockResolvedValue(providerResponse("provider input exceeds context window", "error"));

    await expect(
      compileProjectInstructionsWithModel(request, { model: { ...model, contextWindow: 1 } }),
    ).rejects.toThrow(/provider context window failed/iu);
    const payload = String(completeSimpleMock.mock.calls[0][1].messages[0]?.content);
    expect(payload).toContain("The following requirements apply to every task.");
    expect(payload).toContain("Verify rollback before deployment.");
    expect(completeSimpleMock).toHaveBeenCalledOnce();
  });

  it("preserves boundaries between multiple authoritative sources without exposing their paths", async () => {
    const sources = [
      { path: "/private/parent/AGENTS.md", content: "# Parent\nAlways preserve parent rules.\n" },
      { path: "/private/repo/AGENTS.md", content: "# Repository\nRun repository checks.\n" },
    ];
    const modules = splitInstructionSources(sources);
    const request = { sources, modules, constraints: buildProjectInstructionConstraints(modules) };
    completeSimpleMock.mockResolvedValue(providerResponse("provider reached", "error"));

    await expect(compileProjectInstructionsWithModel(request, { model })).rejects.toThrow(/provider call failed/iu);
    const payload = String(completeSimpleMock.mock.calls[0][1].messages[0]?.content);
    const parsed = JSON.parse(payload) as { modules: Array<{ sourceOrdinal: number }> };
    expect(parsed.modules.every((module) => !("wireOrdinal" in module))).toBe(true);
    expect(parsed.modules.map((module) => module.sourceOrdinal)).toEqual([1, 2]);
    expect(payload).not.toContain("/private/");
  });
});
