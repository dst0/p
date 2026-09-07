import { describe, expect, it } from "vitest";
import {
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("pre-mutation requirement definition repair", () => {
  it("retains a rejected source-free definition for one-item repair", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(
      harness,
      "Reject invalid input. Reject truncated input. Preserve state when either input is rejected.",
      100,
    );
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Reject invalid and truncated input without changing state",
    });

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Reject invalid or truncated input and preserve state",
          acceptance_criterion: "Invalid or truncated inputs are rejected and state is preserved.",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(rejected).toContain("Requirement 1 is compound");
    expect(rejected).toContain("next_required_action: repair_definition");
    const revision = rejected.match(/definition_revision: ([0-9a-f-]+)/u)?.[1];
    expect(revision).toBeTypeOf("string");
    expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
    await nextModelTurn(harness);

    const accepted = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: revision,
      requirement_repairs: [
        {
          requirement_index: 1,
          replacements: [
            requirement("Reject invalid input", "Invalid input is rejected"),
            requirement("Reject truncated input", "Truncated input is rejected"),
            requirement("Preserve state after rejection", "State remains unchanged after either rejection"),
          ],
        },
      ],
    });

    expect(accepted).toContain("Defined 3 atomic requirement(s) before production mutation");
    expect(harness.controller.currentState.requirementAudit.status).toBe("verifying");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });
});

function requirement(text: string, acceptanceCriterion: string) {
  return {
    type: "behavior" as const,
    text,
    acceptance_criterion: acceptanceCriterion,
    source_prompt_indexes: [1],
  };
}
