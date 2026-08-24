import { describe, expect, it } from "vitest";
import {
  formatRequirementDefinitionPrompt,
  renderRequirementDefinitionPrompt,
} from "../src/core/task-verification/requirement-definition-prompt.ts";
import type { RejectedRequirementDefinitionDraft } from "../src/core/task-verification/requirement-definition-repair.ts";
import { MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES } from "../src/core/task-verification/referenced-requirement-sources.ts";
import {
  type RequirementSourceClauseCatalogEntry,
  requirementSourceClauseCatalog,
  requirementSourceClauseLocations,
  requirementSourceClauses,
} from "../src/core/task-verification/requirement-source-clauses.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

type PromptCatalogEntry = RequirementSourceClauseCatalogEntry & {
  controllerClassification?: "informational" | "unsafe_instruction";
  requiredConcepts?: string[];
  requiredFacets?: unknown[];
};

function parsePromptCatalog(lines: readonly string[], catalogStart: number): PromptCatalogEntry[] {
  const section = lines.slice(catalogStart + 1, lines.indexOf("", catalogStart));
  const schema = JSON.parse(section[0]!) as { columns: string[] };
  return section.slice(1).map((line) => {
    const row = JSON.parse(line) as unknown[];
    const entry = Object.fromEntries(schema.columns.map((column, index) => [column, row[index]]));
    return Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== null),
    ) as unknown as PromptCatalogEntry;
  });
}

