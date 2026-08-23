import { describe, expect, it } from "vitest";
import {
  formatRequirementDefinitionDiagnostics,
  MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES,
  validateRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement definition diagnostic boundaries", () => {
  it("preserves the direct single-diagnostic compatibility format", () => {
    expect(formatRequirementDefinitionDiagnostics(["One deterministic error."])).toBe("One deterministic error.");
  });

  it("bounds a single control-bearing multibyte diagnostic without corrupting UTF-8", () => {
    const formatted = formatRequirementDefinitionDiagnostics([`Unknown\u001b diagnostic ${"😀".repeat(20_000)}`]);

    expect(Buffer.byteLength(formatted, "utf8")).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES);
    expect(formatted).not.toContain("\u001b");
    expect(formatted).not.toContain("�");
    expect(formatted).toContain("[1 instance]");
  });

  it("bounds schema-maximal relational diagnostics while representing every repair class", () => {
    const clauseCount = 128;
    const prompts = sourcePrompts(
      Array.from({ length: clauseCount }, (_unused, index) => `- Reject invalid payload case ${index + 1}.`).join("\n"),
    );
    const sourceClauseIds = Array.from({ length: clauseCount }, (_unused, index) => `S2-C${index + 1}`);
    const input: RequirementAuditInput = {
      action: "define",
      requirements: Array.from({ length: 64 }, (_unused, index) => ({
        type: "behavior" as const,
        text: "Create the unrelated archive",
        acceptance_criterion: `Archive slot ${index + 1} exists`,
        source_prompt_indexes: [1, 2],
        source_clause_ids: sourceClauseIds,
      })),
      ignored_source_prompts: [],
      ignored_source_clauses: [
        {
          source_clause_id: "S2-C1",
          classification: "informational",
          reason: "Treat as context",
        },
      ],
    };

    const validation = validateRequirementDefinition(prompts, input);
    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics).toHaveLength(8_194);
    const formatted = formatRequirementDefinitionDiagnostics(validation.diagnostics);

    expect(Buffer.byteLength(formatted, "utf8")).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES);
    expect(formatted).toContain("8194 deterministic validation errors");
    expect(formatted).toContain("across 3 repair classes");
    expect(formatted).toContain("[8192 instances]");
    expect(formatted).toContain("8191 additional diagnostic instances are not expanded");
    expect(formatted).toContain("does not semantically support the mapped requirement");
    expect(formatted).toContain("cannot be ignored as informational");
    expect(formatted).toContain("cannot be both mapped and ignored");
    expect(formatRequirementDefinitionDiagnostics(validation.diagnostics)).toBe(formatted);
  });

  it("treats an empty referenced source as completely classified", () => {
    const validation = validateRequirementDefinition(sourcePrompts(""), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Complete the requested task",
          acceptance_criterion: "The requested task is complete",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(1);
  });

  it("does not retain a requirement whose source prompt list is empty", () => {
    const validation = validateRequirementDefinition(sourcePrompts("Preserve the event log on failed writes."), {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "Preserve the event log on failed writes",
          acceptance_criterion: "The event log remains unchanged after a failed write",
          source_prompt_indexes: [],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [{ source_prompt_index: 1, reason: "Non-requirement delegation context" }],
      ignored_source_clauses: [],
    });

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics).toEqual(["Requirement 1 references an invalid source_prompt_index."]);
  });

  it("does not duplicate a missing mapped prompt index as global unclassified noise", () => {
    const validation = validateRequirementDefinition(sourcePrompts("Reject invalid access tokens."), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Reject invalid access tokens",
          acceptance_criterion: "Invalid access tokens are rejected",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics).toEqual(["Requirement 1 maps source clause S2-C1 without its source_prompt_index."]);
  });
});

function sourcePrompts(referencedText: string): TaskVerificationSourcePrompt[] {
  return [
    { id: "prompt-1", kind: "user_prompt", text: "Implement every requirement in SPEC.md." },
    {
      id: "source-1",
      kind: "referenced_file",
      path: "SPEC.md",
      sha256: "a".repeat(64),
      text: referencedText,
    },
  ];
}
