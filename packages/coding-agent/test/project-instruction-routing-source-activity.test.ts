import { describe, expect, it } from "vitest";
import { selectProjectInstructionRuleLinks } from "../src/core/project-instructions/routing.ts";
import type { ProjectInstructionRuleRecord } from "../src/core/project-instructions/types.ts";

describe("project instruction source-activity routing", () => {
  it("retains a source-grounded trigger match when another rule has a title match", () => {
    const signing = rule("operational-conventions", "Operational conventions", "Before publishing, sign artifacts");
    const release = rule("release", "Release", "Release packaging");

    expect(selectProjectInstructionRuleLinks([signing, release], "publish package")).toEqual([
      release.link,
      signing.link,
    ]);
  });
});

function rule(id: string, title: string, trigger: string): ProjectInstructionRuleRecord {
  return {
    id,
    link: `rules/${id}.md`,
    file: `rules/${id}.md`,
    title,
    trigger,
    routable: true,
    sourcePath: "/workspace/AGENTS.md",
    contentHash: "0".repeat(64),
  };
}
