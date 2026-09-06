import { expect, it } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import { formatRequirementDefinitionRepairContext } from "../src/core/task-verification/requirement-definition-repair-context.ts";
import { selectRequirementDefinitionRepairTarget } from "../src/core/task-verification/requirement-definition-repair-target.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

it("uses effective list-child facets while preserving raw child source identity", () => {
  const sources: TaskVerificationSourcePrompt[] = [
    { id: "user-1", kind: "user_prompt", text: "Implement every requirement in README.md." },
    {
      id: "frozen-readme",
      kind: "referenced_file",
      path: "README.md",
      text: "Every service must:\n- increase both throughput and durability.",
    },
  ];
  const requirements = [
    {
      type: "behavior" as const,
      text: "Every service must increase throughput",
      acceptance_criterion: "Every service increases throughput",
      source_clause_ids: ["S2-C2"],
      source_facet_ids: ["S2-C2-F1"],
    },
  ];
  const target = selectRequirementDefinitionRepairTarget(
    "Requirement 1: Source facet S2-C2-F1 is missing qualifier every service.",
    [],
    requirements,
  );
  const row = formatRequirementDefinitionPrompt(sources)
    .split("\n")
    .find((line) => line.startsWith('["S2-C2",'));
  const facet = ((JSON.parse(row!) as unknown[])[6] as Array<{ id: string; text: string }>)[0]!;
  const context = formatRequirementDefinitionRepairContext(target!, sources, requirements);
  expect(context).toContain(`"source_facet_id":${JSON.stringify(facet.id)}`);
  expect(context).toContain(`"facet_text":${JSON.stringify(facet.text)}`);
  expect(context).toContain('"clause_text":"increase both throughput and durability."');
  expect(context).toContain('"clause_line":2');
  expect(context).toContain('"source_id":"frozen-readme"');
});
