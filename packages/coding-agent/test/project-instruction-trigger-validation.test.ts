import { describe, expect, it } from "vitest";
import { deriveProjectInstructionTriggers } from "../src/core/project-instructions/compiler-triggers.ts";

describe("project instruction trigger validation", () => {
  it("rejects a routed module whose source contains no activity terms", () => {
    const module = {
      id: "empty-rule",
      link: "rules/empty-rule.md",
      title: "Empty rule",
      sourcePath: "/workspace/AGENTS.md",
      content: "",
    };
    const constraint = {
      id: "constraint-empty",
      moduleId: module.id,
      kind: "content" as const,
      headingContext: [],
      content: "",
      sourceText: "",
    };

    expect(() =>
      deriveProjectInstructionTriggers(
        { modules: { [module.id]: "routed" }, constraints: { [constraint.id]: "routed" } },
        [module],
        [constraint],
      ),
    ).toThrow(/no routable activity terms.*empty-rule/iu);
  });
});
