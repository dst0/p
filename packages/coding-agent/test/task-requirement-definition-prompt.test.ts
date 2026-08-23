import { describe, expect, it } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  type RequirementSourceClauseLocation,
  requirementSourceClauseLocations,
  requirementSourceClauses,
} from "../src/core/task-verification/requirement-source-clauses.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

describe("requirement definition prompt", () => {
  it("injects exact referenced text once with clause locations and source metadata", () => {
    const directPrompt = "Implement the inventory contract exactly.\nPreserve the supplied source identity.";
    const referencedText = [
      "# Inventory invariants",
      "",
      "- Preserve every SKU version and global position.",
      "- Any malformed or truncated log must throw ValidationError.",
      "",
      "```json",
      '{"type":"manifest","eventCount":2}',
      "```",
      "",
    ].join("\n");
    const sources: TaskVerificationSourcePrompt[] = [
      { id: "prompt-1", kind: "user_prompt", text: directPrompt },
      {
        id: "inventory-spec-v1",
        kind: "referenced_file",
        path: "README.md",
        sha256: "a".repeat(64),
        text: referencedText,
      },
    ];

    const rendered = formatRequirementDefinitionPrompt(sources);
    const lines = rendered.split("\n");
    const metadataStart = lines.indexOf("<<<LOCAL_SPEC_DATA");
    const matrixStart = lines.indexOf("HASH-BOUND REFERENCED-SOURCE CLAUSE LOCATION INDEX");
    const locations = lines
      .slice(matrixStart + 1, lines.indexOf("", matrixStart))
      .map((line) => JSON.parse(line) as RequirementSourceClauseLocation);
    const expectedClauses = requirementSourceClauses(sources);
    const expectedLocations = requirementSourceClauseLocations(sources);

    expect(rendered.split(directPrompt)).toHaveLength(2);
    expect(JSON.parse(lines[metadataStart + 1]!)).toEqual({
      sourceIndex: 2,
      kind: "referenced_file",
      id: "inventory-spec-v1",
      path: "README.md",
      sha256: "a".repeat(64),
      text: referencedText,
    });
    expect(locations).toEqual(expectedLocations);
    for (const clause of expectedClauses) expect(rendered).not.toContain(JSON.stringify(clause));
    expect(expectedClauses.map((clause) => clause.id)).toEqual(["S2-C1", "S2-C2", "S2-C3", "S2-C4"]);
    expect(expectedClauses.map((clause) => clause.text)).toEqual([
      "Inventory invariants",
      "Preserve every SKU version and global position.",
      "Any malformed or truncated log must throw ValidationError.",
      '{"type":"manifest","eventCount":2}',
    ]);
    expect(expectedClauses.map((clause) => clause.kind)).toEqual(["heading", "prose", "prose", "code"]);
    expect(expectedClauses.map((clause) => clause.normativeHint)).toEqual([undefined, true, true, undefined]);
  });

  it("preserves exact structured source bytes once while indexing duplicate and split clauses", () => {
    const referencedText = [
      "# Top",
      "## Nested",
      "",
      "1. Duplicate rule",
      "   - Duplicate rule",
      "```python",
      "if ok:",
      "    preserve()",
      "```",
      "Marker <<<LOCAL_SPEC_DATA",
      "Unicode 😀; Preserve alpha; Preserve beta",
    ].join("\r\n");
    const sources: TaskVerificationSourcePrompt[] = [
      {
        id: "structured-spec",
        kind: "referenced_file",
        path: "STRUCTURED.md",
        sha256: "b".repeat(64),
        text: referencedText,
      },
    ];

    const rendered = formatRequirementDefinitionPrompt(sources);
    const lines = rendered.split("\n");
    const dataStart = lines.indexOf("<<<LOCAL_SPEC_DATA");
    const data = JSON.parse(lines[dataStart + 1]!) as { text: string };

    expect(data.text).toBe(referencedText);
    expect(rendered.split(JSON.stringify(referencedText))).toHaveLength(2);
    expect(requirementSourceClauseLocations(sources)).toEqual([
      { id: "S1-C1", sourcePromptIndex: 1, line: 1, part: 1 },
      { id: "S1-C2", sourcePromptIndex: 1, line: 2, part: 1 },
      { id: "S1-C3", sourcePromptIndex: 1, line: 4, part: 1 },
      { id: "S1-C4", sourcePromptIndex: 1, line: 5, part: 1 },
      { id: "S1-C5", sourcePromptIndex: 1, line: 7, part: 1 },
      { id: "S1-C6", sourcePromptIndex: 1, line: 8, part: 1 },
      { id: "S1-C7", sourcePromptIndex: 1, line: 10, part: 1 },
      { id: "S1-C8", sourcePromptIndex: 1, line: 11, part: 1 },
      { id: "S1-C9", sourcePromptIndex: 1, line: 11, part: 2 },
      { id: "S1-C10", sourcePromptIndex: 1, line: 11, part: 3 },
    ]);
  });

  it("preserves universal qualifiers, separates observables, and names required fields", () => {
    const rendered = formatRequirementDefinitionPrompt([{ id: "prompt-1", text: "Implement every boundary." }]);

    expect(rendered).toContain(
      "Preserve universal qualifiers such as any, every, and all while splitting each named boundary or case into its own requirement.",
    );
    expect(rendered).toContain("state, log, version, position, and command-ID non-consumption guarantees");
    expect(rendered).not.toContain("version/position");
    expect(rendered).toContain(
      "Each requirement needs type, text, acceptance_criterion, and source_prompt_indexes; referenced clauses also need source_clause_ids.",
    );
  });
});
