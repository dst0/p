import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementAuditInput, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement collection closure boundaries", () => {
  it.each(["exactly these", "only these"])(
    "keeps the %s collection qualifier on the introduction instead of distributing it to a child",
    (collectionQualifier) => {
      const validation = validateRequirementDefinition(sources(collectionQualifier), definition());

      expect(validation.diagnostics).toEqual([]);
      expect(validation.definition?.requirements).toHaveLength(2);
    },
  );

  it.each([
    "at most these top-level keys",
    "the following top-level keys only",
    "strictly the following top-level keys",
    "no other top-level keys than the following",
  ])("requires the %s collection closure to be mapped explicitly", (collectionPhrase) => {
    const input = definition();
    input.requirements = input.requirements?.slice(1);

    expect(validateRequirementDefinition(sources(collectionPhrase), input).diagnostics.join("\n")).toContain(
      "unclassified source_clause_ids: S1-C1",
    );
  });

  it("continues to enforce inherited universal qualifiers", () => {
    const input = definition("The handoff.json summary key has scalar value ready", "The summary equals ready");
    input.requirements = input.requirements?.slice(1);

    expect(
      validateRequirementDefinition(sources("every listed top-level key"), input).diagnostics.join("\n"),
    ).toContain("universal qualifiers");
  });

  it("does not treat conditional postpositive only as a collection closure", () => {
    const conditionalSources: TaskVerificationSourcePrompt[] = [
      {
        id: "authorized-operation-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: "The following operations are allowed only when authorized:\n1. Update state.",
      },
    ];
    const input: RequirementAuditInput = {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Update state",
          acceptance_criterion: "State is updated",
          source_clause_ids: ["S1-C2"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    };

    expect(validateRequirementDefinition(conditionalSources, input).diagnostics.join("\n")).toContain(
      "universal qualifiers or quantity constraints missing from the mapped requirement: only",
    );
  });
});

function sources(collectionPhrase: string): TaskVerificationSourcePrompt[] {
  return [
    {
      id: "handoff-spec",
      kind: "referenced_file",
      path: "SPEC.md",
      text: `Create \`handoff.json\` with ${collectionPhrase}:\n1. \`summary\`: \`ready\`.`,
    },
  ];
}

function definition(
  text = "The handoff.json summary key has scalar value ready",
  acceptanceCriterion = "The handoff.json summary equals ready",
): RequirementAuditInput {
  return {
    action: "define",
    requirements: [
      {
        type: "constraint",
        text: "handoff.json has exactly the specified top-level key collection",
        acceptance_criterion: "handoff.json has no top-level keys outside the specified collection",
        source_clause_ids: ["S1-C1"],
      },
      {
        type: "behavior",
        text,
        acceptance_criterion: acceptanceCriterion,
        source_clause_ids: ["S1-C2"],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}
