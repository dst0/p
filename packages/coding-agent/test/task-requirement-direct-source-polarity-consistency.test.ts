import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";

describe("direct source polarity consistency", () => {
  it("rejects an acceptance criterion that reverses matching requirement text", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      definition("Unauthenticated requests are rejected", "Unauthenticated requests are accepted"),
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("rejects requirement text that reverses a matching acceptance criterion", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      definition("Unauthenticated requests are accepted", "Unauthenticated requests are rejected"),
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("does not polarity-check an unrelated acceptance domain", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      definition("Unauthenticated requests are rejected", "Valid recovery manifests are accepted"),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects a mapping that omits the source behavior", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      definition("Unauthenticated requests are logged", "Every unauthenticated request is recorded"),
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("accepts agreeing rejection synonyms", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      definition("Unauthenticated requests are denied", "Every unauthenticated request is blocked"),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects omission of an access-control prerequisite", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Authentication is required for admin access." }],
      definition(
        "Authentication attempts for admin access are logged",
        "Every admin authentication attempt is recorded",
      ),
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("accepts agreeing access-control prerequisite synonyms", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Authentication is required for admin access." }],
      definition("Authentication is mandatory for admin access", "Admin access requires authentication"),
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects omission of one side of a dual access-control clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected and authenticated requests must be accepted.",
        },
      ],
      definition("Unauthenticated requests must be rejected", "Every unauthenticated request is denied"),
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("accepts aggregate mappings for both sides of a dual access-control clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected and authenticated requests must be accepted.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "Every unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "behavior",
            text: "Authenticated requests are accepted",
            acceptance_criterion: "Every authenticated request is allowed",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("treats preserving state without mutation as preservation", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Failed recovery preserves state without partial mutation." }],
      definition("Failed recovery preserves state", "State remains unchanged after failed recovery"),
    );

    expect(validation.diagnostics).toEqual([]);
  });
});

function definition(text: string, acceptanceCriterion: string) {
  return {
    action: "define" as const,
    requirements: [
      {
        type: "behavior" as const,
        text,
        acceptance_criterion: acceptanceCriterion,
        source_prompt_indexes: [1],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  };
}
