import { describe, expect, it } from "vitest";
import { MAX_REQUIREMENT_COUNT } from "../src/core/task-verification/constants.ts";
import {
  type RejectedRequirementDefinitionDraft,
  rejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { do_createRequirementAuditToolDefinition } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts";
import type {
  RequirementAuditInput,
  TaskVerificationState,
  VerificationResult,
} from "../src/core/task-verification/types.ts";

interface LineageDraft extends RejectedRequirementDefinitionDraft {
  repairLineageBaselineRequirementCount: number;
}

const promoteDraft = rejectedRequirementDefinitionDraft as (
  input: RequirementAuditInput,
  diagnostics?: string,
  previousDraft?: RejectedRequirementDefinitionDraft,
) => RejectedRequirementDefinitionDraft | undefined;

describe("requirement definition repair lineage budget", () => {
  it("allows one indexed item to fan out for atomic overflow validation", () => {
    const draft = initialDraft(39);
    const candidate = repairRejectedRequirementDefinition(draft, repairInput(draft, [42]), {
      allowLineageOverflowValidation: true,
    });

    expect(typeof candidate).not.toBe("string");
    expect((candidate as RequirementAuditInput).requirements).toHaveLength(80);
  });

  it("rejects one-item fan-out as lineage growth without overflow validation", () => {
    const draft = initialDraft(39);
    const before = structuredClone(draft);
    const result = repairRejectedRequirementDefinition(draft, repairInput(draft, [42]));

    expect(result).toBe(
      "repair lineage would grow from 39 to 80 requirements; cumulative net growth permits at most 16.",
    );
    expect(draft.input).toEqual(before.input);
    expect(draft.revision).toBe(before.revision);
  });

  it("authorizes a fresh definition after validating the rc51 lineage overflow", async () => {
    const validatedRequirementCounts: number[] = [];
    const controller = rejectingController([25, 37], (input) =>
      validatedRequirementCounts.push(input.requirements?.length ?? 0),
    );
    const tool = do_createRequirementAuditToolDefinition(controller);
    await execute(tool, definition(20));
    const original = controller.rejectedRequirementDefinitionDraft;
    expect(original).toBeDefined();
    expect(original?.bestDiagnosticCount).toBe(25);

    const result = await execute(tool, repairInput(original!, [24]));
    expect(result).toContain("Repair was not adopted");
    expect(result).toContain("next_required_action: define");
    expect(validatedRequirementCounts).toEqual([20, 43]);
    expect(controller.rejectedRequirementDefinitionDraft?.input).toEqual(original?.input);
    expect(controller.rejectedRequirementDefinitionDraft?.revision).toBe(original?.revision);
    expect(controller.rejectedRequirementDefinitionDraft?.bestDiagnosticCount).toBe(25);
    expect(controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);
  });

  it("accepts a 96-replacement split and rejects 97 before cloning", () => {
    const draft = initialDraft(1);
    const candidate = repairRejectedRequirementDefinition(draft, repairInput(draft, [96]), {
      allowLineageOverflowValidation: true,
    });

    expect(typeof candidate).not.toBe("string");
    expect((candidate as RequirementAuditInput).requirements).toHaveLength(96);
    expect((candidate as RequirementAuditInput).requirements?.[0]?.text).toBe("Requirement 1000");
    expect((candidate as RequirementAuditInput).requirements?.[95]?.text).toBe("Requirement 1095");

    const overflow = repairInput(draft, [97]);
    const firstOverflowReplacement = overflow.requirement_repairs?.[0]?.replacements[0];
    if (!firstOverflowReplacement) throw new Error("Expected overflow repair fixture.");
    Object.defineProperty(firstOverflowReplacement, "text", {
      get: () => {
        throw new Error("replacement objects must not be cloned before aggregate-count rejection");
      },
    });
    expect(repairRejectedRequirementDefinition(draft, overflow, { allowLineageOverflowValidation: true })).toBe(
      `requirement_repairs contains 97 total replacements; sparse repair permits at most ${MAX_REQUIREMENT_COUNT}.`,
    );
  });

  it("accepts a one-item split when net lineage growth is seven", () => {
    const draft = initialDraft(42);
    const repaired = acceptedRepair(draft, [8]);

    expect(repaired.requirements).toHaveLength(49);
  });

  it("enforces the one-item repair limit during direct execution", () => {
    const draft = initialDraft(20);
    expect(repairRejectedRequirementDefinition(draft, repairInput(draft, [0, 0]))).toBe(
      "repair_definition requires exactly one repair item; received 2.",
    );
  });

  it("bounds cumulative net growth against the immutable original lineage baseline", () => {
    const original = initialDraft(10);
    expect(lineageBaseline(original)).toBe(10);

    const first = acceptedRepair(original, [9]);
    const firstRotation = rotateDraft(first, original);
    expect(first.requirements).toHaveLength(18);
    expect(lineageBaseline(firstRotation)).toBe(10);

    const shrunk = acceptedRepair(firstRotation, [0]);
    const shrinkRotation = rotateDraft(shrunk, firstRotation);
    expect(shrunk.requirements).toHaveLength(17);
    expect(lineageBaseline(shrinkRotation)).toBe(10);

    const second = acceptedRepair(shrinkRotation, [10]);
    const secondRotation = rotateDraft(second, shrinkRotation);
    expect(second.requirements).toHaveLength(26);
    expect(lineageBaseline(secondRotation)).toBe(10);

    expect(repairRejectedRequirementDefinition(secondRotation, repairInput(secondRotation, [2]))).toBe(
      "repair lineage would grow from 10 to 27 requirements; cumulative net growth permits at most 16.",
    );
  });

  it("accepts a valid one-to-five split", () => {
    const draft = initialDraft(1);
    const repaired = acceptedRepair(draft, [5]);

    expect(repaired.requirements).toHaveLength(5);
  });

  it("never constructs a merged candidate above the global requirement maximum", () => {
    const draft = initialDraft(MAX_REQUIREMENT_COUNT);
    const explosiveRequirement = {
      type: "behavior" as const,
      get text(): string {
        throw new Error("oversized repair cloned before count preflight");
      },
      acceptance_criterion: "This candidate must never be cloned",
      source_prompt_indexes: [1],
    };
    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
        requirement_repairs: [{ requirement_index: 1, replacements: [requirement(1_000), explosiveRequirement] }],
      }),
    ).toBe(`repair would create 97 requirements; maximum is ${MAX_REQUIREMENT_COUNT}.`);
  });

  it("starts a fresh lineage baseline for a new full definition", () => {
    const original = initialDraft(10);
    const expanded = rotateDraft(acceptedRepair(original, [9]), original);
    expect(lineageBaseline(expanded)).toBe(10);

    const fresh = promoteDraft(definition(3));
    expect(fresh).toBeDefined();
    expect(lineageBaseline(fresh!)).toBe(3);
  });

  it("preserves the last repairable lineage when an improving overflow remains invalid", async () => {
    const controller = rejectingController();
    const tool = do_createRequirementAuditToolDefinition(controller);
    await execute(tool, definition(10));
    const original = controller.rejectedRequirementDefinitionDraft;
    expect(original).toBeDefined();
    expect(lineageBaseline(original!)).toBe(10);

    await execute(tool, repairInput(original!, [9]));
    expect(controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(18);
    expect(lineageBaseline(controller.rejectedRequirementDefinitionDraft!)).toBe(10);

    expect(await execute(tool, definition(3))).toContain("next_required_action: repair_definition");
    expect(controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(18);

    const overflow = await execute(tool, repairInput(controller.rejectedRequirementDefinitionDraft!, [10]));
    expect(overflow).toContain("Repair was not adopted");
    expect(overflow).toContain("3 deterministic validation errors");
    expect(overflow).toContain("next_required_action: define");
    expect(controller.rejectedRequirementDefinitionDraft?.input.requirements).toHaveLength(18);
    expect(lineageBaseline(controller.rejectedRequirementDefinitionDraft!)).toBe(10);
    expect(controller.rejectedRequirementDefinitionDraft?.bestDiagnosticCount).toBe(4);
    expect(controller.rejectedRequirementDefinitionDraft?.unproductiveRepairAttempts).toBe(1);
  });
});

