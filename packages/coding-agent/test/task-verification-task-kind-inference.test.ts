import { describe, expect, it } from "vitest";
import { inferTaskKind } from "../src/core/task-verification/tool-classification.ts";
import {
  beforeAuditTool,
  callTaskVerification,
  createRequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("inferTaskKind", () => {
  it("infers feature for the exact benchmark regression prompt referencing README.md", () => {
    const regressionPrompt =
      "Implement the complete production-quality event-sourced inventory engine described in README.md ... storage in src/store.ts ... domain behavior in src/engine.ts ... Run npm test and npm run typecheck";
    expect(inferTaskKind(regressionPrompt)).toBe("feature");
  });

  describe("implementing behavior described in docs", () => {
    it.each([
      ["Implement the caching behavior described in docs", "feature"],
      ["Build the authentication service specified in README.md", "feature"],
      ["Create domain models in src/engine.ts per README requirements", "feature"],
      ["Add support for webhook notifications as outlined in documentation", "feature"],
      ["Develop storage layer described in README.md and run npm test", "feature"],
      ["Реализуй движок согласно документации в README.md", "feature"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("genuine documentation-only prompts", () => {
    it.each([
      ["Clarify the verification documentation", "docs"],
      ["Update README.md usage examples", "docs"],
      ["Document the public API methods in README.md", "docs"],
      ["Write documentation for task verification", "docs"],
      ["Document how to implement the cache API in README.md", "docs"],
      ["Add API documentation to README.md", "docs"],
      ["Update CHANGELOG.md for release 2.0", "docs"],
      ["Обнови README.md с примерами использования", "docs"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("investigation mentioning README or docs (adversarial)", () => {
    it.each([
      ["Investigate why README instructions fail", "investigation"],
      ["Investigate unexpected latency in the workflow documented in README.md", "investigation"],
      ["Audit the architecture described in README.md", "investigation"],
      ["Diagnose performance issue mentioned in documentation", "investigation"],
      ["Explain discrepancy between implementation and README.md", "investigation"],
      ["Исследуй поведение системы, описанное в README.md", "investigation"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("dominant requested effect is independent of clause order", () => {
    it.each([
      ["Fix the parser and explain the change in README.md", "bug_fix"],
      ["Explain the change in README.md and fix the parser", "bug_fix"],
      ["Implement the cache and update README.md", "feature"],
      ["Update README.md and implement the cache", "feature"],
      ["Refactor the cache and document the new layout", "refactor"],
      ["Document the new layout and refactor the cache", "refactor"],
      ["Update the implementation documented in README.md", "behavior_change"],
      ["Implement a documentation parser", "feature"],
      ["Update workflow and documentation", "behavior_change"],
      ["Update the response", "feature"],
      ["Update the spreadsheet", "feature"],
      ["Change the logo color", "feature"],
      ["Обнови ответ", "feature"],
      ["Измени задержку повтора", "behavior_change"],
      ["Review current behavior and update service documentation", "docs"],
      ["Review README.md and update its examples", "docs"],
      ["Update README.md examples after reviewing the file", "docs"],
      ["Inspect README.md and add examples", "docs"],
      ["Add examples to README.md after inspecting it", "docs"],
      ["Summarize README.md, then update the troubleshooting section", "docs"],
      ["Update the troubleshooting section after summarizing README.md", "docs"],
      ["Review README.md and document the workflow", "docs"],
      ["Document the workflow after reviewing README.md", "docs"],
      ["Inspect README.md and rewrite the setup instructions", "docs"],
      ["Rewrite the setup instructions after inspecting README.md", "docs"],
      ["Update response documentation", "docs"],
      ["Schedule a customer meeting and document the outcome", "feature"],
      ["Rotate credentials and document the result", "feature"],
      ["Change the retry delay", "behavior_change"],
      ["Update the cache eviction policy", "behavior_change"],
      ["Обнови поток и документацию", "behavior_change"],
      ["Обнови документацию и поток", "behavior_change"],
      ["Обнови логику согласно документации", "behavior_change"],
      ["Обнови логику по README", "behavior_change"],
      ["Обнови логику как описано в README", "behavior_change"],
      ["Обнови README и добавь примеры", "docs"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("documentation continuations", () => {
    it.each([
      ["Update README.md and keep its existing structure", "docs"],
      ["Update README.md and its examples", "docs"],
      ["Update README.md and add a troubleshooting section to README.md", "docs"],
      ["Update README.md and add a troubleshooting section", "docs"],
      ["Update README.md and maintain the links", "docs"],
      ["Update README.md. Keep the existing structure.", "docs"],
      ["Document setup and usage in README.md", "docs"],
      ["Update README.md with usage examples and troubleshooting guide", "docs"],
      ["Add usage guide and examples to docs/overview.md", "docs"],
      ["Keep the existing README.md structure", "docs"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("ambiguous mixed effects", () => {
    it.each([
      "Add telemetry and update README.md",
      "Update README.md and add telemetry",
      "Add tests and update README.md",
      "Send the report and update its documentation",
      "Deploy the service and update README.md",
      "Update README.md and deploy the service",
      "Migrate the database and update docs",
      "Update docs and migrate the database",
      "Deploy the service and refresh README.md",
      "Remove user content from the database and update docs",
      "Add reference records to the database and update README.md",
      "Update docs and remove user content from the database",
      "Update README.md and add reference records to the database",
      "Update docs and remove database content",
      "Update docs and remove its database content",
      "Update README.md and maintain filesystem links",
      "Update README.md, deploy the service",
      "Update README.md: deploy the service",
      "Update README.md — deploy the service",
      "Document the API and deploy the service in README.md",
      "Rewrite the instructions and restart the service in README.md",
    ])("requires an explicit task kind for %s", (prompt) => {
      expect(inferTaskKind(prompt)).toBeUndefined();
    });
  });

  describe("read-only intent dominates topic keywords without a mutation request", () => {
    it.each([
      ["Summarize the API documentation", "investigation"],
      ["Review README.md for inconsistencies", "investigation"],
      ["Review README.md and its examples", "investigation"],
      ["Explain how to implement the cache API", "investigation"],
      ["Diagnose the performance issue", "investigation"],
      ["Audit the crash recovery documentation", "investigation"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("bug fix mentioning docs or README (adversarial)", () => {
    it.each([
      ["Fix the calculation bug described in docs/known-issues.md", "bug_fix"],
      ["Fix broken parser described in README.md", "bug_fix"],
      ["Fix crash when handling input per README documentation", "bug_fix"],
      ["Fix typo in README.md", "bug_fix"],
      ["Исправь ошибку в обработчике, упомянутую в документации", "bug_fix"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("refactor mentioning docs or README (adversarial)", () => {
    it.each([
      ["Refactor the store module described in README.md", "refactor"],
      ["Restructure package layout per documentation", "refactor"],
      ["Рефакторинг слоя хранения, описанного в README", "refactor"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  describe("standard feature prompts without docs references", () => {
    it.each([
      ["Add a new billing export endpoint", "feature"],
      ["Implement rate limiting middleware in src/middleware.ts", "feature"],
    ] as const)("classifies %s as %s", (prompt, expected) => {
      expect(inferTaskKind(prompt)).toBe(expected);
    });
  });

  it("uses feature inference when the first mutation references a specification README", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Implement the inventory engine described in README.md and run npm test.", 100);

    await beforeAuditTool(harness.agent, "write", { path: "src/engine.ts", content: "export {};\n" });

    expect(harness.controller.currentState.taskKind).toBe("feature");
  });

  it("blocks an ambiguous first mutation until the model declares the task kind", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Deploy the service and refresh documentation", 100);

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/service.ts",
      content: "export {};\n",
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain('"action":"declare_task"');
    expect(harness.controller.currentState.taskKind).toBeUndefined();

    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Deploy the service and refresh its README",
    });
    const retried = await beforeAuditTool(harness.agent, "write", {
      path: "src/service.ts",
      content: "export {};\n",
    });
    expect(harness.controller.currentState.taskKind).toBe("feature");
    expect(retried?.reason).not.toContain("Task classification is ambiguous");
  });

  it("classifies from the retained task prompt after a progress nudge", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Fix the parser bug described in the request.", 100);
    await sendAuditUserPrompt(harness, "proceed", 200);

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/parser.ts",
      content: "export {};\n",
    });

    expect(harness.controller.currentState.taskKind).toBe("bug_fix");
    expect(harness.controller.currentState.taskSummary).toContain("Fix the parser bug");
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");
  });

  it("does not let a progress nudge bypass ambiguous-task declaration", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Deploy the service and update README.md.", 100);
    await sendAuditUserPrompt(harness, "continue", 200);

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/service.ts",
      content: "export {};\n",
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("Task classification is ambiguous");
    expect(harness.controller.currentState.taskKind).toBeUndefined();
  });

  it("infers from decisive effects beyond the persisted summary prefix", async () => {
    const harness = createRequirementAuditHarness();
    const longDocsPrefix = `Update README.md with ${"usage examples ".repeat(45)}`;
    await sendAuditUserPrompt(harness, `${longDocsPrefix} and deploy the service.`, 100);

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/service.ts",
      content: "export {};\n",
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("Task classification is ambiguous");
    expect(harness.controller.currentState.taskKind).toBeUndefined();
  });

  it("fails closed when restored mutation state prevents automatic declaration", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Implement the requested export.", 100);
    harness.controller.state.mutationRevision = 1;

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/export.ts",
      content: "export {};\n",
    });

    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("Cannot replace the task declaration after mutation");
    expect(harness.controller.currentState.taskKind).toBeUndefined();
  });
});
