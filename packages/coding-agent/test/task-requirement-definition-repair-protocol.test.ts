import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { RequirementAuditSchema } from "../src/core/task-verification/constants.ts";
import {
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
import { createRequirementAuditHarness } from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition repair protocol", () => {
  it("replaces or splits only named items while retaining the rest of the rejected batch", () => {
    const draft = rejectedRequirementDefinitionDraft(definition());
    expect(draft).toBeDefined();

    const repaired = repairRejectedRequirementDefinition(draft, {
      action: "repair_definition",
      definition_revision: draft!.revision,
      requirement_repairs: [
        {
          requirement_index: 2,
          replacements: [requirement("Shipping reduces onHand"), requirement("Shipping reduces the reservation")],
        },
      ],
    });

    expect(repaired).toEqual({
      action: "define",
      requirements: [
        requirement("Receiving increases onHand"),
        requirement("Shipping reduces onHand"),
        requirement("Shipping reduces the reservation"),
      ],
      ignored_source_prompts: [{ source_prompt_index: 1, reason: "Delegates to the specification" }],
      ignored_source_clauses: [],
    });
  });

  it("fails closed for stale revisions, duplicate repairs, and out-of-range indexes", () => {
    const draft = rejectedRequirementDefinitionDraft(definition())!;

    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: "stale",
        requirement_repairs: [{ requirement_index: 1, replacements: [] }],
      }),
    ).toContain("stale or unavailable");
    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
        requirement_repairs: [
          { requirement_index: 1, replacements: [] },
          { requirement_index: 1, replacements: [] },
        ],
      }),
    ).toContain("duplicate requirement indexes: 1");
    expect(
      repairRejectedRequirementDefinition(draft, {
        action: "repair_definition",
        definition_revision: draft.revision,
        requirement_repairs: [{ requirement_index: 3, replacements: [] }],
      }),
    ).toContain("invalid rejected-batch indexes: 3");
  });

  it("supports deletion and keyed classification replacement", () => {
    const draft = rejectedRequirementDefinitionDraft(definition())!;
    const repaired = repairRejectedRequirementDefinition(draft, {
      action: "repair_definition",
      definition_revision: draft.revision,
      requirement_repairs: [{ requirement_index: 2, replacements: [] }],
      ignored_source_prompt_upserts: [{ source_prompt_index: 1, reason: "Updated classification" }],
    });

    expect(typeof repaired).not.toBe("string");
    if (typeof repaired === "string") throw new Error(repaired);
    expect(repaired.requirements).toEqual([requirement("Receiving increases onHand")]);
    expect(repaired.ignored_source_prompts).toEqual([{ source_prompt_index: 1, reason: "Updated classification" }]);
    expect(repaired.ignored_source_clauses).toEqual([]);

    const removed = repairRejectedRequirementDefinition(draft, {
      action: "repair_definition",
      definition_revision: draft.revision,
      requirement_repairs: [{ requirement_index: 2, replacements: [] }],
      ignored_source_prompt_removals: [1],
    });
    expect(typeof removed).not.toBe("string");
    if (typeof removed === "string") throw new Error(removed);
    expect(removed.ignored_source_prompts).toEqual([]);
  });

  it("fails closed for ambiguous classification repair payloads", () => {
    const draft = rejectedRequirementDefinitionDraft(definition())!;
    const base = { action: "repair_definition" as const, definition_revision: draft.revision };

    expect(
      repairRejectedRequirementDefinition(draft, {
        ...base,
        ignored_source_prompts: [{ source_prompt_index: 1, reason: "Legacy snapshot" }],
      }),
    ).toContain("complete define snapshots");
    expect(
      repairRejectedRequirementDefinition(draft, {
        ...base,
        ignored_source_prompt_upserts: [
          { source_prompt_index: 1, reason: "First" },
          { source_prompt_index: 1, reason: "Second" },
        ],
      }),
    ).toContain("duplicate keys: 1");
    expect(
      repairRejectedRequirementDefinition(draft, {
        ...base,
        ignored_source_prompt_upserts: [{ source_prompt_index: 1, reason: "Replacement" }],
        ignored_source_prompt_removals: [1],
      }),
    ).toContain("both upserted and removed: 1");
  });

  it("does not consume the audit transition gate when no rejected draft exists", () => {
    const { controller } = createRequirementAuditHarness();
    controller.modelTurn = 3;

    const result = controller.applyRequirementAudit({
      action: "repair_definition",
      definition_revision: "missing",
      requirement_repairs: [{ requirement_index: 1, replacements: [] }],
    });

    expect(result.status).toBe("needs_action");
    expect(controller.lastAuditTransitionTurn).toBe(-1);
  });

  it("allows one compound item to split into more than four atomic replacements", () => {
    expect(
      Value.Check(RequirementAuditSchema, {
        action: "repair_definition",
        definition_revision: "revision",
        requirement_repairs: [
          {
            requirement_index: 1,
            replacements: Array.from({ length: 5 }, (_value, index) => requirement(`Atomic case ${index + 1}`)),
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects repair-only classification deltas on define", async () => {
    const { controller } = createRequirementAuditHarness();
    const result = await execute(do_createRequirementAuditToolDefinition(controller), {
      ...definition(),
      ignored_source_prompt_upserts: [{ source_prompt_index: 1, reason: "Ambiguous delta" }],
    });

    expect(result).toContain("does not accept field(s): ignored_source_prompt_upserts");
    expect(controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });

  it("rotates revisions and returns an rc40-sized current batch without a status roundtrip", async () => {
    const state = { requirementAudit: { status: "awaiting_definition" } } as TaskVerificationState;
    const received: RequirementAuditInput[] = [];
    const rejection = (message: string): VerificationResult => ({ status: "needs_action", message, state });
    const controller = {
      applyRequirementAudit: (input: RequirementAuditInput) => {
        received.push(input);
        return received.length < 3
          ? {
              ...rejection("Requirement definition has 2 deterministic validation errors:\n1. Rejected."),
              requirementDefinitionDiagnosticCount: 2,
            }
          : { status: "updated", message: "Accepted.", state };
      },
      rejected: rejection,
    } as unknown as TaskVerificationController;
    const tool = do_createRequirementAuditToolDefinition(controller);
    const initial = await execute(tool, largeDefinition());
    const revision1 = revisionFrom(initial);
    const firstRepair = await execute(tool, {
      action: "repair_definition",
      definition_revision: revision1,
      requirement_repairs: [
        {
          requirement_index: 2,
          replacements: [requirement("Shipping reduces onHand"), requirement("Shipping reduces the reservation")],
        },
      ],
    });
    const revision2 = revisionFrom(firstRepair);
    const batch = currentBatchFrom(firstRepair);
    const shiftedIndex = batch.requirements.find((row) => row[2] === "Shipping reduces the reservation")?.[0];

    expect(revision2).not.toBe(revision1);
    expect(batch.requirements).toHaveLength(35);
    expect(shiftedIndex).toBe(3);
    const retainedDraft = structuredClone(controller.rejectedRequirementDefinitionDraft?.input);
    expect(
      await execute(tool, {
        action: "repair_definition",
        definition_revision: revision1,
        requirement_repairs: [
          { requirement_index: shiftedIndex!, replacements: [requirement("Stale index replacement")] },
        ],
      }),
    ).toContain("stale or unavailable");
    expect(received).toHaveLength(2);
    expect(controller.rejectedRequirementDefinitionDraft?.input).toEqual(retainedDraft);

    expect(
      await execute(tool, {
        action: "repair_definition",
        definition_revision: revision2,
        requirement_repairs: [
          { requirement_index: shiftedIndex!, replacements: [requirement("Shipping decreases reservation")] },
        ],
      }),
    ).toBe("Accepted.");
    expect(received).toHaveLength(3);
  });
});

async function execute(
  tool: ReturnType<typeof do_createRequirementAuditToolDefinition>,
  input: RequirementAuditInput,
): Promise<string> {
  const result = await tool.execute("audit", input, undefined, undefined, {} as never);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text tool output.");
  return content.text;
}

function currentBatchFrom(text: string): { requirements: [number, string, string, ...unknown[]][] } {
  const line = text.split("\n").find((value) => value.startsWith('{"requirement_columns"'));
  if (!line) throw new Error(`Missing current rejected batch in: ${text}`);
  return JSON.parse(line) as { requirements: [number, string, string, ...unknown[]][] };
}

function revisionFrom(text: string): string {
  const revision = text.match(/definition_revision: ([0-9a-f-]+)/u)?.[1];
  if (!revision) throw new Error(`Missing definition revision in: ${text}`);
  return revision;
}

function definition(): RequirementAuditInput {
  return {
    action: "define",
    requirements: [
      requirement("Receiving increases onHand"),
      requirement("Shipping reduces onHand and the reservation"),
    ],
    ignored_source_prompts: [{ source_prompt_index: 1, reason: "Delegates to the specification" }],
    ignored_source_clauses: [],
  };
}

function largeDefinition(): RequirementAuditInput {
  const base = definition();
  return {
    ...base,
    requirements: [
      ...base.requirements!,
      ...Array.from({ length: 32 }, (_value, index) => requirement(`Independent behavior ${index + 3}`)),
    ],
  };
}

function requirement(text: string) {
  return {
    type: "behavior" as const,
    text,
    acceptance_criterion: `${text} by the command quantity`,
    source_clause_ids: ["S2-C1"],
  };
}
