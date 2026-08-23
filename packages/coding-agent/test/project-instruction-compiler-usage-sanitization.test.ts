import { describe, expect, it } from "vitest";
import { validateProjectInstructionCompilerResult } from "../src/core/project-instructions/compiler-validation.ts";

describe("project instruction compiler usage sanitization", () => {
  it("projects custom compiler usage onto the public numeric fields", () => {
    const privateMarker = "private-provider-payload";
    const contaminatedUsage = {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 1,
      total: 16,
      rawResponse: privateMarker,
    };
    const validated = validateProjectInstructionCompilerResult(
      {
        body: "No source constraints apply to every task.",
        triggers: {},
        classifications: { modules: { rules: "always-on" }, constraints: {} },
        alwaysOn: {},
        usage: contaminatedUsage,
      },
      [{ id: "rules", link: "rules/rules.md", title: "Rules", sourcePath: "/workspace/AGENTS.md", content: "" }],
      [],
    );

    expect(validated.usage).toEqual({ input: 10, output: 2, cacheRead: 3, cacheWrite: 1, total: 16 });
    expect(JSON.stringify(validated)).not.toContain(privateMarker);
  });
});
