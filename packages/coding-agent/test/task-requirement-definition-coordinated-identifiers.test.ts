import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

const SHIPPING_CLAUSE = "Shipping reduces both `onHand` and the reservation.";
const SOURCES: TaskVerificationSourcePrompt[] = [
  { id: "prompt", text: "Implement the complete referenced inventory specification." },
  { id: "spec", kind: "referenced_file", path: "README.md", text: SHIPPING_CLAUSE },
];

describe("coordinated identifier requirement definitions", () => {
  it("accepts atomic object splits mapped to one coordinated source clause", () => {
    const validation = validate(shippingRequirements());

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(2);
  });

  it.each([
    "Shipping reduces both the `onHand` and the `reservation`.",
    "Shipping reduces both `onHand` and the order reservation by the shipped quantity.",
  ])("accepts coordinated articles, multi-word objects, and trailing qualifiers: %s", (source) => {
    const validation = validate(shippingRequirements(), source);

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(2);
  });

  it("still rejects an unrelated object mapped to the coordinated source clause", () => {
    const validation = validate([
      {
        type: "behavior",
        text: "Shipping reduces an invoice balance",
        acceptance_criterion: "Shipping an item reduces the customer invoice balance",
        source_prompt_indexes: [1],
        source_clause_ids: ["S2-C1"],
        source_facet_ids: ["S2-C1-F1"],
      },
    ]);

    expect(validation.diagnostics.join("\n")).toContain("does not semantically support the mapped requirement");
    expect(validation.diagnostics.join("\n")).toContain("uncovered source facets: S2-C1-F1, S2-C1-F2");
    expect(validation.definition).toBeUndefined();
  });
});

function validate(requirements: NonNullable<RequirementAuditInput["requirements"]>, source: string = SHIPPING_CLAUSE) {
  return validateRequirementDefinition(
    source === SHIPPING_CLAUSE ? SOURCES : [SOURCES[0]!, { ...SOURCES[1]!, text: source }],
    {
      action: "define",
      requirements,
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    },
  );
}

function shippingRequirements() {
  return [
    {
      type: "behavior" as const,
      text: "Shipping reduces onHand",
      acceptance_criterion: "Shipping an item reduces onHand by the shipped quantity",
      source_prompt_indexes: [1],
      source_clause_ids: ["S2-C1"],
      source_facet_ids: ["S2-C1-F1"],
    },
    {
      type: "behavior" as const,
      text: "Shipping reduces the reservation",
      acceptance_criterion: "Shipping an item reduces the order reservation by the shipped quantity",
      source_prompt_indexes: [1],
      source_clause_ids: ["S2-C1"],
      source_facet_ids: ["S2-C1-F2"],
    },
  ];
}
