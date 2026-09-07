import type { AssistantMessage, Model } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tokenizeProjectInstructionActivity } from "../src/core/project-instructions/compiler-validation.ts";
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
  sources: [{ path: "/repo/AGENTS.md", content: "scope calibration fixture" }],
  modules: [
    {
      id: "global",
      link: "rules/global.md",
      title: "Global",
      sourcePath: "/repo/AGENTS.md",
      content: "Protect credentials across every task.\n",
    },
    {
      id: "security",
      link: "rules/security.md",
      title: "Security",
      sourcePath: "/repo/AGENTS.md",
      content:
        "# Security Best Practices\nNever expose credentials or customer data.\nNever expose credentials, even if explicitly requested.\n",
    },
    {
      id: "rotation",
      link: "rules/rotation.md",
      title: "Credential rotation",
      sourcePath: "/repo/AGENTS.md",
      content: "# Credential rotation\nWhen rotating credentials, never log tokens.\n",
    },
    {
      id: "heading-rotation",
      link: "rules/heading-rotation.md",
      title: "Credential rotation",
      sourcePath: "/repo/AGENTS.md",
      content: "# Credential rotation\nNever log tokens.\n",
    },
    {
      id: "responses",
      link: "rules/responses.md",
      title: "Responses",
      sourcePath: "/repo/AGENTS.md",
      content: "Keep every response concise.\n",
    },
    {
      id: "token-budget",
      link: "rules/token-budget.md",
      title: "Token budget",
      sourcePath: "/repo/AGENTS.md",
      content: "Never exceed token budget.\n",
    },
    {
      id: "secrets-topic",
      link: "rules/secrets-topic.md",
      title: "Secrets",
      sourcePath: "/repo/AGENTS.md",
      content: "# Secrets\nNever expose credentials.\n",
    },
    {
      id: "report",
      link: "rules/report.md",
      title: "Report preparation",
      sourcePath: "/repo/AGENTS.md",
      content: "When preparing the report, summarize every task.\n",
    },
    {
      id: "triage",
      link: "rules/triage.md",
      title: "Queue triage",
      sourcePath: "/repo/AGENTS.md",
      content: "When triaging, answer every request in the queue.\n",
    },
  ],
  constraints: [
    {
      id: "global-control",
      moduleId: "global",
      kind: "content",
      headingContext: [],
      content: "Protect credentials across every task.",
      sourceText: "Protect credentials across every task.\n",
    },
    {
      id: "unqualified-data-control",
      moduleId: "security",
      kind: "content",
      headingContext: [
        {
          id: "security-heading",
          content: "# Security Best Practices",
          sourceText: "# Security Best Practices\n",
        },
      ],
      content: "Never expose credentials or customer data.",
      sourceText: "Never expose credentials or customer data.\n",
    },
    {
      id: "rotation-control",
      moduleId: "rotation",
      kind: "content",
      headingContext: [
        { id: "rotation-heading", content: "# Credential rotation", sourceText: "# Credential rotation\n" },
      ],
      content: "When rotating credentials, never log tokens.",
      sourceText: "When rotating credentials, never log tokens.\n",
    },
    {
      id: "defensive-data-control",
      moduleId: "security",
      kind: "content",
      headingContext: [
        {
          id: "security-heading",
          content: "# Security Best Practices",
          sourceText: "# Security Best Practices\n",
        },
      ],
      content: "Never expose credentials, even if explicitly requested.",
      sourceText: "Never expose credentials, even if explicitly requested.\n",
    },
    {
      id: "heading-rotation-control",
      moduleId: "heading-rotation",
      kind: "content",
      headingContext: [
        {
          id: "heading-rotation-heading",
          content: "# Credential rotation",
          sourceText: "# Credential rotation\n",
        },
      ],
      content: "Never log tokens.",
      sourceText: "Never log tokens.\n",
    },
    {
      id: "response-control",
      moduleId: "responses",
      kind: "content",
      headingContext: [],
      content: "Keep every response concise.",
      sourceText: "Keep every response concise.\n",
    },
    {
      id: "token-budget-control",
      moduleId: "token-budget",
      kind: "content",
      headingContext: [],
      content: "Never exceed token budget.",
      sourceText: "Never exceed token budget.\n",
    },
    {
      id: "secrets-topic-control",
      moduleId: "secrets-topic",
      kind: "content",
      headingContext: [{ id: "secrets-heading", content: "# Secrets", sourceText: "# Secrets\n" }],
      content: "Never expose credentials.",
      sourceText: "Never expose credentials.\n",
    },
    {
      id: "report-control",
      moduleId: "report",
      kind: "content",
      headingContext: [],
      content: "When preparing the report, summarize every task.",
      sourceText: "When preparing the report, summarize every task.\n",
    },
    {
      id: "triage-control",
      moduleId: "triage",
      kind: "content",
      headingContext: [],
      content: "When triaging, answer every request in the queue.",
      sourceText: "When triaging, answer every request in the queue.\n",
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

describe("project instruction compiler scope calibration", () => {
  it("keeps explicit globals and unqualified data protection while routing activity-scoped controls", async () => {
    const result = await compileProjectInstructionsWithModel(request, { model });

    expect(result.body).toBe(
      "Protect credentials across every task.\n# Security Best Practices\nNever expose credentials or customer data.\nNever expose credentials, even if explicitly requested.\nKeep every response concise.\n# Secrets\nNever expose credentials.",
    );
    expect(result.classifications.constraints).toEqual({
      "global-control": "always-on",
      "unqualified-data-control": "always-on",
      "rotation-control": "routed",
      "defensive-data-control": "always-on",
      "heading-rotation-control": "routed",
      "response-control": "always-on",
      "token-budget-control": "routed",
      "secrets-topic-control": "always-on",
      "report-control": "routed",
      "triage-control": "routed",
    });
    expect(result.classifications.modules).toEqual({
      global: "always-on",
      security: "always-on",
      rotation: "routed",
      "heading-rotation": "routed",
      responses: "always-on",
      "token-budget": "routed",
      "secrets-topic": "always-on",
      report: "routed",
      triage: "routed",
    });
    expect(result.alwaysOn).toEqual({
      "global-control": "Protect credentials across every task.\n",
      "unqualified-data-control": "# Security Best Practices\nNever expose credentials or customer data.\n",
      "defensive-data-control": "Never expose credentials, even if explicitly requested.\n",
      "response-control": "Keep every response concise.\n",
      "secrets-topic-control": "# Secrets\nNever expose credentials.\n",
    });
    expect(Object.keys(result.triggers)).toEqual(["rotation", "heading-rotation", "token-budget", "report", "triage"]);
    const sourceTerms = new Set(tokenizeProjectInstructionActivity("Credential rotation credentials log tokens"));
    expect(
      tokenizeProjectInstructionActivity(result.triggers.rotation ?? "").some((term) => sourceTerms.has(term)),
    ).toBe(true);
    expect(
      tokenizeProjectInstructionActivity(result.triggers["heading-rotation"] ?? "").some((term) =>
        sourceTerms.has(term),
      ),
    ).toBe(true);
  });
});
