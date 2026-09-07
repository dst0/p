import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("introduced list group semantics", () => {
  it("rejects a positive requirement that drops an inherited negative scope", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Delete customer records")]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("accepts an explicit inherited negative scope", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Never delete customer records")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects a negative marker bound to a different behavior", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Do not notify staff before deleting customer records")]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("rejects the same negated behavior when it is bound to a different object", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Do not delete audit logs before deleting customer records")]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it.each([
    "Do not delete customer records unless an administrator approves",
    "Never delete customer records except archived records",
    "Never delete customer records before migration",
  ])("rejects an unmentioned boundary that weakens an absolute negative scope: %s", (requirementText) => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], requirementText)]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("accepts a source-declared negative boundary with the same protected proposition", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following unless an administrator approves:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Never delete customer records unless an administrator approves")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it.each([
    ["Delete customer records", "Never delete customer records"],
    ["Never delete customer records", "Delete customer records"],
    [
      "Never delete customer records. Delete customer records after backup",
      "Never delete customer records. Delete customer records after backup",
    ],
  ])("rejects a positive reversal elsewhere in the requirement: %s", (text, acceptanceCriterion) => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], text, acceptanceCriterion)]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("accepts an outcome criterion that explicitly rejects the protected behavior", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([
        requirement(["S1-C2"], "Never delete customer records", "Attempts to delete customer records are rejected"),
      ]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("accepts a passive negative criterion whose protected subject precedes the predicate", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Never delete customer records", "Customer records are not deleted")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it.each(["Attempts to delete customer records are not rejected", "Deleting customer records is not prevented"])(
    "rejects a negated denial outcome that reverses the protected behavior: %s",
    (acceptanceCriterion) => {
      const validation = validateRequirementDefinition(
        sources("Never do the following:\n- delete customer records."),
        definition([requirement(["S1-C2"], "Never delete customer records", acceptanceCriterion)]),
      );

      expect(validation.definition).toBeUndefined();
      expect(validation.diagnostics.join("\n")).toContain("negative scope");
    },
  );

  it.each([
    "Attempts to delete customer records are rejected and customer records are deleted later",
    "Deleting customer records is blocked but deleting customer records is permitted later",
  ])("rejects a positive reversal hidden behind a denial conjunction: %s", (acceptanceCriterion) => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- delete customer records."),
      definition([requirement(["S1-C2"], "Never delete customer records", acceptanceCriterion)]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("does not collapse a protected noun into a different word by removing a terminal s", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- archive news reports."),
      definition([requirement(["S1-C2"], "Never archive new reports")]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("still matches conservative regular plural inflections", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- archive reports."),
      definition([requirement(["S1-C2"], "Never archive report")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("retains nested ancestor subjects when binding an inherited negative scope", () => {
    const validation = validateRequirementDefinition(
      sources("Never do the following:\n- customer data:\n  - delete records."),
      definition([requirement(["S1-C3"], "Never delete audit records")]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("negative scope");
  });

  it("does not treat only inside a hyphenated word as a list qualifier", () => {
    const validation = validateRequirementDefinition(
      sources("Read-only operations must:\n- use cached records."),
      definition([requirement(["S1-C2"], "Read operations use cached records")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects choice siblings split across contradictory independent requirements", () => {
    const validation = validateRequirementDefinition(
      sources("Select exactly one of:\n- email.\n- SMS."),
      definition([
        requirement(["S1-C2"], "Select exactly one of email"),
        requirement(["S1-C3"], "Select exactly one of SMS"),
      ]),
    );

    expect(validation.definition).toBeUndefined();
    expect(validation.diagnostics.join("\n")).toContain("choice/cardinality group");
  });

  it("accepts one coordinated requirement that preserves every choice sibling", () => {
    const validation = validateRequirementDefinition(
      sources("Select exactly one of:\n- email.\n- SMS."),
      definition([requirement(["S1-C2", "S1-C3"], "Select exactly one of email or SMS")]),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("keeps distributive siblings independently atomic", () => {
    const validation = validateRequirementDefinition(
      sources("Every handoff must:\n- preserve the decision.\n- identify the owner."),
      definition([
        requirement(["S1-C2"], "Every handoff preserves the decision"),
        requirement(["S1-C3"], "Every handoff identifies the owner"),
      ]),
    );

    expect(validation.diagnostics).toEqual([]);
  });
});

function sources(text: string): TaskVerificationSourcePrompt[] {
  return [{ id: "spec", kind: "referenced_file", path: "SPEC.md", text }];
}

function requirement(
  sourceClauseIds: string[],
  text: string,
  acceptanceCriterion: string = text,
): NonNullable<RequirementAuditInput["requirements"]>[number] {
  return {
    type: "behavior",
    text,
    acceptance_criterion: acceptanceCriterion,
    source_clause_ids: sourceClauseIds,
  };
}

function definition(requirements: NonNullable<RequirementAuditInput["requirements"]>): RequirementAuditInput {
  return { action: "define", requirements, ignored_source_prompts: [], ignored_source_clauses: [] };
}
