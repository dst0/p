import { describe, expect, it } from "vitest";
import {
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
  RequirementDefinitionSchema,
} from "../src/core/task-verification/constants.ts";
import {
  rejectedDraftFreshDefinitionReason,
  rejectedDraftRequiresFreshDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
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

  it("keeps repeated oversize repairs non-authoritative and then requires a fresh definition", async () => {
    const harness = await preparedHarness();
    await callRequirementAudit(harness.controller, invalidDef([1, 2]));
    const initialDraft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(initialDraft).toBeDefined();

    const oversize = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(oversize).toContain("33 total replacements");
    expect(oversize).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(initialDraft!.revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.requirements).toEqual(
      initialDraft!.input.requirements,
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBeUndefined();

    await nextModelTurn(harness);
    const second = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(second).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(2);
    await nextModelTurn(harness);

    const threshold = await callRequirementAudit(harness.controller, oversizeRepair(initialDraft!.revision));
    expect(threshold).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(initialDraft!.revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input).toEqual(initialDraft!.input);
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "stagnant_repair",
    );

    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, validDefinition())).toContain("Defined 1 atomic requirement");
  });

  it("executes live mixed sequence until three non-improving repairs authorize a fresh definition", async () => {
    const harness = await preparedHarness();
    const init = await callRequirementAudit(harness.controller, invalidDef([1, 2]));
    expect(init).toContain("next_required_action: repair_definition");
    const rev1 = currentRevision(harness);
    await nextModelTurn(harness);

    const oversize = await callRequirementAudit(harness.controller, oversizeRepair(rev1));
    expect(oversize).toContain("33 total replacements");
    expect(oversize).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(rev1);
    await nextModelTurn(harness);

    const identical = await callRequirementAudit(
      harness.controller,
      singleRepair(rev1, "Still missing", "Still has an invalid source", 99),
    );
    expect(identical).toContain("next_required_action: repair_definition");
    const rev2 = currentRevision(harness);
    expect(rev2).not.toBe(rev1);
    await nextModelTurn(harness);

    const threshold = await callRequirementAudit(
      harness.controller,
      singleRepair(rev2, "Still missing again", "Still has an invalid source", 99),
    );
    expect(threshold).toContain("next_required_action: define");
    expect(threshold).toContain("consecutive repair attempts were unproductive");
    const rev3 = currentRevision(harness);
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "stagnant_repair",
    );
    expect(rejectedDraftRequiresFreshDefinition(harness.controller.rejectedRequirementDefinitionDraft)).toBe(true);

    const blocked = await callRequirementAudit(harness.controller, singleRepair(rev3, "Good", "Valid crit"));
    expect(blocked).toContain("next_required_action: define");
    expect(blocked).toContain("A fresh define is required because consecutive repair attempts were unproductive");
    await nextModelTurn(harness);

    const complete = await callRequirementAudit(harness.controller, validDefinition());
    expect(complete).toContain("Defined 1 atomic requirement(s)");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });

  it("authorizes fresh define after three valid repairs without a lower diagnostic count", async () => {
    const harness = await preparedHarness();
    await callRequirementAudit(harness.controller, invalidDef([1]));
    const rev1 = currentRevision(harness);
    await nextModelTurn(harness);

    const repair1 = await callRequirementAudit(
      harness.controller,
      singleRepair(rev1, "Missing 1", "Still has an invalid source", 99),
    );
    expect(repair1).toContain("next_required_action: repair_definition");
    const rev2 = currentRevision(harness);
    expect(rev2).not.toBe(rev1);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);
    await nextModelTurn(harness);

    const repair2 = await callRequirementAudit(
      harness.controller,
      singleRepair(rev2, "Missing 2", "Still has an invalid source", 99),
    );
    expect(repair2).toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(2);
    await nextModelTurn(harness);

    const repair3 = await callRequirementAudit(
      harness.controller,
      singleRepair(currentRevision(harness), "Missing 3", "Still has an invalid source", 99),
    );
    expect(repair3).toContain("next_required_action: define");
    expect(repair3).toContain("consecutive repair attempts were unproductive");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(
      MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
    );
    expect(rejectedDraftFreshDefinitionReason(harness.controller.rejectedRequirementDefinitionDraft)).toBe(
      "stagnant_repair",
    );
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
    requirement_repairs: [16, 17].map((count, requirementIndex) => ({
      requirement_index: requirementIndex + 1,
      replacements: Array.from({ length: count }, (_v, i) => ({
        type: "behavior" as const,
        text: `Item ${requirementIndex * 16 + i + 1}`,
        acceptance_criterion: `Criterion ${requirementIndex * 16 + i + 1}`,
        source_prompt_indexes: [1],
      })),
    })),
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
