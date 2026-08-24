import { describe, expect, it } from "vitest";
import { directPromptSupersedesClause } from "../src/core/task-verification/requirement-clause-semantics.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement-audit identifier boundaries", () => {
  it.each([
    {
      identifier: "expectedVersion",
      source: "`expectedVersion` must match the version.",
      text: "Reject an expected version mismatch",
      acceptanceCriterion: "An expected version mismatch throws ConcurrencyError",
    },
    {
      identifier: "commandId",
      source: "`commandId` must be stable.",
      text: "Keep the command ID stable",
      acceptanceCriterion: "The command ID remains stable",
    },
    {
      identifier: "executeBatch",
      source: "`executeBatch` must be callable.",
      text: "Expose execute batch",
      acceptanceCriterion: "Clients can call execute batch",
    },
    {
      identifier: "HTTPServer",
      source: "`HTTPServer` must be callable.",
      text: "Expose HTTP server",
      acceptanceCriterion: "Clients can call HTTP server",
    },
    {
      identifier: "node_modules",
      source: "`node_modules` must remain unchanged.",
      text: "Preserve node modules",
      acceptanceCriterion: "Node modules remain unchanged",
    },
  ])(
    "matches camelCase identifier $identifier to spaced requirement wording",
    ({ source, text, acceptanceCriterion }) => {
      const validation = validateRequirementDefinition(sourcePrompts(source), {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text,
            acceptance_criterion: acceptanceCriterion,
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      });

      expect(validation.diagnostics).toEqual([]);
      expect(validation.definition?.requirements).toHaveLength(1);
    },
  );

  it.each([
    ["SKUs", "SKU"],
    ["APIs", "API"],
    ["IDs", "ID"],
  ])("matches plural acronym %s to singular %s wording", (plural, singular) => {
    const validation = validateRequirementDefinition(sourcePrompts(`All ${plural} must remain stable.`), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: `Keep each ${singular} stable`,
          acceptance_criterion: `Each ${singular} remains stable`,
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(1);
  });

  it("accepts exact command identities split from one coordinated verification clause", () => {
    const validation = validateRequirementDefinition(
      sourcePrompts("Run `npm test` and `npm run typecheck` before finishing."),
      {
        action: "define",
        requirements: [
          {
            type: "verification",
            text: "Pass npm test",
            acceptance_criterion: "npm test passes",
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1"],
          },
          {
            type: "verification",
            text: "Pass npm run typecheck",
            acceptance_criterion: "npm run typecheck passes",
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(2);
  });

  it("rejects a different command that shares only the runner prefix", () => {
    const validation = validateRequirementDefinition(
      sourcePrompts("Run `npm test` and `npm run typecheck` before finishing."),
      {
        action: "define",
        requirements: [
          {
            type: "verification",
            text: "Pass npm run lint",
            acceptance_criterion: "npm run lint passes",
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toContain(
      "Requirement 1: Source clause S2-C1 does not semantically support the mapped requirement.",
    );
    expect(validation.definition).toBeUndefined();
  });

  it("retains per-edge semantic validation after identifier splitting", () => {
    const validation = validateRequirementDefinition(
      sourcePrompts(["`executeBatch` must be callable.", "Delete every cached archive."].join("\n")),
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Expose execute batch",
            acceptance_criterion: "Clients can call execute batch",
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1", "S2-C2"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toContain(
      "Requirement 1: Source clause S2-C2 does not semantically support the mapped requirement.",
    );
    expect(validation.definition).toBeUndefined();
  });

  it("rejects a different compound identifier that shares generic components", () => {
    const validation = validateRequirementDefinition(sourcePrompts("`deleteBatch` must execute a batch."), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Expose executeBatch",
          acceptance_criterion: "Execute batch executes a batch",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics).toContain(
      "Requirement 1: Source clause S2-C1 does not semantically support the mapped requirement.",
    );
    expect(validation.definition).toBeUndefined();
  });

  it("allows an atomic requirement to preserve the primary and its specific case identifier", () => {
    const validation = validateRequirementDefinition(sourcePrompts("`executeBatch` checks `expectedVersion`."), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Have executeBatch validate expectedVersion",
          acceptance_criterion: "Execute batch checks the expected version",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics).toEqual([]);
    expect(validation.definition?.requirements).toHaveLength(1);
  });

  it.each([
    {
      source: "`deleteBatch` returns `BatchResult`.",
      text: "Have executeBatch return BatchResult",
      acceptanceCriterion: "Execute batch returns a batch result",
    },
    {
      source: "`delete_batch` must reject invalid batches.",
      text: "Have execute_batch reject invalid batches",
      acceptanceCriterion: "Execute batch rejects every invalid batch",
    },
  ])(
    "rejects wrong primary identifier despite shared secondary identity: $source",
    ({ source, text, acceptanceCriterion }) => {
      const validation = validateRequirementDefinition(sourcePrompts(source), {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text,
            acceptance_criterion: acceptanceCriterion,
            source_prompt_indexes: [1, 2],
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      });

      expect(validation.diagnostics).toContain(
        "Requirement 1: Source clause S2-C1 does not semantically support the mapped requirement.",
      );
      expect(validation.definition).toBeUndefined();
    },
  );

  it("retains polarity rejection after identifier splitting", () => {
    const validation = validateRequirementDefinition(sourcePrompts("`executeBatch` must reject invalid batches."), {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Allow execute batch invalid input",
          acceptance_criterion: "Execute batch accepts invalid batches",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(validation.diagnostics).toContain(
      "Requirement 1: Source clause S2-C1 has behavioral polarity that the mapped requirement reverses.",
    );
    expect(validation.definition).toBeUndefined();
  });

  it("does not broaden supersession through partial identifier components", () => {
    expect(
      directPromptSupersedesClause("Instead, accept invalid batch uploads.", {
        id: "S2-C1",
        sourcePromptIndex: 2,
        kind: "prose",
        text: "`deleteBatch` must reject invalid record IDs.",
      }),
    ).toBe(false);
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
