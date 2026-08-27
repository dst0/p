import { describe, expect, it, vi } from "vitest";
import { MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS } from "../src/core/task-verification/constants.ts";
import type { RejectedRequirementDefinitionDraft } from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { do_createRequirementAuditToolDefinition } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts";
import type {
  RequirementAuditInput,
  TaskVerificationState,
  VerificationResult,
} from "../src/core/task-verification/types.ts";
import {
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
} from "./task-requirement-audit-test-harness.ts";

const ACTION_FIELDS = {
  prepare_definition: ["selected_paths", "adopt_changed_paths", "ignored_paths"],
  define: ["requirements", "ignored_source_prompts", "ignored_source_clauses"],
  repair_definition: [
    "definition_revision",
    "requirement_repairs",
    "ignored_source_prompt_upserts",
    "ignored_source_prompt_removals",
    "ignored_source_clause_upserts",
    "ignored_source_clause_removals",
  ],
  verdict: ["verdicts"],
} as const satisfies Record<RequirementAuditInput["action"], readonly (keyof RequirementAuditInput)[]>;

const FIELD_VALUES = {
  selected_paths: ["README.md"],
  adopt_changed_paths: ["README.md"],
  ignored_paths: [{ path: "notes.md", reason: "Not authoritative" }],
  requirements: [requirement()],
  definition_revision: "revision",
  requirement_repairs: [{ requirement_index: 1, replacements: [requirement()] }],
  ignored_source_prompts: [{ source_prompt_index: 1, reason: "Non-task context" }],
  ignored_source_clauses: [],
  ignored_source_prompt_upserts: [{ source_prompt_index: 1, reason: "Updated context" }],
  ignored_source_prompt_removals: [2],
  ignored_source_clause_upserts: [],
  ignored_source_clause_removals: ["S1-C1"],
  verdicts: [verdict()],
} satisfies Record<Exclude<keyof RequirementAuditInput, "action">, unknown>;

describe("requirement audit action fields", () => {
  it("rejects every foreign schema field before applying any action", async () => {
    for (const action of Object.keys(ACTION_FIELDS) as RequirementAuditInput["action"][]) {
      const allowed = new Set<string>(ACTION_FIELDS[action]);
      for (const field of Object.keys(FIELD_VALUES) as (keyof typeof FIELD_VALUES)[]) {
        if (allowed.has(field)) continue;
        const { controller, applyRequirementAudit } = controllerHarness();
        const input = { action, [field]: FIELD_VALUES[field] } as RequirementAuditInput;
        const result = await execute(do_createRequirementAuditToolDefinition(controller), input);
        expect(result, `${action}/${field}`).toContain(`does not accept field(s): ${field}`);
        expect(applyRequirementAudit, `${action}/${field}`).not.toHaveBeenCalled();
      }
    }
  });

  it("delegates every complete action-specific field set", async () => {
    for (const action of Object.keys(ACTION_FIELDS) as RequirementAuditInput["action"][]) {
      const fields = ACTION_FIELDS[action].map((field) => [field, FIELD_VALUES[field as keyof typeof FIELD_VALUES]]);
      const input = { action, ...Object.fromEntries(fields) } as RequirementAuditInput;
      // repair_definition requires an active rejected draft to repair; sibling actions require no pending rejected draft.
      const { controller, applyRequirementAudit } = controllerHarness(action === "repair_definition");
      await execute(do_createRequirementAuditToolDefinition(controller), input);
      expect(applyRequirementAudit, action).toHaveBeenCalledOnce();
    }
  });

  it("preserves real required-field validation for allowed payloads", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);

    expect(await callRequirementAudit(harness.controller, { action: "define" })).toContain(
      "define requires at least one atomic requirement",
    );
  });

  it("leaves real state and transition untouched for a foreign field", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const state = harness.controller.currentState;
    const transition = harness.controller.lastAuditTransitionTurn;
    const result = await callRequirementAudit(harness.controller, {
      action: "define",
      selected_paths: ["README.md"],
    });

    expect(result).toContain("does not accept field(s): selected_paths");
    expect(harness.controller.currentState).toEqual(state);
    expect(harness.controller.lastAuditTransitionTurn).toBe(transition);
  });

  it("bounds repeated foreign-field repairs without rotating the rejected draft", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [{ ...requirement(), source_prompt_indexes: [99] }],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
    const draft = structuredClone(harness.controller.rejectedRequirementDefinitionDraft);
    expect(draft).toBeDefined();
    const foreignRepair = {
      action: "repair_definition",
      definition_revision: draft!.revision,
      requirement_repairs: [{ requirement_index: 1, replacements: [requirement()] }],
      requirements: [requirement()],
    };

    for (let attempt = 1; attempt < MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS; attempt += 1) {
      await nextModelTurn(harness);
      expect(await callRequirementAudit(harness.controller, foreignRepair)).toContain(
        "next_required_action: repair_definition",
      );
    }
    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, foreignRepair)).toContain("next_required_action: define");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(draft!.revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input).toEqual(draft!.input);
  });
});

function controllerHarness(hasActiveRejectedDraft: boolean = false) {
  const state = { requirementAudit: { status: "awaiting_definition" } } as TaskVerificationState;
  const applyRequirementAudit = vi.fn(
    (_input: RequirementAuditInput): VerificationResult => ({
      status: "updated",
      message: "Applied.",
      state,
    }),
  );
  const controller = {
    applyRequirementAudit,
    lastAuditTransitionTurn: -1,
    rejectedRequirementDefinitionDraft: hasActiveRejectedDraft
      ? ({
          revision: "revision",
          diagnostics: "",
          repairLineageBaselineRequirementCount: 1,
          bestDiagnosticCount: 0,
          unproductiveRepairAttempts: 0,
          consecutiveNonImprovingFreshDefinitions: 0,
          input: {
            action: "define",
            requirements: [requirement()],
            ignored_source_prompts: [],
            ignored_source_clauses: [],
          },
        } satisfies RejectedRequirementDefinitionDraft)
      : undefined,
    rejected: (message: string): VerificationResult => ({ status: "needs_action", message, state }),
  } as unknown as TaskVerificationController;
  return { controller, applyRequirementAudit };
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

function requirement() {
  return {
    type: "behavior" as const,
    text: "The action validator rejects foreign fields",
    acceptance_criterion: "Foreign fields do not reach requirement audit application",
    source_prompt_indexes: [1],
  };
}

function verdict() {
  return { requirement_id: "R1", passed: true, reason: "Focused evidence passes", evidence_refs: ["evidence-1"] };
}
