import { describe, expect, it } from "vitest";
import {
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-definition capacity", () => {
  it("accepts up to 96 atomic requirements for dense specifications", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const result = await callRequirementAudit(harness.controller, definitionInput(96));

    expect(result).toContain("Defined 96 atomic requirement(s)");
    expect(harness.controller.currentState.requirementAudit.requirements).toHaveLength(96);
  });

  it("rejects a definition above the bounded capacity", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    const result = await callRequirementAudit(harness.controller, definitionInput(97));

    expect(result).toContain("at most 96 atomic requirements");
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
  });
});

function definitionInput(count: number) {
  return {
    action: "define" as const,
    requirements: Array.from({ length: count }, (_unused, index) => ({
      type: "behavior" as const,
      text: `Atomic behavior ${index + 1}`,
      acceptance_criterion: `Behavior ${index + 1} is independently verified`,
      source_prompt_indexes: [1],
    })),
    ignored_source_prompts: [],
  };
}
