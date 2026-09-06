import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import { pureDelegationPromptIndexes } from "../src/core/task-verification/requirement-prompt-classification.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("pure delegation prompt classification", () => {
  it.each([
    "Implement every requirement from SPEC.md in validator.js. Use validator.test.js for focused executable evidence and finish through the requirement-verification controller.",
    "Read and implement every requirement from SPEC.md.",
    "Implement all of the requirements from SPEC.md.",
    "Please implement every requirement from SPEC.md.",
    "Implement every requirement from SPEC.md, then finish verification.",
  ])("rejects an invented standalone deliverable for workflow-only prompt: %s", (directPrompt) => {
    const result = validateRequirementDefinition(sourcePrompts(directPrompt), {
      action: "define",
      requirements: [
        {
          type: "deliverable",
          text: "Implement widget",
          acceptance_criterion: "The widget is implemented",
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "deliverable",
          text: "Implement the requested workspace change",
          acceptance_criterion: "The requested workspace change is complete",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(result.definition).toBeUndefined();
    expect(result.diagnostics.join("\n")).toContain("pure delegation/workflow prompt index 1");
    expect(result.diagnostics.join("\n")).toContain("ignored_source_prompt_upserts");
  });

  it.each([
    "Implement every requirement from SPEC.md and add an audit log.",
    "Implement every requirement from SPEC.md, adding an audit log.",
    "Implement every requirement from SPEC.md plus add an audit log.",
  ])("preserves independently actionable residual prose: %s", (directPrompt) => {
    const result = validateRequirementDefinition(sourcePrompts(directPrompt), {
      action: "define",
      requirements: [
        {
          type: "deliverable",
          text: "Add an audit log",
          acceptance_criterion: "The audit log records validation decisions",
          source_prompt_indexes: [1],
        },
        {
          type: "deliverable",
          text: "Implement widget",
          acceptance_criterion: "The widget is implemented",
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.definition?.requirements).toHaveLength(2);
  });

  it("does not treat an unqualified product controller as verification workflow", () => {
    const result = validateRequirementDefinition(
      sourcePrompts("Implement every requirement from SPEC.md. Complete the controller."),
      {
        action: "define",
        requirements: [
          {
            type: "deliverable",
            text: "Complete the controller",
            acceptance_criterion: "The product controller is complete",
            source_prompt_indexes: [1],
          },
          {
            type: "deliverable",
            text: "Implement widget",
            acceptance_criterion: "The widget is implemented",
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("rejects pure direct provenance even when the requirement also maps a referenced clause", () => {
    const result = validateRequirementDefinition(sourcePrompts("Implement every requirement from SPEC.md."), {
      action: "define",
      requirements: [
        {
          type: "deliverable",
          text: "Implement widget",
          acceptance_criterion: "The widget is implemented",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(result.definition).toBeUndefined();
    expect(result.diagnostics.join("\n")).toContain("pure delegation/workflow prompt index 1");
  });

  it("resolves unique basenames and Unicode-equivalent prepared paths", () => {
    expect([
      ...pureDelegationPromptIndexes(sourcePrompts("Implement every requirement from SPEC.md.", "docs/SPEC.md")),
    ]).toEqual([1]);
    expect([
      ...pureDelegationPromptIndexes(
        sourcePrompts("Implement every requirement from Re\u0301sume\u0301.md.", "docs/Résumé.md"),
      ),
    ]).toEqual([1]);
  });

  it("rejects suffix matches and ambiguous prepared basenames", () => {
    expect([
      ...pureDelegationPromptIndexes(sourcePrompts("Implement every requirement from myapi.md.", "api.md")),
    ]).toEqual([]);
    expect(
      pureDelegationPromptIndexes([
        { id: "p1", kind: "user_prompt", text: "Implement every requirement from SPEC.md." },
        referencedPrompt("a", "docs/SPEC.md"),
        referencedPrompt("b", "other/SPEC.md"),
      ]),
    ).toEqual(new Set());
  });
});

function sourcePrompts(
  directPrompt: string,
  referencedPath = "SPEC.md",
  referencedText = "Implement widget.",
): TaskVerificationSourcePrompt[] {
  return [
    { id: "p1", kind: "user_prompt", text: directPrompt },
    {
      id: "spec",
      kind: "referenced_file",
      path: referencedPath,
      sha256: "0".repeat(64),
      text: referencedText,
    },
  ];
}

function referencedPrompt(id: string, path: string): TaskVerificationSourcePrompt {
  return {
    id,
    kind: "referenced_file",
    path,
    sha256: "0".repeat(64),
    text: "Implement widget.",
  };
}
