import { describe, expect, it } from "vitest";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("pre-mutation direct-prompt requirement definition", () => {
  it("does not invent authoritative requirements for a promptless internal task", async () => {
    const harness = createRequirementAuditHarness();

    const gate = await beforeAuditTool(harness.agent, "write", {
      path: "src/export.ts",
      content: "export const stable = true;\n",
    });
    const status = await callTaskVerification(harness.controller, { action: "status" });

    expect(gate?.reason ?? "").not.toContain("accepted complete requirement definition");
    expect(status).not.toContain("accepted complete requirement set");
  });

  it("blocks an unclassified shell script before accepting the requirement definition", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Generate the deterministic export implementation.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Generate the deterministic export implementation.",
    });

    const blocked = await beforeAuditTool(harness.agent, "bash", {
      command: "node scripts/custom-generator.js",
    });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");
  });

  it("blocks test commands until the requirement definition is accepted", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Add deterministic export behavior.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add deterministic export behavior.",
    });
    const command = "node --test test/export.test.js";

    const blocked = await beforeAuditTool(harness.agent, "bash", { command });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");

    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Add deterministic export behavior",
          acceptance_criterion: "Repeated exports are byte-identical",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    expect((await beforeAuditTool(harness.agent, "bash", { command }))?.block).not.toBe(true);
  });

  it("blocks a potentially mutating shell command while a bug-fix baseline is pending", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Fix nondeterministic export behavior.", 100);
    const declared = await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix nondeterministic export behavior.",
    });
    expect(declared).toContain("Task declared");
    expect(harness.controller.currentState.taskKind).toBe("bug_fix");

    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(status).toContain("accepted complete requirement set");
    expect(status).not.toContain("authorize_baseline_test");
    const blocked = await beforeAuditTool(harness.agent, "bash", { cmd: "touch src/export.js" });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");
  });

  it("lazily upgrades a restored legacy task only after a real new requirement", async () => {
    const original = createRequirementAuditHarness();
    await sendAuditUserPrompt(original, "Implement deterministic export behavior.", 100);
    await callTaskVerification(original.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement deterministic export behavior.",
    });
    original.controller.state.mutationRevision = 1;
    original.controller.state.requirementDefinitionPolicy = undefined;
    original.controller.persistState();
    const restored = createRequirementAuditHarness(original.sessionManager);

    expect(
      (
        await beforeAuditTool(restored.agent, "edit", {
          path: "src/export.ts",
          edits: [{ oldText: "true", newText: "false" }],
        })
      )?.block,
    ).not.toBe(true);

    await sendAuditUserPrompt(restored, "Also reject empty exports.", 200);
    expect(restored.controller.currentState.requirementDefinitionPolicy).toBe(1);
    const blocked = await beforeAuditTool(restored.agent, "edit", {
      path: "src/export.ts",
      edits: [{ oldText: "true", newText: "false" }],
    });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");
  });

  it("blocks production mutation until the complete direct prompt is accepted", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Add deterministic export behavior.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add deterministic export behavior.",
    });

    const blocked = await beforeAuditTool(harness.agent, "write", {
      path: "src/export.ts",
      content: "export const stable = true;\n",
    });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("accepted complete requirement definition");
    expect(blocked?.reason).toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");

    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Add deterministic export behavior",
          acceptance_criterion: "Repeated exports are byte-identical",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    expect(defined).toContain("Defined 1 atomic requirement(s) before production mutation");

    expect(
      (
        await beforeAuditTool(harness.agent, "write", {
          path: "src/export.ts",
          content: "export const stable = true;\n",
        })
      )?.block,
    ).not.toBe(true);
    await recordAuditToolResult(harness.agent, "write", {
      path: "src/export.ts",
      content: "export const stable = true;\n",
    });
    expect(harness.controller.currentState.requirementAudit.requirements).toHaveLength(1);

    await sendAuditUserPrompt(harness, "Also reject empty exports.", 200);
    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(status).toContain("accepted complete requirement set");
    expect(status).not.toContain("collect fresh semantic evidence");
    const changedRequirementsGate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/export.ts",
      edits: [{ oldText: "true", newText: "false" }],
    });
    expect(changedRequirementsGate?.block).toBe(true);
    expect(changedRequirementsGate?.reason).toContain("accepted complete requirement definition");

    const redefined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Add deterministic export behavior",
          acceptance_criterion: "Repeated exports are byte-identical",
          source_prompt_indexes: [1],
        },
        {
          type: "behavior",
          text: "Reject empty exports",
          acceptance_criterion: "An empty export attempt is rejected",
          source_prompt_indexes: [2],
        },
      ],
      ignored_source_prompts: [],
    });
    expect(redefined).toContain("Defined 2 atomic requirement(s)");
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/export.ts",
          edits: [{ oldText: "true", newText: "false" }],
        })
      )?.block,
    ).not.toBe(true);
  });
});
