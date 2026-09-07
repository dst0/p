import { describe, expect, it } from "vitest";
import {
  clauseRequirementRelevanceError,
  sourceClauseConceptCoverageError,
} from "../src/core/task-verification/requirement-clause-semantics.ts";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import type { RequirementSourceClause } from "../src/core/task-verification/requirement-source-clauses.ts";
import { requirementSourceFacets } from "../src/core/task-verification/requirement-source-facets.ts";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";

const ATOMIC_BATCH_CLAUSE: RequirementSourceClause = {
  id: "S2-C39",
  sourcePromptIndex: 2,
  kind: "prose",
  text: "A batch is atomic across all SKUs: either all commands and idempotency records commit in order, or no observable state changes.",
  normativeHint: true,
};

describe("requirement definition concept convergence", () => {
  it("derives four stable atomic facets from the explicit either-or contract", () => {
    expect(requirementSourceFacets(ATOMIC_BATCH_CLAUSE)).toEqual([
      expect.objectContaining({
        id: "S2-C39-F1",
        kind: "success_outcome",
        branch: "success",
        requiredConcepts: ["command"],
        behaviorAnchors: ["commit_in_order"],
        qualifiers: ["all SKUs", "all commands"],
        origin: "source_span",
      }),
      expect.objectContaining({
        id: "S2-C39-F2",
        kind: "success_outcome",
        branch: "success",
        requiredConcepts: ["idempotency record"],
        behaviorAnchors: ["commit_in_order"],
        qualifiers: ["all SKUs", "all idempotency records"],
        origin: "source_span",
      }),
      expect.objectContaining({
        id: "S2-C39-F3",
        kind: "failure_preservation",
        branch: "failure",
        requiredConcepts: ["state"],
        behaviorAnchors: ["preserve_state"],
        qualifiers: ["all SKUs"],
        origin: "source_span",
      }),
      expect.objectContaining({
        id: "S2-C39-F4",
        kind: "failure_preservation",
        branch: "failure",
        requiredConcepts: ["idempotency record"],
        behaviorAnchors: ["do_not_commit"],
        qualifiers: ["all SKUs"],
        origin: "derived_atomicity",
      }),
    ]);
  });

  it("discloses every source-exact critical concept before the first definition attempt", () => {
    const prompt = formatRequirementDefinitionPrompt([
      {
        id: "inventory-spec",
        kind: "referenced_file",
        path: "README.md",
        sha256: "a".repeat(64),
        text: `- ${ATOMIC_BATCH_CLAUSE.text}\n`,
      },
    ]);

    expect(prompt).toContain('"requiredConcepts"');
    expect(prompt).not.toContain('["idempotency record","state"]');
    expect(prompt).toContain('"requiredFacets"');
    expect(prompt).toContain('"S1-C1-F1"');
    expect(prompt).toContain('"S1-C1-F4"');
    expect(prompt).toContain("Map every requiredFacets entry exactly once through source_facet_ids");
  });

  it("does not let a command-ID paraphrase conceal a missing idempotency-record requirement", () => {
    expect(
      sourceClauseConceptCoverageError(ATOMIC_BATCH_CLAUSE, [
        "Failed batches do not consume command IDs.",
        "A failed batch leaves state unchanged.",
      ]),
    ).toContain("idempotency record");
  });

  it("reports all missing concepts together with atomic repair guidance", () => {
    expect(sourceClauseConceptCoverageError(ATOMIC_BATCH_CLAUSE, [])).toBe(
      "Source clause S2-C39 has uncovered normative concepts: idempotency record, state. Map each missing concept with source-exact wording in a separate atomic requirement when it is independently observable.",
    );
  });

  it("accepts a source-exact atomic split for idempotency records and state", () => {
    const idempotencyText = "Batch idempotency records commit in order";
    const idempotencyCriterion = "Every successful batch commits each idempotency record in item order";
    const stateText = "Failed batches leave observable state unchanged";
    const stateCriterion = "A failed batch leaves observable state unchanged";

    expect(clauseRequirementRelevanceError(ATOMIC_BATCH_CLAUSE, idempotencyText, idempotencyCriterion)).toBeUndefined();
    expect(clauseRequirementRelevanceError(ATOMIC_BATCH_CLAUSE, stateText, stateCriterion)).toBeUndefined();
    expect(
      sourceClauseConceptCoverageError(ATOMIC_BATCH_CLAUSE, [
        `${idempotencyText}\n${idempotencyCriterion}`,
        `${stateText}\n${stateCriterion}`,
      ]),
    ).toBeUndefined();
  });

  it.each([
    {
      name: "semantically unrelated",
      requirement: {
        type: "constraint" as const,
        text: "Encrypt idempotency records with rotating archive keys",
        acceptance_criterion: "A separate archive rotates encryption keys around idempotency records",
        source_prompt_indexes: [1],
        source_clause_ids: ["S2-C1"],
        source_facet_ids: ["S2-C1-F2"],
      },
      diagnostic: "does not semantically support",
    },
    {
      name: "compound",
      requirement: {
        type: "constraint" as const,
        text: "Failed batch idempotency records and state remain unchanged",
        acceptance_criterion: "A failed batch leaves idempotency records and state unchanged",
        source_prompt_indexes: [1],
        source_clause_ids: ["S2-C1"],
        source_facet_ids: ["S2-C1-F2"],
      },
      diagnostic: "is compound",
    },
  ])("does not let a $name requirement discharge downstream concept coverage", ({ requirement, diagnostic }) => {
    const validation = validateRequirementDefinition(
      [
        { id: "prompt", text: "Implement the complete inventory specification." },
        { id: "spec", kind: "referenced_file", path: "README.md", text: ATOMIC_BATCH_CLAUSE.text },
      ],
      {
        action: "define",
        requirements: [
          {
            type: "constraint",
            text: "Failed batches leave observable state unchanged across all SKUs",
            acceptance_criterion: "A failed batch leaves observable state unchanged across every SKU",
            source_prompt_indexes: [1],
            source_clause_ids: ["S2-C1"],
            source_facet_ids: ["S2-C1-F3"],
          },
          requirement,
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain(diagnostic);
    expect(validation.diagnostics.join("\n")).toContain("uncovered source facets: S2-C1-F1, S2-C1-F2, S2-C1-F4");
  });

  it("rejects a failure-only definition that omits atomic success facets", () => {
    const validation = validateRequirementDefinition(inventorySources(), {
      action: "define",
      requirements: [
        mappedFacetRequirement(
          "Failed batches leave observable state unchanged across all SKUs",
          "A failed batch leaves observable state unchanged across every SKU",
          "S2-C1-F3",
        ),
        mappedFacetRequirement(
          "Failed batches commit no idempotency records across all SKUs",
          "A failed batch does not commit an idempotency record for any SKU",
          "S2-C1-F4",
        ),
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    } as unknown as RequirementAuditInput);

    expect(validation.diagnostics.join("\n")).toContain("uncovered source facets: S2-C1-F1, S2-C1-F2");
  });

  it("accepts the complete four-facet atomic batch definition", () => {
    const validation = validateRequirementDefinition(inventorySources(), {
      action: "define",
      requirements: [
        mappedFacetRequirement(
          "Successful batches commit all commands in order across all SKUs",
          "A successful batch commits every command in item order across every SKU",
          "S2-C1-F1",
        ),
        mappedFacetRequirement(
          "Successful batches commit all idempotency records in order across all SKUs",
          "A successful batch commits every idempotency record in item order across every SKU",
          "S2-C1-F2",
        ),
        mappedFacetRequirement(
          "Failed batches leave observable state unchanged across all SKUs",
          "A failed batch leaves observable state unchanged across every SKU",
          "S2-C1-F3",
        ),
        mappedFacetRequirement(
          "Failed batches commit no idempotency records across all SKUs",
          "A failed batch does not commit an idempotency record for any SKU",
          "S2-C1-F4",
        ),
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    } as unknown as RequirementAuditInput);

    expect(validation.diagnostics).toEqual([]);
    expect(
      validation.definition?.requirements.map(
        (requirement) => (requirement as typeof requirement & { sourceFacetIds?: string[] }).sourceFacetIds,
      ),
    ).toEqual([["S2-C1-F1"], ["S2-C1-F2"], ["S2-C1-F3"], ["S2-C1-F4"]]);
  });
});

function inventorySources() {
  return [
    { id: "prompt", text: "Implement the complete inventory specification." },
    { id: "spec", kind: "referenced_file" as const, path: "README.md", text: ATOMIC_BATCH_CLAUSE.text },
  ];
}

function mappedFacetRequirement(text: string, acceptanceCriterion: string, sourceFacetId: string) {
  return {
    type: "constraint" as const,
    text,
    acceptance_criterion: acceptanceCriterion,
    source_prompt_indexes: [1],
    source_clause_ids: ["S2-C1"],
    source_facet_ids: [sourceFacetId],
  };
}
