import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import ignore from "ignore";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addIgnoreRules, loadSkillsFromDir, prefixIgnorePattern, toPosixPath } from "../src/core/skills/discovery.ts";

describe("skills discovery & ignore rules", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "p-skills-discovery-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("prefixIgnorePattern", () => {
    it("handles comments, empty lines, escaped characters, and leading slashes", () => {
      expect(prefixIgnorePattern("", "prefix/")).toBeNull();
      expect(prefixIgnorePattern("   \n", "prefix/")).toBeNull();
      expect(prefixIgnorePattern("# Comment", "prefix/")).toBeNull();
      expect(prefixIgnorePattern("\\#escaped-hash", "prefix/")).toBe("prefix/#escaped-hash");
      expect(prefixIgnorePattern("/root-pattern", "prefix/")).toBe("prefix/root-pattern");
      expect(prefixIgnorePattern("!negated-pattern", "prefix/")).toBe("!prefix/negated-pattern");
      expect(prefixIgnorePattern("\\!escaped-negation", "prefix/")).toBe("prefix/!escaped-negation");
      expect(prefixIgnorePattern("simple-pattern", "")).toBe("simple-pattern");
    });
  });

  describe("addIgnoreRules & directory traversal", () => {
    it("reads .gitignore, .ignore, and .fdignore rules with prefixes", () => {
      const ig = ignore();
      const subDir = join(tempDir, "sub");
      mkdirSync(subDir, { recursive: true });

      writeFileSync(join(tempDir, ".gitignore"), "ignored-skill/\n!keep-skill/\n\\!escaped/\n/root-only/\n", "utf-8");
      writeFileSync(join(subDir, ".ignore"), "sub-ignored/\n", "utf-8");

      addIgnoreRules(ig, tempDir, tempDir);
      addIgnoreRules(ig, subDir, tempDir);

      expect(ig.ignores("ignored-skill/SKILL.md")).toBe(true);
      expect(ig.ignores("keep-skill/SKILL.md")).toBe(false);
      expect(ig.ignores("sub/sub-ignored/SKILL.md")).toBe(true);
      expect(ig.ignores("root-only/SKILL.md")).toBe(true);
    });

    it("ignores skills matched by .gitignore and skips node_modules and dot-directories", () => {
      // 1. Valid skill
      const validSkillDir = join(tempDir, "valid-skill");
      mkdirSync(validSkillDir, { recursive: true });
      writeFileSync(
        join(validSkillDir, "SKILL.md"),
        `---\nname: valid-skill\ndescription: Valid skill\n---\n# Valid`,
        "utf-8",
      );

      // 2. Direct root markdown file and non-markdown file
      writeFileSync(
        join(tempDir, "root-skill.md"),
        `---\nname: root-skill\ndescription: Root skill\n---\n# Root`,
        "utf-8",
      );
      writeFileSync(join(tempDir, "non-skill.txt"), "some plain text", "utf-8");

      // 3. Ignored skill via .gitignore
      const ignoredSkillDir = join(tempDir, "ignored-skill");
      mkdirSync(ignoredSkillDir, { recursive: true });
      writeFileSync(
        join(ignoredSkillDir, "SKILL.md"),
        `---\nname: ignored-skill\ndescription: Ignored skill\n---\n# Ignored`,
        "utf-8",
      );

      // 4. Ignored direct SKILL.md
      const ignoredSkillFileDir = join(tempDir, "ignored-file-skill");
      mkdirSync(ignoredSkillFileDir, { recursive: true });
      writeFileSync(
        join(ignoredSkillFileDir, "SKILL.md"),
        `---\nname: ignored-file-skill\ndescription: Ignored file skill\n---\n# Ignored`,
        "utf-8",
      );

      writeFileSync(join(tempDir, ".gitignore"), "ignored-skill/\nignored-file-skill/SKILL.md\n", "utf-8");

      // 5. node_modules skill
      const nodeModulesSkillDir = join(tempDir, "node_modules", "vendor-skill");
      mkdirSync(nodeModulesSkillDir, { recursive: true });
      writeFileSync(
        join(nodeModulesSkillDir, "SKILL.md"),
        `---\nname: vendor-skill\ndescription: Vendor skill\n---\n# Vendor`,
        "utf-8",
      );

      // 6. Dot directory skill
      const dotSkillDir = join(tempDir, ".hidden", "hidden-skill");
      mkdirSync(dotSkillDir, { recursive: true });
      writeFileSync(
        join(dotSkillDir, "SKILL.md"),
        `---\nname: hidden-skill\ndescription: Hidden skill\n---\n# Hidden`,
        "utf-8",
      );

      const { skills } = loadSkillsFromDir({ dir: tempDir, source: "test" });
      const names = skills.map((s) => s.name);

      expect(names).toContain("valid-skill");
      expect(names).toContain("root-skill");
      expect(names).not.toContain("ignored-skill");
      expect(names).not.toContain("ignored-file-skill");
      expect(names).not.toContain("vendor-skill");
      expect(names).not.toContain("hidden-skill");
    });

    it("resolves valid symlinks and safely skips broken symlinks", () => {
      const realSkillDir = join(tempDir, "real-skill");
      mkdirSync(realSkillDir, { recursive: true });
      writeFileSync(
        join(realSkillDir, "SKILL.md"),
        `---\nname: real-skill\ndescription: Real skill\n---\n# Real`,
        "utf-8",
      );

      // Symlink directory
      const linkSkillDir = join(tempDir, "link-skill");
      try {
        symlinkSync(realSkillDir, linkSkillDir, "dir");
      } catch {}

      // Broken symlink directory
      const brokenLinkDir = join(tempDir, "broken-link");
      try {
        symlinkSync(join(tempDir, "does-not-exist"), brokenLinkDir, "dir");
      } catch {}

      // Symlinked SKILL.md file
      const fileSkillDir = join(tempDir, "file-skill");
      mkdirSync(fileSkillDir, { recursive: true });
      try {
        symlinkSync(join(realSkillDir, "SKILL.md"), join(fileSkillDir, "SKILL.md"), "file");
      } catch {}

      // Broken symlink SKILL.md file
      const brokenFileSkillDir = join(tempDir, "broken-file-skill");
      mkdirSync(brokenFileSkillDir, { recursive: true });
      try {
        symlinkSync(join(tempDir, "nonexistent-skill.md"), join(brokenFileSkillDir, "SKILL.md"), "file");
      } catch {}

      const { skills } = loadSkillsFromDir({ dir: tempDir, source: "test" });
      expect(skills.some((s) => s.name === "real-skill")).toBe(true);
    });

    it("converts backslashes to posix paths", () => {
      expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
      expect(toPosixPath("a/b/c")).toBe("a/b/c");
    });
  });
});
