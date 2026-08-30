import { describe, expect, it } from "vitest";
import { MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES } from "../src/core/task-verification/referenced-requirement-sources.ts";
import {
  formatRequirementDefinitionPrompt,
  renderRequirementDefinitionPrompt,
} from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  type RejectedRequirementDefinitionDraft,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement definition prompt size recovery", () => {
  it("directs recovery to exactly one semantic repair item", () => {
    const recovery = formatRequirementDefinitionPrompt(
      [{ id: "prompt-1", text: "Preserve inventory." }],
      singleDraft("single-item-revision", "Requirement 1 is compound."),
    );

    expect(recovery).toContain("Repair only Requirement 1");
    expect(recovery).toContain("one requirement_repairs entry for requirement_index 1");
    expect(recovery).not.toContain("Address every current diagnostic in one convergent call");
  });

  it("keeps exact-ceiling and oversized recovery singular-repair-only", () => {
    const source = { id: "prompt-1", text: "Preserve inventory." };
    let lower = 0;
    let upper = MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES;
    while (lower < upper) {
      const midpoint = Math.ceil((lower + upper) / 2);
      const rendered = formatRequirementDefinitionPrompt(
        [source],
        singleDraft("boundary-revision", `Requirement 1: ${"d".repeat(midpoint)}`),
      );
      if (rendered.includes("Latest deterministic diagnostics:")) lower = midpoint;
      else upper = midpoint - 1;
    }

    const exact = singleDraft("boundary-revision", `Requirement 1: ${"d".repeat(lower)}`);
    const exactRecovery = formatRequirementDefinitionPrompt([source], exact);
    expect(Buffer.byteLength(exactRecovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(exactRecovery).toContain("Latest deterministic diagnostics:");
    expect(exactRecovery).toContain("next_required_action: repair_definition");

    const overflow = singleDraft("boundary-revision", `Requirement 1: ${"d".repeat(lower + 1)}`);
    const overflowRecovery = formatRequirementDefinitionPrompt([source], overflow);
    expect(Buffer.byteLength(overflowRecovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(overflowRecovery).not.toContain("Latest deterministic diagnostics:");
    expect(overflowRecovery).toContain("next_required_action: repair_definition");
    expect(overflowRecovery).toContain('replacement action "define" is not accepted');
  });

  it("keeps a controller-consistent selected repair when recovery would exceed the ceiling", () => {
    const source: TaskVerificationSourcePrompt = {
      id: "near-limit-spec",
      kind: "referenced_file",
      path: "LIMIT.md",
      sha256: "d".repeat(64),
      text: "",
    };
    let normalPrompt = "";
    let boundedText = "";
    for (let count = 1; count <= 200; count++) {
      source.text += `- Preserve field${count} exactly.\n`;
      const candidate = renderRequirementDefinitionPrompt([source]);
      if (candidate.normalPromptExceedsLimit) break;
      normalPrompt = candidate.text;
      boundedText = source.text;
    }
    source.text = boundedText;
    const draft = largeDraft("bounded-revision", 96);

    const recovery = formatRequirementDefinitionPrompt([source], draft);

    expect(Buffer.byteLength(recovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(recovery).toContain("ACTIVE REJECTED DEFINITION BATCH");
    expect(recovery).toContain("definition_revision: bounded-revision");
    expect(recovery).toContain("next_required_action: repair_definition");
    expect(recovery).toContain('replacement action "define" is not accepted');

    const lineageDraft = largeDraft("lineage-revision", 1);
    expect(
      repairRejectedRequirementDefinition(lineageDraft, {
        action: "repair_definition",
        definition_revision: lineageDraft.revision,
        requirement_repairs: [{ requirement_index: 1, replacements: [lineageDraft.input.requirements![0]!] }],
      }),
    ).toContain("cumulative net growth permits at most 16");
    const lineageRecovery = formatRequirementDefinitionPrompt([source], lineageDraft);
    expect(Buffer.byteLength(lineageRecovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(lineageRecovery).toContain("definition_revision: lineage-revision");
    expect(lineageRecovery).toContain("next_required_action: repair_definition");
    expect(normalPrompt).not.toContain("ACTIVE REJECTED DEFINITION BATCH");
  });

  it("does not authorize an unnamed repair when the selected target itself exceeds the ceiling", () => {
    const draft = singleDraft("oversized-selected-revision", "Requirement 1 is compound.");
    draft.input.requirements![0]!.text = "x".repeat(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    draft.input.requirements![0]!.acceptance_criterion = "y".repeat(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);

    const recovery = formatRequirementDefinitionPrompt([{ id: "prompt-1", text: "Preserve inventory." }], draft);

    expect(Buffer.byteLength(recovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(recovery).toContain("SELECTED REPAIR EXCEEDS THE DEFINITION LIMIT");
    expect(recovery).toContain("next_required_action: status");
    expect(recovery).not.toContain("next_required_action: repair_definition");
    expect(recovery).toContain("Do not submit a repair");
    expect(recovery).not.toContain("reduce only the selected indexed item");
  });

  it("blocks direct-only definition and recovery prompts whose authoritative source exceeds the ceiling", () => {
    const source = { id: "prompt-1", text: `Preserve all cases. ${"x".repeat(40_000)}` };
    const draft = largeDraft("oversized-direct-revision", 1);

    for (const rendered of [
      formatRequirementDefinitionPrompt([source]),
      formatRequirementDefinitionPrompt([source], draft),
    ]) {
      expect(Buffer.byteLength(rendered)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
      expect(rendered).toContain("AUTHORITATIVE SOURCE EXCEEDS THE DEFINITION LIMIT");
      expect(rendered).toContain("Do not define or implement a partial subset");
      expect(rendered).toContain("start a fresh task or session");
      expect(rendered).not.toContain("ACTIVE REJECTED DEFINITION BATCH");
      expect(rendered).not.toContain("x".repeat(100));
    }
  });
});

function largeDraft(revision: string, baseline: number): RejectedRequirementDefinitionDraft {
  return {
    revision,
    diagnostics: "Requirement 1 must map the referenced source.",
    repairLineageBaselineRequirementCount: baseline,
    bestDiagnosticCount: 1,
    unproductiveRepairAttempts: 0,
    input: {
      action: "define",
      requirements: Array.from({ length: 96 }, (_value, index) => ({
        type: "behavior" as const,
        text: `Preserve rejected field ${index + 1} exactly ${"x".repeat(120)}`,
        acceptance_criterion: `Rejected field ${index + 1} remains exact after recovery ${"y".repeat(120)}`,
        source_prompt_indexes: [1],
      })),
    },
  };
}

function singleDraft(revision: string, diagnostics: string): RejectedRequirementDefinitionDraft {
  return {
    revision,
    diagnostics,
    repairLineageBaselineRequirementCount: 1,
    bestDiagnosticCount: diagnostics.trim() ? 1 : 0,
    unproductiveRepairAttempts: 0,
    input: {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Preserve inventory",
          acceptance_criterion: "Inventory is preserved",
          source_prompt_indexes: [1],
        },
      ],
    },
  };
}
