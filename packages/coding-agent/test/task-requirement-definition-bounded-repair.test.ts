import { describe, expect, it } from "vitest";
import { formatCurrentRejectedDefinitionBatch } from "../src/core/task-verification/rejected-definition-batch-format.ts";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  type RejectedRequirementDefinitionDraft,
  rejectedDraftFreshDefinitionReason,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import { rejectedRepairHasSemanticEffect } from "../src/core/task-verification/requirement-definition-repair-candidate.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { do_createRequirementAuditToolDefinition } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts";
import type {
  RequirementAuditInput,
  TaskVerificationState,
  VerificationResult,
} from "../src/core/task-verification/types.ts";

describe("bounded requirement-definition repair", () => {
  it("treats validation-equivalent provenance and classification ordering as a semantic no-op", () => {
    const input: RequirementAuditInput = {
      action: "define",
      requirements: [
        {
          ...requirement(1),
          source_prompt_indexes: [2, 1],
          source_clause_ids: ["S2-C2", "S1-C1"],
          source_facet_ids: ["S2-C2-F2", "S1-C1-F1"],
        },
      ],
      ignored_source_prompts: [
        { source_prompt_index: 4, reason: "Context four" },
        { source_prompt_index: 3, reason: "Context three" },
      ],
      ignored_source_clauses: [
        { source_clause_id: "S2-C3", classification: "example", reason: "Second example" },
        { source_clause_id: "S1-C2", classification: "informational", reason: "First context" },
      ],
    };
    const candidate = structuredClone(input);
    candidate.requirements![0]!.source_prompt_indexes = [1, 2];
    candidate.requirements![0]!.source_clause_ids = ["S1-C1", "S2-C2"];
    candidate.requirements![0]!.source_facet_ids = ["S1-C1-F1", "S2-C2-F2"];
    candidate.ignored_source_prompts!.reverse();
    candidate.ignored_source_clauses!.reverse();

    expect(rejectedRepairHasSemanticEffect({ input, repairLineageBaselineRequirementCount: 1 }, candidate)).toBe(false);
  });

  it("normalizes absent and empty set-like fields without erasing duplicates or requirement order", () => {
    const first = requirement(1);
    const second = requirement(2);
    const input: RequirementAuditInput = {
      action: "define",
      requirements: [{ ...first, source_clause_ids: [] }, second],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    };
    const absentCandidate: RequirementAuditInput = {
      action: "define",
      requirements: [first, second],
    };
    const duplicateCandidate = structuredClone(absentCandidate);
    duplicateCandidate.requirements![0]!.source_prompt_indexes = [1, 1];
    const reorderedCandidate = structuredClone(absentCandidate);
    reorderedCandidate.requirements!.reverse();

    expect(rejectedRepairHasSemanticEffect({ input, repairLineageBaselineRequirementCount: 2 }, absentCandidate)).toBe(
      false,
    );
    expect(
      rejectedRepairHasSemanticEffect({ input, repairLineageBaselineRequirementCount: 2 }, duplicateCandidate),
    ).toBe(true);
    expect(
      rejectedRepairHasSemanticEffect({ input, repairLineageBaselineRequirementCount: 2 }, reorderedCandidate),
    ).toBe(true);
  });

  it("treats exact repairs as stagnant without validation or revision rotation", async () => {
    const harness = rejectingController([4]);
    const initial = await execute(harness.controller, definition(2));
    const draft = requiredDraft(harness.controller);
    const revision = draft.revision;

    expect(initial).toContain("Current merged rejected batch");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await execute(harness.controller, exactRepair(requiredDraft(harness.controller)));
      expect(result).toContain("no semantic change");
      expect(result).toContain("Active-draft diagnostics:");
      expect(result).toContain("Diagnostic 1");
      expect(result).toContain("active_requirement_count: 2");
      expect(result).not.toContain("Current merged rejected batch");
      expect(requiredDraft(harness.controller).revision).toBe(revision);
      expect(requiredDraft(harness.controller).unproductiveRepairAttempts).toBe(attempt);
    }

    expect(harness.applyCount()).toBe(1);
    expect(rejectedDraftFreshDefinitionReason(requiredDraft(harness.controller))).toBe("stagnant_repair");
  });

  it("validates and promotes a strictly improving 35-to-54 lineage overflow", async () => {
    const harness = rejectingController([8, 4]);
    await execute(harness.controller, definition(35));
    const original = structuredClone(requiredDraft(harness.controller));

    const response = await execute(harness.controller, overflowRepair(original));
    const promoted = requiredDraft(harness.controller);

    expect(harness.applyCount()).toBe(2);
    expect(promoted.input.requirements).toHaveLength(54);
    expect(promoted.revision).not.toBe(original.revision);
    expect(promoted.bestDiagnosticCount).toBe(4);
    expect(promoted.repairLineageBaselineRequirementCount).toBe(35);
    expect(response).toContain("4 deterministic validation errors");
    expect(response).not.toContain("Current merged rejected batch");

    const recovery = formatRequirementDefinitionPrompt([{ id: "prompt-1", text: "Preserve inventory." }], promoted);
    for (const line of formatCurrentRejectedDefinitionBatch(promoted)) expect(recovery).toContain(line);
  });

  it("validates but retains the prior draft when a lineage overflow regresses", async () => {
    const harness = rejectingController([4, 7]);
    await execute(harness.controller, definition(35));
    const original = structuredClone(requiredDraft(harness.controller));

    const response = await execute(harness.controller, overflowRepair(original));

    expect(harness.applyCount()).toBe(2);
    expect(requiredDraft(harness.controller)).toEqual({ ...original, unproductiveRepairAttempts: 1 });
    expect(response).toContain("Repair was not adopted");
    expect(response).not.toContain("Current merged rejected batch");
  });
});

