import { describe, expect, it } from "vitest";
import {
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
  RequirementDefinitionSchema,
} from "../src/core/task-verification/constants.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import { do_createRequirementAuditToolDefinition } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";
import {
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement definition stagnation recovery", () => {
  it("clarifies schema descriptions and prompt guidelines for direct prompts vs referenced files", () => {
    const promptIndexesDesc = schemaDescription(RequirementDefinitionSchema.properties.source_prompt_indexes);
    expect(promptIndexesDesc).toContain("direct");
    expect(promptIndexesDesc).toContain("referenced");
    const clauseIdsDesc = schemaDescription(RequirementDefinitionSchema.properties.source_clause_ids);
    expect(clauseIdsDesc).toContain("Referenced");

    const harness = createRequirementAuditHarness();
    const tool = do_createRequirementAuditToolDefinition(harness.controller);
    const guidelines = tool.promptGuidelines?.join("\n") ?? "";
    expect(guidelines).toContain("source_prompt_indexes");
    expect(guidelines).toContain("direct");
    expect(guidelines).toContain("source_clause_ids");
    expect(guidelines).toContain(`at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements`);
    expect(guidelines).toContain(`capped at ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements`);
    expect(guidelines).not.toContain("at most 16 replacements");
  });

  it("emits actionable direct-only diagnostic for offending referenced index 2", () => {
    const prompts: TaskVerificationSourcePrompt[] = [
      { id: "p1", text: "Direct prompt instruction." },
      { id: "spec-1", kind: "referenced_file", path: "SPEC.md", sha256: "0".repeat(64), text: "Preserve state." },
    ];
    const invalid = validateRequirementDefinition(prompts, {
      action: "define",
      requirements: [
        { type: "constraint", text: "Preserve", acceptance_criterion: "Preserved", source_prompt_indexes: [2] },
      ],
      ignored_source_prompts: [{ source_prompt_index: 1, reason: "Context" }],
      ignored_source_clauses: [],
    });
    expect(invalid.definition).toBeUndefined();
    const diag = invalid.diagnostics.find((item) => item.includes("source index 2"));
    expect(diag).toContain("source_prompt_indexes is direct-only");
    expect(diag).toContain("remove index 2");
    expect(diag).toContain("map the referenced requirement through source_clause_ids or source_facet_ids");

    const valid = validateRequirementDefinition(prompts, {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "Preserve state",
          acceptance_criterion: "State remains preserved",
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [{ source_prompt_index: 1, reason: "Context" }],
      ignored_source_clauses: [],
    });
    expect(valid.diagnostics).toEqual([]);
    expect(valid.definition?.requirements).toHaveLength(1);
  });

  it("keeps repeated oversize repairs non-authoritative and saturates the bounded counter", async () => {
    const harness = await preparedHarness();
    await callRequirementAudit(harness.controller, invalidDef([1, 2]));
    const initialDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(initialDraft).toBeDefined();

    const oversize = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(oversize).toContain("97 total replacements");
    expect(oversize).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(initialDraft!.revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toEqual(
      initialDraft!.input.requirements,
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);

    await nextModelTurn(harness);
    const second = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(second).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(2);
    await nextModelTurn(harness);

    const threshold = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(threshold).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(initialDraft!.revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input).toEqual(initialDraft!.input);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(
      MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
    );

    await nextModelTurn(harness);
    const blockedDefine = await callRequirementAudit(harness.controller, validDefinition());
    expect(blockedDefine).toContain("next_required_action: repair_definition");
    expect(blockedDefine).toContain('replacement action "define" is never accepted');
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(initialDraft!.revision);
  });

  it("retains the same draft across malformed and no-op attempts, then accepts one valid repair", async () => {
    const harness = await preparedHarness();
    const init = await callRequirementAudit(harness.controller, invalidDef([1]));
    expect(init).toContain("next_required_action: repair_definition");
    const revision = currentRevision(harness);
    await nextModelTurn(harness);

    const oversize = await callRequirementAudit(harness.controller, oversizeRepair(revision));
    expect(oversize).toContain("97 total replacements");
    expect(oversize).toContain("next_required_action: repair_definition");
    expect(currentRevision(harness)).toBe(revision);
    await nextModelTurn(harness);

    const noOp = await callRequirementAudit(
      harness.controller,
      singleRepair(revision, "Invalid requirement 1", "Requirement 1 is accepted only with valid provenance", 99),
    );
    expect(noOp).toContain("no semantic change");
    expect(currentRevision(harness)).toBe(revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(2);
    await nextModelTurn(harness);

    const complete = await callRequirementAudit(harness.controller, singleRepair(revision, "Good", "Valid crit"));
    expect(complete).toContain("Defined 1 atomic requirement(s)");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });

  it("keeps singular repair available after the unproductive counter saturates", async () => {
    const harness = await preparedHarness();
    await callRequirementAudit(harness.controller, invalidDef([1]));
    const revision = currentRevision(harness);
    for (let attempt = 0; attempt < MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS + 2; attempt++) {
      await nextModelTurn(harness);
      const result = await callRequirementAudit(harness.controller, oversizeRepair(revision));
      expect(result).toContain("next_required_action: repair_definition");
      expect(currentRevision(harness)).toBe(revision);
    }
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(
      MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
    );

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, singleRepair(revision, "Good", "Valid crit"))).toContain(
      "Defined 1 atomic requirement(s)",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });
});

async function preparedHarness(): Promise<RequirementAuditHarness> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  return harness;
}

function invalidDef(indexes: number[]): RequirementAuditInput {
  return {
    action: "define",
    requirements: indexes.map((idx) => ({
      type: "behavior" as const,
      text: `Invalid requirement ${idx}`,
      acceptance_criterion: `Requirement ${idx} is accepted only with valid provenance`,
      source_prompt_indexes: [99],
    })),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function validReq() {
  return {
    type: "behavior" as const,
    text: "The completion gate is enforced",
    acceptance_criterion: "Premature completion is blocked",
    source_prompt_indexes: [1],
  };
}

function validDefinition(): RequirementAuditInput {
  return { action: "define", requirements: [validReq()], ignored_source_prompts: [], ignored_source_clauses: [] };
}

function oversizeRepair(revision: string): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: revision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: Array.from({ length: 97 }, (_v, i) => ({
          type: "behavior" as const,
          text: `Item ${i + 1}`,
          acceptance_criterion: `Criterion ${i + 1}`,
          source_prompt_indexes: [1],
        })),
      },
    ],
  };
}

function singleRepair(
  revision: string,
  text: string,
  acceptanceCriterion: string,
  sourcePromptIndex: number = 1,
  sourceClauseIds?: string[],
): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: revision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: [
          {
            type: "behavior",
            text,
            acceptance_criterion: acceptanceCriterion,
            source_prompt_indexes: [sourcePromptIndex],
            source_clause_ids: sourceClauseIds,
          },
        ],
      },
    ],
  };
}

function schemaDescription(schema: object): string {
  return "description" in schema && typeof schema.description === "string" ? schema.description : "";
}

function currentRevision(harness: RequirementAuditHarness): string {
  const revision = harness.controller.rejectedRequirementDefinitionDraft?.revision;
  if (!revision) throw new Error("Expected active rejected definition revision.");
  return revision;
}
