import { homedir } from "os";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import type { ResourceDiagnostic } from "../src/core/diagnostics.ts";
import { loadSkills, loadSkillsFromDir, validateDescription, validateName } from "../src/core/skills.ts";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");
const emptyAgentDir = resolve(__dirname, "fixtures/empty-agent");
const emptyCwd = resolve(__dirname, "fixtures/empty-cwd");

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    it("should load a valid skill", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "valid-skill"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("valid-skill");
      expect(skills[0].description).toBe("A valid skill for testing purposes.");
      expect(skills[0].sourceInfo.source).toBe("test");
      expect(diagnostics).toHaveLength(0);
    });

    it("should allow names that don't match parent directory", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "name-mismatch"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("different-name");
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not match parent directory"))).toBe(
        false,
      );
    });

    it("should warn when name contains invalid characters", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "invalid-name-chars"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("invalid characters"))).toBe(true);
    });

    it("should warn when name exceeds 64 characters", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "long-name"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("exceeds 64 characters"))).toBe(true);
    });

    it("should warn and skip skill when description is missing", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "missing-description"),
        source: "test",
      });

      expect(skills).toHaveLength(0);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
    });

    it("should ignore unknown frontmatter fields", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "unknown-field"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(diagnostics).toHaveLength(0);
    });

    it("should load nested skills recursively", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "nested"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("child-skill");
      expect(diagnostics).toHaveLength(0);
    });

    it("should prefer a directory's root SKILL.md over nested SKILL.md files", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "root-skill-preferred"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("root-skill-preferred");
      expect(skills[0].description).toBe("Root skill should win.");
      expect(diagnostics).toHaveLength(0);
    });

    it("should skip files without frontmatter", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "no-frontmatter"),
        source: "test",
      });

      expect(skills).toHaveLength(0);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
    });

    it("should warn and skip skill when YAML frontmatter is invalid", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "invalid-yaml"),
        source: "test",
      });

      expect(skills).toHaveLength(0);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("at line"))).toBe(true);
    });

    it("should preserve multiline descriptions from YAML", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "multiline-description"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].description).toContain("\n");
      expect(skills[0].description).toContain("This is a multiline description.");
      expect(diagnostics).toHaveLength(0);
    });

    it("should warn when name contains consecutive hyphens", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "consecutive-hyphens"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("consecutive hyphens"))).toBe(true);
    });

    it("should load all skills from fixture directory", () => {
      const { skills } = loadSkillsFromDir({
        dir: fixturesDir,
        source: "test",
      });

      expect(skills.length).toBeGreaterThanOrEqual(6);
    });

    it("should return empty for non-existent directory", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: "/non/existent/path",
        source: "test",
      });

      expect(skills).toHaveLength(0);
      expect(diagnostics).toHaveLength(0);
    });

    it("should use parent directory name when name not in frontmatter", () => {
      const { skills } = loadSkillsFromDir({
        dir: join(fixturesDir, "valid-skill"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("valid-skill");
    });

    it("should parse disable-model-invocation frontmatter field", () => {
      const { skills, diagnostics } = loadSkillsFromDir({
        dir: join(fixturesDir, "disable-model-invocation"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("disable-model-invocation");
      expect(skills[0].disableModelInvocation).toBe(true);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("unknown frontmatter field"))).toBe(false);
    });

    it("should default disableModelInvocation to false when not specified", () => {
      const { skills } = loadSkillsFromDir({
        dir: join(fixturesDir, "valid-skill"),
        source: "test",
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].disableModelInvocation).toBe(false);
    });
  });

  describe("loadSkills with options", () => {
    it("should load from explicit skillPaths", () => {
      const { skills, diagnostics } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: [join(fixturesDir, "valid-skill")],
        includeDefaults: false,
      });
      expect(skills).toHaveLength(1);
      expect(skills[0].sourceInfo.scope).toBe("temporary");
      expect(diagnostics).toHaveLength(0);
    });

    it("should warn when skill path does not exist", () => {
      const { skills, diagnostics } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: ["/non/existent/path"],
        includeDefaults: false,
      });
      expect(skills).toHaveLength(0);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not exist"))).toBe(true);
    });

    it("should expand ~ in skillPaths", () => {
      const homeSkillsDir = join(homedir(), ".p/agent/skills");
      const { skills: withTilde } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: ["~/.p/agent/skills"],
        includeDefaults: false,
      });
      const { skills: withoutTilde } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: [homeSkillsDir],
        includeDefaults: false,
      });
      expect(withTilde.length).toBe(withoutTilde.length);
    });

    it("should warn when skill path is not a markdown file", () => {
      const { skills, diagnostics } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: [resolve(__dirname, "../package.json")],
        includeDefaults: false,
      });
      expect(skills).toHaveLength(0);
      expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("not a markdown file"))).toBe(true);
    });
  });

  describe("validation helpers", () => {
    it("validates description length and empty checks", () => {
      expect(validateDescription("   \n\t  ")).toContain("description is required");
      expect(validateDescription("a".repeat(1025))).toEqual([
        expect.stringContaining("description exceeds 1024 characters"),
      ]);
      expect(validateDescription("Valid description")).toHaveLength(0);
    });

    it("validates name format boundaries", () => {
      expect(validateName("-leading-hyphen")).toContain("name must not start or end with a hyphen");
      expect(validateName("trailing-hyphen-")).toContain("name must not start or end with a hyphen");
      expect(validateName("Uppercase_Name")).toEqual([expect.stringContaining("name contains invalid characters")]);
      expect(validateName("consecutive--hyphens")).toContain("name must not contain consecutive hyphens");
      expect(validateName("a".repeat(65))).toEqual([expect.stringContaining("name exceeds 64 characters")]);
      expect(validateName("valid-skill-123")).toHaveLength(0);
    });
  });

  describe("collision handling", () => {
    it("should detect name collisions in loadSkills and keep first skill with diagnostic", () => {
      const { skills, diagnostics } = loadSkills({
        agentDir: emptyAgentDir,
        cwd: emptyCwd,
        skillPaths: [join(collisionFixturesDir, "first"), join(collisionFixturesDir, "second")],
        includeDefaults: false,
      });

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("calendar");
      expect(skills[0].filePath).toContain("first");

      const collisions = diagnostics.filter((d) => d.type === "collision");
      expect(collisions).toHaveLength(1);
      expect(collisions[0].message).toContain('name "calendar" collision');
      if (collisions[0]?.collision) {
        expect(collisions[0].collision.winnerPath).toContain("first");
        expect(collisions[0].collision.loserPath).toContain("second");
      }
    });
  });
});
