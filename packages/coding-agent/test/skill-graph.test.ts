import { describe, expect, it } from "vitest";
import { SkillGraph } from "../src/core/skills/skill-graph/skillgraph.ts";
import type { Skill } from "../src/core/skills/types.ts";

describe("SkillGraph", () => {
  const mockSkills: Skill[] = [
    {
      name: "software-testing",
      description: "Universal software testing standard across all languages and frameworks",
      filePath: "/fake/skills/software-testing/SKILL.md",
      baseDir: "/fake/skills/software-testing",
      disableModelInvocation: false,
      sourceInfo: { source: "bundled", origin: "package", path: "/fake/skills/software-testing", scope: "user" },
    },
    {
      name: "distributed-systems",
      description: "Resilient event-driven and distributed systems patterns",
      filePath: "/fake/skills/distributed-systems/SKILL.md",
      baseDir: "/fake/skills/distributed-systems",
      disableModelInvocation: false,
      sourceInfo: { source: "bundled", origin: "package", path: "/fake/skills/distributed-systems", scope: "user" },
    },
  ];

  it("builds an in-memory graph from loaded skills", () => {
    const graph = new SkillGraph();
    graph.build(mockSkills);

    expect(graph.size()).toBe(2);
    const node = graph.getNode("software-testing");
    expect(node).toBeDefined();
    expect(node?.type).toBe("skill");
    expect(node?.title).toBe("software-testing");
  });

  it("queries nodes with criteria scoring", () => {
    const graph = new SkillGraph();
    graph.build(mockSkills);

    const matches = graph.query({
      queryText: "testing",
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.node.id).toBe("software-testing");
    expect(matches[0]?.matchedReasons.length).toBeGreaterThan(0);
  });

  it("finds best playbook for context", () => {
    const graph = new SkillGraph();
    graph.build(mockSkills);

    const best = graph.findBestPlaybook({
      topic: "testing",
    });

    expect(best?.id).toBe("software-testing");
  });

  it("exports graph to Mermaid representation", () => {
    const graph = new SkillGraph();
    graph.build(mockSkills);

    const mermaid = graph.toMermaid();
    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("software_testing");
  });
});