describe("requirement definition prompt", () => {
  it("injects source identity with a self-describing clause catalog and no duplicate source blob", () => {
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
    const catalogStart = lines.indexOf("HASH-BOUND REFERENCED-SOURCE CLAUSE CATALOG");
    const catalogSchema = JSON.parse(lines[catalogStart + 1]!) as { columns: string[] };
    const catalog = parsePromptCatalog(lines, catalogStart);
    const expectedClauses = requirementSourceClauses(sources);
    const expectedCatalog = requirementSourceClauseCatalog(sources);

    expect(rendered.split(directPrompt)).toHaveLength(2);
    expect(JSON.parse(lines[metadataStart + 1]!)).toEqual({
      sourceIndex: 2,
      kind: "referenced_file",
      id: "inventory-spec-v1",
      path: "README.md",
      sha256: "a".repeat(64),
    });
    expect(rendered).not.toContain(JSON.stringify(referencedText));
    expect(catalogSchema.columns).toEqual([
      "id",
      "sourcePromptIndex",
      "kind",
      "text",
      "normativeHint",
      "requiredConcepts",
      "requiredFacets",
      "line",
      "part",
      "controllerClassification",
    ]);
    expect(
      catalog.map(
        ({
          controllerClassification: _classification,
          requiredConcepts: _concepts,
          requiredFacets: _facets,
          ...clause
        }) => clause,
      ),
    ).toEqual(expectedCatalog);
    expect(catalog.map((clause) => clause.requiredConcepts)).toEqual([
      undefined,
      ["version", "position"],
      ["event log", "truncation"],
      undefined,
    ]);
    expect(catalog.map((clause) => clause.requiredFacets)).toEqual([undefined, undefined, undefined, undefined]);
    expect(catalog.map((clause) => clause.controllerClassification)).toEqual([
      "informational",
      undefined,
      undefined,
      undefined,
    ]);
    for (const clause of expectedClauses) expect(catalog).toContainEqual(expect.objectContaining(clause));
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

  it("indexes duplicate and split structured clauses without replaying the source blob", () => {
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
    const data = JSON.parse(lines[dataStart + 1]!) as { id: string; text?: string };

    expect(data).toEqual(expect.objectContaining({ id: "structured-spec" }));
    expect(data.text).toBeUndefined();
    expect(rendered).not.toContain(JSON.stringify(referencedText));
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
    expect(rendered).toContain("state, log, version, position, command-ID, and idempotency-record guarantees");
    expect(rendered).toContain("For clauses without requiredFacets, map every requiredConcepts entry");
    expect(rendered).not.toContain("version/position");
    expect(rendered).toContain(
      "Each requirement needs type, text, and acceptance_criterion. Use source_prompt_indexes for direct prompts; referenced source indexes and clauses are derived from source_clause_ids and source_facet_ids.",
    );
  });

  it("keeps dense referenced-source payload below the prior blob-plus-location representation", () => {
    const referencedText = [
      "# Dense contract",
      ...Array.from({ length: 60 }, (_value, index) => `- Preserve item${index + 1} version exactly.`),
    ].join("\n");
    const sources: TaskVerificationSourcePrompt[] = [
      {
        id: "dense-spec",
        kind: "referenced_file",
        path: "DENSE.md",
        sha256: "c".repeat(64),
        text: referencedText,
      },
    ];

    const lines = formatRequirementDefinitionPrompt(sources).split("\n");
    const metadataStart = lines.indexOf("<<<LOCAL_SPEC_DATA");
    const catalogStart = lines.indexOf("HASH-BOUND REFERENCED-SOURCE CLAUSE CATALOG");
    const currentPayload = [
      lines[metadataStart + 1],
      ...lines.slice(catalogStart + 1, lines.indexOf("", catalogStart)),
    ].join("\n");
    const priorPayload = [
      JSON.stringify({
        sourceIndex: 1,
        kind: "referenced_file",
        id: "dense-spec",
        path: "DENSE.md",
        sha256: "c".repeat(64),
        text: referencedText,
      }),
      ...requirementSourceClauseLocations(sources).map((location) => JSON.stringify(location)),
    ].join("\n");

    expect(Buffer.byteLength(currentPayload, "utf8")).toBeLessThan(Buffer.byteLength(priorPayload, "utf8"));
  });

  it("falls back to the bounded full-definition prompt when recovery would exceed the ceiling", () => {
    const source: TaskVerificationSourcePrompt = {
      id: "near-limit-spec",
      kind: "referenced_file",
      path: "LIMIT.md",
      sha256: "d".repeat(64),
      text: "",
    };
    let normalPrompt = "";
    let boundedText = "";
    for (let count = 1; count <= 200; count++) {
      source.text += `- Preserve field${count} exactly.\n`;
      const candidate = renderRequirementDefinitionPrompt([source]);
      if (candidate.normalPromptExceedsLimit) break;
      normalPrompt = candidate.text;
      boundedText = source.text;
    }
    source.text = boundedText;
    const draft = {
      revision: "bounded-revision",
      diagnostics: "Requirement 1 must map the referenced source.",
      input: {
        action: "define" as const,
        requirements: Array.from({ length: 96 }, (_value, index) => ({
          type: "behavior" as const,
          text: `Preserve rejected field ${index + 1} exactly ${"x".repeat(120)}`,
          acceptance_criterion: `Rejected field ${index + 1} remains exact after recovery ${"y".repeat(120)}`,
          source_prompt_indexes: [1],
        })),
      },
    } satisfies RejectedRequirementDefinitionDraft;

    const recovery = formatRequirementDefinitionPrompt([source], draft);

    expect(recovery).toBe(normalPrompt);
    expect(Buffer.byteLength(recovery)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
    expect(recovery).not.toContain("ACTIVE REJECTED DEFINITION BATCH");
  });

  it("blocks direct-only definition and recovery prompts that cannot fit the ceiling", () => {
    const source = { id: "prompt-1", text: `Preserve all cases. ${"x".repeat(40_000)}` };
    const draft = {
      revision: "oversized-direct-revision",
      diagnostics: "Requirement 1 is incomplete.",
      input: {
        action: "define" as const,
        requirements: [
          {
            type: "behavior" as const,
            text: "Preserve all cases.",
            acceptance_criterion: "Every named case is preserved.",
            source_prompt_indexes: [1],
          },
        ],
      },
    } satisfies RejectedRequirementDefinitionDraft;

    for (const rendered of [
      formatRequirementDefinitionPrompt([source]),
      formatRequirementDefinitionPrompt([source], draft),
    ]) {
      expect(Buffer.byteLength(rendered)).toBeLessThanOrEqual(MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES);
      expect(rendered).toContain("AUTHORITATIVE SOURCE EXCEEDS THE DEFINITION LIMIT");
      expect(rendered).toContain("Do not define or implement a partial subset");
      expect(rendered).toContain("start a fresh task or session");
      expect(rendered).not.toContain("ACTIVE REJECTED DEFINITION BATCH");
      expect(rendered).not.toContain("x".repeat(100));
    }
  });
});
