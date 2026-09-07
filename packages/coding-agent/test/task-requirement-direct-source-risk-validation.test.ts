import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";

describe("direct high-risk source coverage", () => {
  it("rejects an unrelated eligible high-risk decoy", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "workflow",
            text: "Run the relevant checks",
            acceptance_criterion: "The checks pass",
            source_prompt_indexes: [1],
          },
          {
            type: "deliverable",
            text: "Persist a recovery manifest",
            acceptance_criterion: "The manifest has an integrity hash",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });

  it("requires coverage for every high-risk clause in a multi-invariant prompt", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected. Failed recovery preserves state without partial mutation.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthorized requests are rejected",
            acceptance_criterion: "An unauthorized request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "workflow",
            text: "Run the remaining checks",
            acceptance_criterion: "All remaining checks pass",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });

  it("does not let an unrelated decoy neutralize reversed polarity", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are accepted",
            acceptance_criterion: "An unauthenticated request is allowed",
            source_prompt_indexes: [1],
          },
          {
            type: "deliverable",
            text: "Reject a tampered recovery manifest",
            acceptance_criterion: "A tampered recovery manifest is rejected",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("accepts separate eligible coverage for every high-risk direct clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected. Failed recovery preserves state without partial mutation.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "constraint",
            text: "Failed recovery preserves state without partial mutation",
            acceptance_criterion: "State remains unchanged after failed recovery",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("requires every high-risk concept inside one compound direct clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected and failed recovery must preserve state without partial mutation.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "constraint",
            text: "Failed recovery preserves state without partial mutation",
            acceptance_criterion: "State remains unchanged after failed recovery",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });

  it("accepts separate eligible mappings for high-risk concepts inside one clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected and failed recovery must preserve state without partial mutation.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "constraint",
            text: "Failed recovery preserves state without partial mutation",
            acceptance_criterion: "State remains unchanged after failed recovery",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("does not polarity-check unrelated mappings from another direct clause", () => {
    const validation = validateRequirementDefinition(
      [
        {
          id: "user",
          text: "Unauthenticated requests must be rejected. Valid recovery manifests must be accepted.",
        },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "behavior",
            text: "Valid recovery manifests are accepted",
            acceptance_criterion: "A valid recovery manifest is allowed",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("rejects reversed polarity on one line when another line is correct", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected\nValid recovery manifests must be accepted" }],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are accepted",
            acceptance_criterion: "An unauthenticated request is allowed",
            source_prompt_indexes: [1],
          },
          {
            type: "behavior",
            text: "Valid recovery manifests are accepted",
            acceptance_criterion: "A valid recovery manifest is allowed",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("behavioral polarity");
  });

  it("accepts correct mappings for two newline-separated direct requirements", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Unauthenticated requests must be rejected\nValid recovery manifests must be accepted" }],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
          {
            type: "behavior",
            text: "Valid recovery manifests are accepted",
            acceptance_criterion: "A valid recovery manifest is allowed",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });
});
