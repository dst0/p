import { describe, expect, it } from "vitest";
import { formatSkillsForPrompt, type Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

function createTestSkill(options: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation?: boolean;
  source?: string;
}): Skill {
  return {
    name: options.name,
    description: options.description,
    filePath: options.filePath,
    baseDir: options.baseDir,
    sourceInfo: createSyntheticSourceInfo(options.filePath, { source: options.source ?? "test" }),
    disableModelInvocation: options.disableModelInvocation ?? false,
  };
}

describe("formatSkillsForPrompt", () => {
  it("should return empty string for no skills", () => {
    const result = formatSkillsForPrompt([]);
    expect(result).toBe("");
  });

  it("should format skills as XML", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "test-skill",
        description: "A test skill.",
        filePath: "/path/to/skill/SKILL.md",
        baseDir: "/path/to/skill",
      }),
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<available_skills>");
    expect(result).toContain("</available_skills>");
    expect(result).toContain("<skill>");
    expect(result).toContain("<name>test-skill</name>");
    expect(result).toContain("<description>A test skill.</description>");
    expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
  });

  it("should include intro text before XML", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "test-skill",
        description: "A test skill.",
        filePath: "/path/to/skill/SKILL.md",
        baseDir: "/path/to/skill",
      }),
    ];

    const result = formatSkillsForPrompt(skills);
    const xmlStart = result.indexOf("<available_skills>");
    const introText = result.substring(0, xmlStart);

    expect(introText).toContain("The following skills provide specialized instructions");
    expect(introText).toContain("Use the read tool to load a skill's file");
  });

  it("should escape XML special characters", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "test-skill",
        description: 'A skill with <special> & "characters".',
        filePath: "/path/to/skill/SKILL.md",
        baseDir: "/path/to/skill",
      }),
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("&lt;special&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;characters&quot;");
  });

  it("should format multiple skills", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "skill-one",
        description: "First skill.",
        filePath: "/path/one/SKILL.md",
        baseDir: "/path/one",
      }),
      createTestSkill({
        name: "skill-two",
        description: "Second skill.",
        filePath: "/path/two/SKILL.md",
        baseDir: "/path/two",
      }),
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<name>skill-one</name>");
    expect(result).toContain("<name>skill-two</name>");
    expect((result.match(/<skill>/g) || []).length).toBe(2);
  });

  it("should exclude skills with disableModelInvocation from prompt", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "visible-skill",
        description: "A visible skill.",
        filePath: "/path/visible/SKILL.md",
        baseDir: "/path/visible",
      }),
      createTestSkill({
        name: "hidden-skill",
        description: "A hidden skill.",
        filePath: "/path/hidden/SKILL.md",
        baseDir: "/path/hidden",
        disableModelInvocation: true,
      }),
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<name>visible-skill</name>");
    expect(result).not.toContain("<name>hidden-skill</name>");
    expect((result.match(/<skill>/g) || []).length).toBe(1);
  });

  it("should return empty string when all skills have disableModelInvocation", () => {
    const skills: Skill[] = [
      createTestSkill({
        name: "hidden-skill",
        description: "A hidden skill.",
        filePath: "/path/hidden/SKILL.md",
        baseDir: "/path/hidden",
        disableModelInvocation: true,
      }),
    ];

    const result = formatSkillsForPrompt(skills);
    expect(result).toBe("");
  });
});
