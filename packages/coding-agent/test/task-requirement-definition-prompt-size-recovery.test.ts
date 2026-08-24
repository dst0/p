import { describe, expect, it } from "vitest";
import { MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES } from "../src/core/task-verification/referenced-requirement-sources.ts";
import {
  formatRequirementDefinitionPrompt,
  renderRequirementDefinitionPrompt,
} from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  type RejectedRequirementDefinitionDraft,
  rejectedDraftFreshDefinitionReason,
  repairRejectedRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-repair.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement definition prompt size recovery", () => {
  it("keeps exact-ceiling recovery repairable and authorizes define at one byte over", () => {
    const source = { id: "prompt-1", text: "Preserve inventory." };
    const base = singleDraft("boundary-revision", "");
    const baseLength = Buffer.byteLength(formatRequirementDefinitionPrompt([source], base));
    const padding = MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES - baseLength;
    expect(padding).toBeGreaterThan(0);

    const exact = singleDraft("boundary-revision", "d".repeat(padding));
    const exactRecovery = formatRequirementDefinitionPrompt([source], exact);
    expect(Buffer.byteLength(exactRecovery)).toBe(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(exactRecovery).toContain("next_required_action: repair_definition");
    expect(rejectedDraftFreshDefinitionReason(exact)).toBeUndefined();

    const overflow = singleDraft("boundary-revision", "d".repeat(padding + 1));
    const overflowRecovery = formatRequirementDefinitionPrompt([source], overflow);
    expect(Buffer.byteLength(overflowRecovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(overflowRecovery).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(overflow)).toBe("recovery_prompt_limit");
  });

  it("authorizes a controller-consistent full definition when recovery would exceed the ceiling", () => {
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
    expect(recovery).toContain("next_required_action: define");
    expect(recovery).toContain('Call record_requirement_audit with action "define"');
    expect(rejectedDraftFreshDefinitionReason(draft)).toBe("recovery_prompt_limit");

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
    expect(lineageRecovery).toContain("next_required_action: define");
    expect(rejectedDraftFreshDefinitionReason(lineageDraft)).toBe("lineage_growth");
    expect(normalPrompt).not.toContain("ACTIVE REJECTED DEFINITION BATCH");
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
    expect(rejectedDraftFreshDefinitionReason(draft)).toBeUndefined();
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
