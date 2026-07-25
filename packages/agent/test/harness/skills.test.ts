import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { formatSkillInvocation, loadSkills, loadSourcedSkills } from "../../src/harness/skills.ts";

import { createTempDir } from "./session-test-utils.ts";

describe("loadSkills", () => {
  it("loads SKILL.md files through the execution environment", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir(".agents/skills/example", { recursive: true });
    await env.writeFile(
      ".agents/skills/example/SKILL.md",
      `---
name: example
description: Example skill
disable-model-invocation: true
---
Use this skill.
`,
    );

    const { skills, diagnostics } = await loadSkills(env, ".agents/skills");

    expect(diagnostics).toEqual([]);
    expect(skills).toEqual([
      {
        name: "example",
        description: "Example skill",
        content: "Use this skill.",
        filePath: join(root, ".agents/skills/example/SKILL.md"),
        disableModelInvocation: true,
      },
    ]);
  });

  it("loads skills through symlinked directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("actual/example", { recursive: true });
    await env.writeFile(
      "actual/example/SKILL.md",
      "---\nname: example\ndescription: Example skill\n---\nUse this skill.",
    );
    await symlink(join(root, "actual"), join(root, "skills-link"));

    const { skills } = await loadSkills(env, "skills-link");

    expect(skills.map((skill) => skill.name)).toEqual(["example"]);
    expect(skills[0]?.filePath).toBe(join(root, "skills-link/example/SKILL.md"));
  });

  it("preserves source info for sourced skills", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("user/example", { recursive: true });
    await env.writeFile(
      "user/example/SKILL.md",
      "---\nname: example\ndescription: Example skill\n---\nUse this skill.",
    );

    const { skills, diagnostics } = await loadSourcedSkills(env, [{ path: "user", source: { type: "user" as const } }]);

    expect(diagnostics).toEqual([]);
    expect(skills).toEqual([
      {
        skill: {
          name: "example",
          description: "Example skill",
          content: "Use this skill.",
          filePath: join(root, "user/example/SKILL.md"),
          disableModelInvocation: false,
        },
        source: { type: "user" },
      },
    ]);
  });

  it("attaches source info to diagnostics", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("user/broken", { recursive: true });
    await env.writeFile("user/broken/SKILL.md", "---\nname: broken\n---\nMissing description.");

    const { skills, diagnostics } = await loadSourcedSkills(env, [{ path: "user", source: { type: "user" as const } }]);

    expect(skills).toEqual([]);
    expect(diagnostics).toEqual([
      {
        type: "warning",
        code: "invalid_metadata",
        message: "description is required",
        path: join(root, "user/broken/SKILL.md"),
        source: { type: "user" },
      },
    ]);
  });

  it("loads direct markdown children only from the root directory", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("skills/nested", { recursive: true });
    await env.writeFile("skills/root.md", "---\ndescription: Root skill\n---\nRoot content");
    const { skills } = await loadSkills(env, "skills");

    expect(skills.map((skill) => skill.name)).toEqual(["skills"]);
    expect(skills[0]?.content).toBe("Root content");
  });

  it("formatSkillInvocation formats skill invocation with and without additional instructions", () => {
    const skill = {
      name: "my-skill",
      description: "Desc",
      content: "Do this.",
      filePath: "/path/to/my-skill/SKILL.md",
      disableModelInvocation: false,
    };

    const format1 = formatSkillInvocation(skill);
    expect(format1).toContain('<skill name="my-skill" location="/path/to/my-skill/SKILL.md">');
    expect(format1).toContain("References are relative to /path/to/my-skill.");
    expect(format1).toContain("Do this.");

    const format2 = formatSkillInvocation(skill, "Extra instructions");
    expect(format2).toContain(format1);
    expect(format2).toContain("Extra instructions");
  });

  it("honors .gitignore / .ignore files and prefixIgnorePattern options", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("skills/ignored-skill", { recursive: true });
    await env.createDir("skills/active-skill", { recursive: true });

    await env.writeFile("skills/.gitignore", "# Comment\n\n!active-skill\n/ignored-skill/\n\\!escaped\n\\#hash\n");
    await env.writeFile(
      "skills/ignored-skill/SKILL.md",
      "---\nname: ignored-skill\ndescription: Ignored\n---\nIgnored",
    );
    await env.writeFile("skills/active-skill/SKILL.md", "---\nname: active-skill\ndescription: Active\n---\nActive");

    const { skills } = await loadSkills(env, "skills");
    expect(skills.map((s) => s.name)).toEqual(["active-skill"]);
  });

  it("emits diagnostics for invalid skill names and descriptions", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("skills/my_skill-dir", { recursive: true });

    const longDesc = "D".repeat(1050);

    await env.writeFile(
      "skills/my_skill-dir/SKILL.md",
      `---
name: -Invalid_Name--
description: ${longDesc}
---
Body`,
    );

    const { diagnostics } = await loadSkills(env, "skills");
    const msgs = diagnostics.map((d) => d.message);
    expect(msgs.some((m) => m.includes("does not match parent directory"))).toBe(true);
    expect(msgs.some((m) => m.includes("exceeds 1024 characters"))).toBe(true);
    expect(msgs.some((m) => m.includes("must not start or end with a hyphen"))).toBe(true);
    expect(msgs.some((m) => m.includes("must not contain consecutive hyphens"))).toBe(true);
    expect(msgs.some((m) => m.includes("contains invalid characters"))).toBe(true);
  });

  it("uses mapSkill callback when provided", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("user/skill1", { recursive: true });
    await env.writeFile("user/skill1/SKILL.md", "---\nname: skill1\ndescription: desc\n---\nbody");

    const { skills } = await loadSourcedSkills(env, [{ path: "user", source: "src-A" }], (skill, src) => ({
      ...skill,
      customField: true,
      sourceName: src,
    }));
    expect(skills[0].skill).toMatchObject({ name: "skill1", customField: true, sourceName: "src-A" });
  });

  it("handles file_info_failed, list_failed, read_failed diagnostics", async () => {
    const env: any = {
      fileInfo: async (p: string) => {
        if (p === "bad-dir") return { ok: true, value: { path: "bad-dir", kind: "directory", name: "bad-dir" } };
        if (p === "err-dir") return { ok: false, error: { code: "permission_denied", message: "Denied" } };
        if (p === "bad-dir/SKILL.md")
          return { ok: true, value: { path: "bad-dir/SKILL.md", kind: "file", name: "SKILL.md" } };
        if (p === "bad-dir/.gitignore")
          return { ok: true, value: { path: "bad-dir/.gitignore", kind: "file", name: ".gitignore" } };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
      listDir: async () => ({ ok: false, error: { code: "list_error", message: "List failed" } }),
      readTextFile: async (p: string) => {
        if (p === "bad-dir/.gitignore")
          return { ok: false, error: { code: "read_error", message: "Read gitignore failed" } };
        return { ok: false, error: { code: "read_error", message: "Read skill failed" } };
      },
      canonicalPath: async () => ({ ok: false, error: { code: "not_found", message: "Not found" } }),
    };

    const res1 = await loadSkills(env, "err-dir");
    expect(res1.diagnostics[0].code).toBe("file_info_failed");

    const res2 = await loadSkills(env, "bad-dir");
    expect(res2.diagnostics.map((d) => d.code)).toContain("list_failed");
    expect(res2.diagnostics.map((d) => d.code)).toContain("read_failed");
  });

  it("handles symlink resolveKind errors when canonicalPath or fileInfo fails", async () => {
    const env: any = {
      fileInfo: async (p: string) => {
        if (p === "symlink-err")
          return { ok: true, value: { path: "symlink-err", kind: "symlink", name: "symlink-err" } };
        if (p === "symlink-target-err")
          return { ok: true, value: { path: "symlink-target-err", kind: "symlink", name: "symlink-target-err" } };
        if (p === "target-err")
          return { ok: false, error: { code: "permission_denied", message: "Target info denied" } };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
      canonicalPath: async (p: string) => {
        if (p === "symlink-err")
          return { ok: false, error: { code: "permission_denied", message: "Canonical path denied" } };
        if (p === "symlink-target-err") return { ok: true, value: "target-err" };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
    };

    const res = await loadSkills(env, ["symlink-err", "symlink-target-err"]);
    expect(res.diagnostics.map((d) => d.code)).toEqual(["file_info_failed", "file_info_failed"]);
  });

  it("handles parse_failed diagnostic for invalid YAML frontmatter", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("skills/bad-yaml", { recursive: true });
    await env.writeFile("skills/bad-yaml/SKILL.md", "---\nname: [invalid yaml\n  : : :\n---\nbody");

    const { skills, diagnostics } = await loadSkills(env, "skills");
    expect(skills).toEqual([]);
    expect(diagnostics.some((d) => d.code === "parse_failed")).toBe(true);
  });

  it("handles loadSkillFromFile read_failed diagnostic", async () => {
    const env: any = {
      fileInfo: async (p: string) => {
        if (p === "dir") return { ok: true, value: { path: "dir", kind: "directory", name: "dir" } };
        if (p === "dir/SKILL.md") return { ok: true, value: { path: "dir/SKILL.md", kind: "file", name: "SKILL.md" } };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
      listDir: async () => ({
        ok: true,
        value: [{ path: "dir/SKILL.md", kind: "file", name: "SKILL.md" }],
      }),
      readTextFile: async (_p: string) => ({
        ok: false,
        error: { code: "permission_denied", message: "Read skill denied" },
      }),

      canonicalPath: async () => ({ ok: false, error: { code: "not_found", message: "Not found" } }),
    };

    const res = await loadSkills(env, "dir");
    expect(res.diagnostics.some((d) => d.code === "read_failed")).toBe(true);
  });
});
