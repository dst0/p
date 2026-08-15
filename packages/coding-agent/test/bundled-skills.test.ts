import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSkills } from "../src/core/skills.ts";

const syncScriptPath = resolve(__dirname, "../../../scripts/sync-bundled-skills.js");

function runSyncScript(targetDir: string, ...args: string[]): void {
  execFileSync(process.execPath, [syncScriptPath, targetDir, ...args], { encoding: "utf-8" });
}

describe("bundled skills and precedence hierarchy", () => {
  let tempDir: string;
  let tempAgentDir: string;
  let tempCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "p-bundled-skills-test-"));
    tempAgentDir = join(tempDir, "agent");
    tempCwd = join(tempDir, "cwd");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should discover bundled software-testing skill by default", () => {
    const { skills, diagnostics } = loadSkills({
      agentDir: tempAgentDir,
      cwd: tempCwd,
      skillPaths: [],
      includeDefaults: true,
    });

    const testingSkill = skills.find((s) => s.name === "software-testing");
    expect(testingSkill).toBeDefined();
    expect(testingSkill?.sourceInfo.source).toBe("bundled");
    expect(testingSkill?.sourceInfo.origin).toBe("package");
    expect(testingSkill?.description).toContain("Universal software testing standard");
    expect(diagnostics).toHaveLength(0);

    // Verify all 5 reference documents exist relative to baseDir
    const baseDir = testingSkill!.baseDir;
    expect(existsSync(join(baseDir, "references", "web-research-playbook.md"))).toBe(true);
    expect(existsSync(join(baseDir, "references", "tdd-and-invariants.md"))).toBe(true);
    expect(existsSync(join(baseDir, "references", "isolation-and-fixtures.md"))).toBe(true);
    expect(existsSync(join(baseDir, "references", "mutation-and-adversarial.md"))).toBe(true);
    expect(existsSync(join(baseDir, "references", "ecosystem-adapters.md"))).toBe(true);
  });

  it("should allow user skill to override bundled skill silently without collision diagnostic", () => {
    const userSkillDir = join(tempAgentDir, "skills", "software-testing");
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      `---
name: software-testing
description: Custom user software testing methodology
---
# User Testing`,
      "utf-8",
    );

    const { skills, diagnostics } = loadSkills({
      agentDir: tempAgentDir,
      cwd: tempCwd,
      skillPaths: [],
      includeDefaults: true,
    });

    const testingSkill = skills.find((s) => s.name === "software-testing");
    expect(testingSkill).toBeDefined();
    expect(testingSkill?.description).toBe("Custom user software testing methodology");
    expect(testingSkill?.sourceInfo.source).toBe("local");
    expect(testingSkill?.sourceInfo.scope).toBe("user");
    expect(diagnostics.filter((d) => d.type === "collision")).toHaveLength(0);
  });

  it("should allow project skill to override bundled skill silently", () => {
    const projectSkillDir = join(tempCwd, ".p", "skills", "software-testing");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      `---
name: software-testing
description: Project specific software testing standard
---
# Project Testing`,
      "utf-8",
    );

    const { skills, diagnostics } = loadSkills({
      agentDir: tempAgentDir,
      cwd: tempCwd,
      skillPaths: [],
      includeDefaults: true,
    });

    const testingSkill = skills.find((s) => s.name === "software-testing");
    expect(testingSkill).toBeDefined();
    expect(testingSkill?.description).toBe("Project specific software testing standard");
    expect(testingSkill?.sourceInfo.source).toBe("local");
    expect(testingSkill?.sourceInfo.scope).toBe("project");
    expect(diagnostics.filter((d) => d.type === "collision")).toHaveLength(0);
  });

  it("should enforce 3-tier precedence ladder: project > user > bundled", () => {
    // 1. Create user skill
    const userSkillDir = join(tempAgentDir, "skills", "software-testing");
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      `---
name: software-testing
description: User level testing
---
# User`,
      "utf-8",
    );

    // 2. Create project skill
    const projectSkillDir = join(tempCwd, ".p", "skills", "software-testing");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      `---
name: software-testing
description: Project level testing
---
# Project`,
      "utf-8",
    );

    // 3. Load skills with all 3 tiers active
    const { skills, diagnostics } = loadSkills({
      agentDir: tempAgentDir,
      cwd: tempCwd,
      skillPaths: [],
      includeDefaults: true,
    });

    // Project should win over user and bundled
    const testingSkill = skills.find((s) => s.name === "software-testing");
    expect(testingSkill).toBeDefined();
    expect(testingSkill?.description).toBe("Project level testing");
    expect(testingSkill?.sourceInfo.scope).toBe("project");
    expect(diagnostics.filter((d) => d.type === "collision")).toHaveLength(0);
  });

  it("should preserve user customized skills non-destructively during sync", () => {
    // First sync creates files
    runSyncScript(tempAgentDir);
    const userSkillMd = join(tempAgentDir, "skills", "software-testing", "SKILL.md");
    expect(existsSync(userSkillMd)).toBe(true);

    // User modifies the skill
    writeFileSync(userSkillMd, "# My Custom Edits", "utf-8");

    // Second sync should NOT overwrite user edits
    runSyncScript(tempAgentDir);
    expect(readFileSync(userSkillMd, "utf-8")).toBe("# My Custom Edits");
  });
});
