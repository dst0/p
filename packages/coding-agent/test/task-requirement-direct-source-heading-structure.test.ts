import { describe, expect, it } from "vitest";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";

describe("direct source heading structure", () => {
  it("ignores a standalone structural heading before a covered direct invariant", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Security:\nUnauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("still enforces a normative invariant that follows a colon on the same line", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Security: Unauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "workflow",
            text: "Run the security checks",
            acceptance_criterion: "The security checks pass",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });

  it("ignores a non-normative Markdown heading before a covered invariant", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "## Security\nUnauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Unauthenticated requests are rejected",
            acceptance_criterion: "An unauthenticated request is denied",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it("enforces a high-risk invariant written as a Markdown heading", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "## Unauthenticated requests must be rejected." }],
      {
        action: "define",
        requirements: [
          {
            type: "workflow",
            text: "Run the relevant checks",
            acceptance_criterion: "The relevant checks pass",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });
});
