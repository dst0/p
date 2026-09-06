import { describe, expect, it } from "vitest";
import { requirementSourceFacets } from "../src/core/task-verification/requirement-source-facets.ts";

describe("requirement-source facet extraction boundaries", () => {
  it("does not invent command facets for unrelated atomic subjects", () => {
    const facets = requirementSourceFacets({
      id: "S1-C1",
      sourcePromptIndex: 1,
      kind: "prose",
      text: "A batch is atomic: either all jobs and records commit in order, or no observable state changes.",
    });

    expect(facets).toEqual([]);
  });
});
