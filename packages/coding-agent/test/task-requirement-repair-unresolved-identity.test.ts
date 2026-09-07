import { describe, expect, it } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import type { RejectedRequirementDefinitionDraft } from "../src/core/task-verification/requirement-definition-repair.ts";
import { do_createRequirementAuditToolDefinition } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts";
import { createRequirementAuditToolControllerDouble } from "./task-requirement-audit-tool-controller-double.ts";

describe("unresolved requirement repair identity", () => {
  it("makes status recovery non-actionable when a selected clause is absent from the frozen catalog", () => {
    const prompt = formatRequirementDefinitionPrompt(
      [{ id: "user-1", kind: "user_prompt", text: "Implement the requested behavior." }],
      unresolvedDraft(),
    );

    expect(prompt).toContain("SELECTED REPAIR IDENTITY IS UNRESOLVED");
    expect(prompt).toContain("next_required_action: status");
    expect(prompt).toContain('"identity_resolved":false');
    expect(prompt).not.toContain("next_required_action: repair_definition");
    expect(prompt).toContain("Do not submit a repair or infer source ordinals");
  });

  it("hard-rejects a repair whose selected source identity cannot be resolved", async () => {
    let applyCount = 0;
    const { controller } = createRequirementAuditToolControllerDouble((_input, state) => {
      applyCount += 1;
      return { status: "updated", message: "Unexpected apply", state };
    });
    controller.rejectedRequirementDefinitionDraft = unresolvedDraft();
    const tool = do_createRequirementAuditToolDefinition(controller);
    const result = await tool.execute(
      "unresolved-repair",
      {
        action: "repair_definition",
        definition_revision: "unresolved-revision",
        requirement_addition: {
          type: "behavior",
          text: "Implement missing behavior",
          acceptance_criterion: "Missing behavior is implemented",
          source_clause_ids: ["S2-C9"],
        },
      },
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(applyCount).toBe(0);
    expect(text).toContain("cannot expose an exact actionable selected target within the bounded prompt");
    expect(text).toContain("next_required_action: status");
    expect(text).toContain('"identity_resolved":false');
    expect(text).not.toContain('Use action "repair_definition"');
  });
});

function unresolvedDraft(): RejectedRequirementDefinitionDraft {
  return {
    revision: "unresolved-revision",
    diagnostics:
      "Every referenced-file clause must be mapped or explicitly ignored; unclassified source_clause_ids: S2-C9.",
    repairLineageBaselineRequirementCount: 1,
    bestDiagnosticCount: 1,
    unproductiveRepairAttempts: 0,
    knownNormativeSourceClauseIds: ["S2-C9"],
    input: {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Implement current behavior",
          acceptance_criterion: "Current behavior is implemented",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    },
  };
}