function initialDraft(count: number): RejectedRequirementDefinitionDraft {
  const draft = promoteDraft(definition(count));
  if (!draft) throw new Error("Expected rejected definition draft.");
  return draft;
}

function rotateDraft(
  input: RequirementAuditInput,
  previousDraft: RejectedRequirementDefinitionDraft,
): RejectedRequirementDefinitionDraft {
  const draft = promoteDraft(input, "still rejected", previousDraft);
  if (!draft) throw new Error("Expected rotated rejected definition draft.");
  return draft;
}

function acceptedRepair(draft: RejectedRequirementDefinitionDraft, replacementCounts: number[]): RequirementAuditInput {
  const repaired = repairRejectedRequirementDefinition(draft, repairInput(draft, replacementCounts));
  if (typeof repaired === "string") throw new Error(repaired);
  return repaired;
}

function repairInput(draft: RejectedRequirementDefinitionDraft, replacementCounts: number[]): RequirementAuditInput {
  let nextRequirement = 1_000;
  return {
    action: "repair_definition",
    definition_revision: draft.revision,
    requirement_repairs: replacementCounts.map((count, offset) => ({
      requirement_index: offset + 1,
      replacements: Array.from({ length: count }, () => requirement(nextRequirement++)),
    })),
  };
}

function definition(count: number): RequirementAuditInput {
  return {
    action: "define",
    requirements: Array.from({ length: count }, (_value, offset) => requirement(offset + 1)),
    ignored_source_prompts: [],
    ignored_source_clauses: [],
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

function lineageBaseline(draft: RejectedRequirementDefinitionDraft): number | undefined {
  return (draft as Partial<LineageDraft>).repairLineageBaselineRequirementCount;
}

function rejectingController(
  diagnosticCounts = [5, 4, 3],
  onInput: (input: RequirementAuditInput) => void = () => {},
): TaskVerificationController {
  const state = { requirementAudit: { status: "awaiting_definition" } } as TaskVerificationState;
  const rejected = (message: string): VerificationResult => ({ status: "needs_action", message, state });
  return {
    applyRequirementAudit: (input: RequirementAuditInput) => {
      onInput(input);
      const currentDiagnosticCount = diagnosticCounts.shift();
      if (currentDiagnosticCount === undefined) throw new Error("Unexpected requirement validation.");
      return {
        ...rejected(
          `Requirement definition has ${currentDiagnosticCount} deterministic validation errors:\n1. Rejected.`,
        ),
        requirementDefinitionDiagnosticCount: currentDiagnosticCount,
      };
    },
    rejected,
  } as unknown as TaskVerificationController;
}

async function execute(
  tool: ReturnType<typeof do_createRequirementAuditToolDefinition>,
  input: RequirementAuditInput,
): Promise<string> {
  const result = await tool.execute("audit", input, undefined, undefined, {} as never);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text tool output.");
  return content.text;
}
