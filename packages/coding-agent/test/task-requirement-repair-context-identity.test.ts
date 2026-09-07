import { describe, expect, it } from "vitest";
import {
  formatRequirementDefinitionRepairContext,
  renderRequirementDefinitionRepairContext,
} from "../src/core/task-verification/requirement-definition-repair-context.ts";
import { selectRequirementDefinitionRepairTarget } from "../src/core/task-verification/requirement-definition-repair-target.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("selected repair target context", () => {
  const sources: TaskVerificationSourcePrompt[] = [
    { id: "user-1", kind: "user_prompt", text: "Implement every requirement in README.md." },
    {
      id: "frozen-readme",
      kind: "referenced_file",
      path: "README.md",
      sha256: "a".repeat(64),
      text: "Implement alpha.",
    },
  ];

  it("joins a requirement diagnostic to its exact requirement and referenced clause", () => {
    const diagnostic = "Requirement 1: Source clause S2-C1 does not semantically support the mapped requirement.";
    const requirements = [
      {
        type: "behavior" as const,
        text: "Implement beta",
        acceptance_criterion: "Beta is implemented",
        source_clause_ids: ["S2-C1"],
      },
    ];
    const target = selectRequirementDefinitionRepairTarget(diagnostic, ["S2-C1"], requirements);

    expect(target).toBeDefined();
    const context = formatRequirementDefinitionRepairContext(target!, sources, requirements);
    expect(context).toContain('"target_key":"requirement:1"');
    expect(context).toContain('"selected_requirements":[{"requirement_index":1');
    expect(context).toContain('"source_id":"frozen-readme"');
    expect(context).toContain('"clause_text":"Implement alpha."');
  });

  it("joins a direct-prompt target to its stable ID and exact prompt text", () => {
    const target = selectRequirementDefinitionRepairTarget(
      "Every source prompt must be referenced or explicitly ignored; unclassified indexes: 1.",
    );

    expect(target).toBeDefined();
    const context = formatRequirementDefinitionRepairContext(target!, sources, []);
    expect(context).toContain('"target_key":"source_prompt:1"');
    expect(context).toContain('"source_id":"user-1"');
    expect(context).toContain('"source_kind":"user_prompt"');
    expect(context).toContain('"prompt_text":"Implement every requirement in README.md."');
  });

  it("includes exact facet semantics with the parent frozen-source identity", () => {
    const facetSources: TaskVerificationSourcePrompt[] = [
      sources[0]!,
      { ...sources[1]!, text: "Shipping reduces both onHand and the reservation." },
    ];
    const requirements = [
      {
        type: "behavior" as const,
        text: "Shipping reduces onHand",
        acceptance_criterion: "Shipping reduces onHand by the shipped quantity",
        source_clause_ids: ["S2-C1"],
        source_facet_ids: ["S2-C1-F1"],
      },
    ];
    const target = selectRequirementDefinitionRepairTarget(
      "Requirement 1: Source facet S2-C1-F1 is missing qualifier shipped quantity.",
      [],
      requirements,
    );

    const context = formatRequirementDefinitionRepairContext(target!, facetSources, requirements);
    expect(context).toContain('"source_facet_id":"S2-C1-F1"');
    expect(context).toContain('"facet_text":"Shipping reduces onHand."');
    expect(context).toContain('"facet_kind":"behavior_outcome"');
    expect(context).toContain('"facet_branch":"behavior"');
  });

  it.each([
    ["Every referenced-file clause is unclassified; unclassified source_clause_ids: S2-C9.", "S2-C9"],
    ["Every source prompt must be referenced or explicitly ignored; unclassified indexes: 9.", "9"],
    ["Requirement 9: Source clause S2-C1 does not semantically support the mapped requirement.", "requirement:9"],
    ["Source clause S2-C1 has uncovered source facets: S2-C1-F99.", "S2-C1-F99"],
  ])("marks a structurally missing selected target unresolved: %s", (diagnostic, missingIdentity) => {
    const target = selectRequirementDefinitionRepairTarget(diagnostic, ["S2-C9"], []);
    const rendered = renderRequirementDefinitionRepairContext(target!, sources, []);

    expect(rendered.identityResolved).toBe(false);
    expect(rendered.text).toContain(missingIdentity);
    expect(rendered.text).toContain('"identity_resolved":false');
  });
});
