import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeUserRequirementsHash,
  REQUIREMENT_DEFINITION_POLICY_VERSION,
} from "../src/core/task-verification/requirement-audit-hashing.ts";
import {
  formatRequirementDefinitionDiagnostics,
  validateRequirementDefinition,
} from "../src/core/task-verification/requirement-definition-validation.ts";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import type {
  RequirementAuditInput,
  TaskRequirement,
  TaskVerificationRequirementSourceRef,
  TaskVerificationSourcePrompt,
} from "../src/core/task-verification/types.ts";

const ATOMIC_BATCH =
  "A batch is atomic across all SKUs: either all commands and idempotency records commit in order, or no observable state changes.";
const sources: TaskVerificationSourcePrompt[] = [
  { id: "prompt", text: "Implement the complete inventory specification." },
  { id: "spec", kind: "referenced_file", path: "README.md", text: ATOMIC_BATCH },
];

describe("requirement definition facet hardening", () => {
  it.each([
    [
      "success",
      facetRequirement(
        "Failed batches commit all commands in order across all SKUs",
        "A failed batch commits every command in item order across every SKU",
        "S2-C1-F1",
      ),
    ],
    [
      "failure",
      facetRequirement(
        "Successful batches leave observable state unchanged across all SKUs",
        "A successful batch leaves observable state unchanged across every SKU",
        "S2-C1-F3",
      ),
    ],
  ])("rejects an inverted %s branch", (branch, requirement) => {
    const validation = validate([requirement]);

    expect(validation.diagnostics.join("\n")).toContain(`branch ${branch}`);
  });

  it("rejects a predicate borrowed from a different subject", () => {
    const validation = validate([
      facetRequirement(
        "Successful batches commit all commands in order and retain all idempotency records across all SKUs",
        "A successful batch commits every command in item order while retaining every idempotency record across every SKU",
        "S2-C1-F2",
      ),
    ]);

    expect(validation.diagnostics.join("\n")).toContain("bound behavior commit_in_order for idempotency record");
  });

  it.each([
    {
      name: "failed commit branch as success",
      text: "Failed commit branch audits all SKUs",
      criterion: "Every command commits in item order",
      diagnostic: "branch success",
    },
    {
      name: "SKU qualifier from an unrelated proposition",
      text: "A successful batch audits all SKUs",
      criterion: "On success, every command commits in item order",
      diagnostic: "branch, subject-bound behavior, and qualifiers in one local proposition",
    },
  ])("rejects $name", ({ text, criterion, diagnostic }) => {
    const validation = validate([facetRequirement(text, criterion, "S2-C1-F1")]);

    expect(validation.diagnostics.join("\n")).toContain(diagnostic);
  });

  it("rejects duplicate facet coverage across otherwise valid requirements", () => {
    const validation = validate([
      facetRequirement(
        "Successful batches commit all commands in order across all SKUs",
        "A successful batch commits every command in item order across every SKU",
        "S2-C1-F1",
      ),
      facetRequirement(
        "Every successful batch commits each command in order across every SKU",
        "On success, every command commits in item order across all SKUs",
        "S2-C1-F1",
      ),
    ]);

    expect(validation.diagnostics.join("\n")).toContain("duplicate source facet mappings: S2-C1-F1");
  });

  it("rejects multiple facets declared by one requirement", () => {
    const requirement = facetRequirement(
      "Successful batches commit all commands and all idempotency records in order across all SKUs",
      "A successful batch commits every command and every idempotency record in item order across every SKU",
      "S2-C1-F1",
    );
    requirement.source_facet_ids.push("S2-C1-F2");

    expect(validate([requirement]).diagnostics.join("\n")).toContain(
      "maps multiple source facets; use one facet per atomic requirement",
    );
  });

  it("does not accept noun substitution for explicit behavioral facets", () => {
    const validation = validate([
      {
        type: "constraint",
        text: "Batches contain idempotency records and state across all SKUs",
        acceptance_criterion: "Every batch exposes idempotency records and observable state across every SKU",
        source_prompt_indexes: [1, 2],
        source_clause_ids: ["S2-C1"],
      },
    ]);
    const diagnostics = validation.diagnostics.join("\n");

    expect(diagnostics).toContain("uncovered source facets: S2-C1-F1, S2-C1-F2, S2-C1-F3, S2-C1-F4");
    expect(diagnostics).not.toContain("uncovered normative concepts");
  });

  it("returns self-contained missing-facet repair text", () => {
    const validation = validate([
      facetRequirement(
        "Failed batches leave observable state unchanged across all SKUs",
        "A failed batch leaves observable state unchanged across every SKU",
        "S2-C1-F3",
      ),
    ]);
    const repair = formatRequirementDefinitionDiagnostics(validation.diagnostics);

    expect(repair).toContain(ATOMIC_BATCH);
    expect(repair).toContain('S2-C1-F1="On the successful commit branch');
    expect(repair).toContain('S2-C1-F4="On the failed no-commit branch');
  });

  it("derives failure proof policies only for failure facets", () => {
    const requirements = [
      taskFacet("R1", "Successful batches commit all commands in order across all SKUs", "S2-C1-F1"),
      taskFacet("R2", "Successful batches commit all idempotency records in order across all SKUs", "S2-C1-F2"),
      taskFacet("R3", "Failed batches leave observable state unchanged across all SKUs", "S2-C1-F3"),
      taskFacet("R4", "Failed batches commit no idempotency records across all SKUs", "S2-C1-F4"),
    ];
    const derived = deriveRequirementProofPolicies(sources, requirements) as TaskRequirement[];

    expect(derived.map((requirement) => requirement.proofPolicies)).toEqual([
      undefined,
      undefined,
      ["preserve_state_on_failure"],
      ["preserve_command_identity_on_failure"],
    ]);
  });

  it("versions referenced-source requirement hashes while preserving direct-only identity", () => {
    const prompt = [{ id: "prompt", text: "Implement SPEC.md." }];
    const promptIdentity = prompt.map(({ id, text }) => ({ id, text }));
    const directExpected = hash(promptIdentity);
    const reference: TaskVerificationRequirementSourceRef = {
      id: "source",
      path: "SPEC.md",
      sha256: "a".repeat(64),
      byteLength: 10,
      snapshotEntryId: "snapshot",
      referencedByPromptIds: ["prompt"],
      capturedAtMutationRevision: 0,
      origin: "requirement_audit.prepare_definition",
      policyVersion: 1,
    };
    const referencedExpected = hash({
      prompts: promptIdentity,
      requirementDefinitionPolicyVersion: REQUIREMENT_DEFINITION_POLICY_VERSION,
      requirementSources: [
        {
          id: reference.id,
          path: reference.path,
          sha256: reference.sha256,
          byteLength: reference.byteLength,
          referencedByPromptIds: reference.referencedByPromptIds,
          capturedAtMutationRevision: reference.capturedAtMutationRevision,
          origin: reference.origin,
          policyVersion: reference.policyVersion,
        },
      ],
      ignoredRequirementSources: [],
    });

    expect(computeUserRequirementsHash(prompt)).toBe(directExpected);
    expect(computeUserRequirementsHash(prompt, [reference])).toBe(referencedExpected);
  });
});

function validate(requirements: NonNullable<RequirementAuditInput["requirements"]>) {
  return validateRequirementDefinition(sources, {
    action: "define",
    requirements,
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  });
}

function facetRequirement(text: string, acceptanceCriterion: string, facetId: string) {
  return {
    type: "constraint" as const,
    text,
    acceptance_criterion: acceptanceCriterion,
    source_prompt_indexes: [1, 2],
    source_clause_ids: ["S2-C1"],
    source_facet_ids: [facetId],
  };
}

function taskFacet(id: string, text: string, facetId: string): TaskRequirement {
  return {
    id,
    type: "constraint",
    text,
    acceptanceCriterion: text,
    sourcePromptIndexes: [1, 2],
    sourceClauseIds: ["S2-C1"],
    sourceFacetIds: [facetId],
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
