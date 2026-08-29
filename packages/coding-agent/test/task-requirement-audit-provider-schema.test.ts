import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { RequirementAuditSchema } from "../src/core/task-verification/constants.ts";

describe("requirement audit provider schema", () => {
  it("keeps a provider-compatible root object", () => {
    expect(RequirementAuditSchema).toHaveProperty("type", "object");
    expect(RequirementAuditSchema).toHaveProperty("properties.action");
    expect(RequirementAuditSchema).not.toHaveProperty("anyOf");
  });

  it("accepts one indexed repair item and rejects two", () => {
    expect(Value.Check(RequirementAuditSchema, repairInput([replacement("Atomic behavior")]))).toBe(true);
    expect(
      Value.Check(
        RequirementAuditSchema,
        repairInput([replacement("First correction"), replacement("Second correction", 2)]),
      ),
    ).toBe(false);
  });

  it("allows one compound item to split into multiple atomic replacements", () => {
    expect(
      Value.Check(
        RequirementAuditSchema,
        repairInput([
          {
            requirement_index: 1,
            replacements: Array.from({ length: 5 }, (_value, index) => requirement(`Atomic case ${index + 1}`)),
          },
        ]),
      ),
    ).toBe(true);
  });

  it("requires each present classification repair array to contain exactly one item", () => {
    const base = { action: "repair_definition", definition_revision: "revision" };
    expect(Value.Check(RequirementAuditSchema, { ...base, ignored_source_prompt_removals: [1] })).toBe(true);
    expect(Value.Check(RequirementAuditSchema, { ...base, ignored_source_prompt_removals: [] })).toBe(false);
    expect(Value.Check(RequirementAuditSchema, { ...base, ignored_source_prompt_removals: [1, 2] })).toBe(false);
    expect(Value.Check(RequirementAuditSchema, { ...base, ignored_source_clause_removals: ["S1-C1"] })).toBe(true);
    expect(Value.Check(RequirementAuditSchema, { ...base, ignored_source_clause_removals: [] })).toBe(false);
  });

  it("allows a single indexed requirement deletion", () => {
    expect(Value.Check(RequirementAuditSchema, repairInput([{ requirement_index: 1, replacements: [] }]))).toBe(true);
  });
});

function repairInput(requirementRepairs: ReturnType<typeof replacement>[]) {
  return {
    action: "repair_definition",
    definition_revision: "revision",
    requirement_repairs: requirementRepairs,
  };
}

function replacement(text: string, requirementIndex: number = 1) {
  return { requirement_index: requirementIndex, replacements: [requirement(text)] };
}

function requirement(text: string) {
  return {
    type: "behavior" as const,
    text,
    acceptance_criterion: `${text} is independently satisfied`,
    source_prompt_indexes: [1],
  };
}