function rejectingController(diagnosticCounts: number[]): {
  controller: TaskVerificationController;
  applyCount: () => number;
} {
  const state = { requirementAudit: { status: "awaiting_definition" } } as TaskVerificationState;
  let calls = 0;
  const rejected = (message: string): VerificationResult => ({ status: "needs_action", message, state });
  const controller = {
    applyRequirementAudit: (_input: RequirementAuditInput) => {
      calls += 1;
      const count = diagnosticCounts.shift();
      if (count === undefined) throw new Error("Unexpected requirement validation.");
      return {
        ...rejected(diagnostics(count)),
        requirementDefinitionDiagnosticCount: count,
      };
    },
    rejected,
  } as unknown as TaskVerificationController;
  return { controller, applyCount: () => calls };
}

async function execute(controller: TaskVerificationController, input: RequirementAuditInput): Promise<string> {
  const tool = do_createRequirementAuditToolDefinition(controller);
  const result = await tool.execute("audit", input, undefined, undefined, {} as never);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text tool output.");
  return content.text;
}

function definition(count: number): RequirementAuditInput {
  return {
    action: "define",
    requirements: Array.from({ length: count }, (_value, index) => requirement(index + 1)),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}

function exactRepair(draft: RejectedRequirementDefinitionDraft): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: draft.revision,
    requirement_repairs: [{ requirement_index: 1, replacements: [structuredClone(draft.input.requirements![0]!)] }],
  };
}

function overflowRepair(draft: RejectedRequirementDefinitionDraft): RequirementAuditInput {
  return {
    action: "repair_definition",
    definition_revision: draft.revision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: Array.from({ length: 20 }, (_value, index) => requirement(1_000 + index)),
      },
    ],
  };
}

function requirement(index: number) {
  return {
    type: "behavior" as const,
    text: `Requirement ${index}`,
    acceptance_criterion: `Requirement ${index} is satisfied`,
    source_prompt_indexes: [1],
  };
}

function requiredDraft(controller: TaskVerificationController): RejectedRequirementDefinitionDraft {
  const draft = controller.rejectedRequirementDefinitionDraft;
  if (!draft) throw new Error("Expected active rejected definition draft.");
  return draft;
}

function diagnostics(count: number): string {
  return [
    `Requirement definition has ${count} deterministic validation errors:`,
    ...Array.from({ length: count }, (_value, index) => `${index + 1}. Diagnostic ${index + 1}`),
  ].join("\n");
}
