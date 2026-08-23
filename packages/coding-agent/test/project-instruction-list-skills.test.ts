import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { hashText } from "../src/core/project-instructions/content.ts";
import { createProjectInstructionState, prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createListSkillsToolDefinition } from "../src/core/tools/list-skills.ts";

const extensionContext = {} as ExtensionContext;
const temporaryDirectories: string[] = [];

interface ListedSkill {
  name: string;
  description: string;
  link: string;
}

interface ListSkillsResult {
  skills: ListedSkill[];
  nextCursor?: string;
}

function createSkill(root: string, index: number, description?: string): Skill {
  const name = `skill-${String(index).padStart(2, "0")}`;
  const baseDir = join(root, ".agents", "skills", name);
  const filePath = join(baseDir, "SKILL.md");
  mkdirSync(baseDir, { recursive: true });
  const resolvedDescription = description ?? `Guidance for task ${index}`;
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${resolvedDescription}\n---\n\nPrivate body ${index}.\n`);
  return {
    name,
    description: resolvedDescription,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
}

async function createFixture(skillCount = 12) {
  const root = mkdtempSync(join(tmpdir(), "p-list-skills-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const agentsContent = "# Rules\n\nKeep skill discovery bounded.\n";
  writeFileSync(agentsPath, agentsContent);
  const skills = Array.from({ length: skillCount }, (_, index) =>
    createSkill(root, index, index === skillCount - 1 ? "Unique deployment needle guidance" : undefined),
  );
  const prepared = await prepareProjectInstructions({
    cwd: root,
    cacheDir: join(root, ".pdev", "instructions"),
    contextFiles: [{ path: agentsPath, content: agentsContent }],
    skills,
  });
  return {
    root,
    agentsPath,
    agentsContent,
    skills,
    state: createProjectInstructionState(prepared),
  };
}

async function executeList(
  state: Awaited<ReturnType<typeof createFixture>>["state"],
  input: { query?: string; cursor?: string },
): Promise<{ parsed: ListSkillsResult; text: string }> {
  const tool = createListSkillsToolDefinition(state);
  const result = await tool.execute("call", input, undefined, undefined, extensionContext);
  const text = result.content[0].type === "text" ? result.content[0].text : "";
  return { parsed: JSON.parse(text) as ListSkillsResult, text };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("list_skills", () => {
  it("browses deterministic fixed pages with only safe virtual metadata", async () => {
    const fixture = await createFixture();

    const first = await executeList(fixture.state, {});
    expect(first.parsed.skills).toHaveLength(10);
    expect(first.parsed.nextCursor).toMatch(/^v1\./u);
    expect(first.parsed.skills.map((skill) => skill.name)).toEqual(
      [...first.parsed.skills.map((skill) => skill.name)].sort(),
    );
    for (const skill of first.parsed.skills) {
      expect(Object.keys(skill).sort()).toEqual(["description", "link", "name"]);
      expect(skill.link).toMatch(/^skills\/[a-z0-9-]+\/SKILL\.md$/u);
    }
    expect(first.text).not.toContain(fixture.root);
    expect(first.text).not.toContain("filePath");
    expect(first.text).not.toContain("baseDir");
    expect(first.text).not.toContain("rootHash");
    expect(first.text).not.toContain("Private body");

    const second = await executeList(fixture.state, { cursor: first.parsed.nextCursor });
    expect(second.parsed.skills).toHaveLength(2);
    expect(second.parsed.nextCursor).toBeUndefined();
    const links = [...first.parsed.skills, ...second.parsed.skills].map((skill) => skill.link);
    expect(new Set(links)).toHaveLength(12);
  });

  it("searches names and descriptions deterministically while empty queries browse", async () => {
    const fixture = await createFixture();

    const byName = await executeList(fixture.state, { query: "SKILL-03" });
    expect(byName.parsed.skills.map((skill) => skill.name)).toEqual(["skill-03"]);
    const byDescription = await executeList(fixture.state, { query: "deployment needle" });
    expect(byDescription.parsed.skills.map((skill) => skill.name)).toEqual(["skill-11"]);
    const empty = await executeList(fixture.state, { query: "  \n  " });
    const omitted = await executeList(fixture.state, {});
    expect(empty.parsed).toEqual(omitted.parsed);
  });

  it("normalizes equivalent queries and enforces query and cursor boundaries", async () => {
    const fixture = await createFixture();
    const normalized = await executeList(fixture.state, { query: "deployment needle" });
    const compatibilityForm = await executeList(fixture.state, { query: "ＤＥＰＬＯＹＭＥＮＴ   NEEDLE" });

    expect(compatibilityForm.parsed).toEqual(normalized.parsed);
    await expect(executeList(fixture.state, { query: "q".repeat(256) })).resolves.toBeDefined();
    await expect(executeList(fixture.state, { query: "q".repeat(257) })).rejects.toThrow(/query.*limit/i);
    await expect(executeList(fixture.state, { cursor: "c".repeat(257) })).rejects.toThrow(/cursor.*limit/i);
  });

  it("rejects malformed, query-mismatched, and stale cursors", async () => {
    const fixture = await createFixture(35);
    const first = await executeList(fixture.state, {});

    await expect(executeList(fixture.state, { cursor: "not-a-cursor" })).rejects.toThrow(/cursor/i);
    await expect(executeList(fixture.state, { query: "different", cursor: first.parsed.nextCursor })).rejects.toThrow(
      /cursor|query/i,
    );
    const issuedCursor = first.parsed.nextCursor;
    if (!issuedCursor) throw new Error("Expected a second page cursor");
    const rawOffsetMatch = /\.(\d+)$/u.exec(issuedCursor);
    const tamperedCursor = rawOffsetMatch
      ? `${issuedCursor.slice(0, rawOffsetMatch.index)}.20`
      : `${issuedCursor.slice(0, -1)}${issuedCursor.endsWith("0") ? "1" : "0"}`;
    await expect(executeList(fixture.state, { cursor: tamperedCursor })).rejects.toThrow(/cursor/i);
    const forgedCursor = `v1.${hashText(
      JSON.stringify({
        domain: "list-skills-cursor-v1",
        inputHash: fixture.state.current?.manifest.inputHash,
        queryHash: hashText(""),
        offset: 20,
      }),
    )}`;
    await expect(executeList(fixture.state, { cursor: forgedCursor })).rejects.toThrow(/cursor/i);

    const addedSkill = createSkill(fixture.root, 99, "A later skill");
    const refreshed = await prepareProjectInstructions({
      cwd: fixture.root,
      cacheDir: join(fixture.root, ".pdev", "instructions"),
      contextFiles: [{ path: fixture.agentsPath, content: fixture.agentsContent }],
      skills: [...fixture.skills, addedSkill],
    });
    fixture.state.current = refreshed;
    await expect(executeList(fixture.state, { cursor: first.parsed.nextCursor })).rejects.toThrow(/cursor|changed/i);
  });

  it("validates source and skill-root freshness before listing", async () => {
    const sourceFixture = await createFixture(1);
    writeFileSync(sourceFixture.agentsPath, `${sourceFixture.agentsContent}Changed.\n`);
    await expect(executeList(sourceFixture.state, {})).rejects.toThrow(/stale/i);

    const skillFixture = await createFixture(1);
    writeFileSync(skillFixture.skills[0].filePath, "changed root\n");
    await expect(executeList(skillFixture.state, {})).rejects.toThrow(/stale/i);
  });

  it("redacts absolute path variants inside retained metadata", async () => {
    const fixture = await createFixture(0);
    const paths = [
      `${fixture.root}/private`,
      "//server/share/private",
      "C:\\Users\\alice\\private",
      "\\\\server\\share\\private",
      "file:///Users/alice/private",
    ];
    const skills = paths.map((path, index) => createSkill(fixture.root, index, `${path} needle guidance`));
    const prepared = await prepareProjectInstructions({
      cwd: fixture.root,
      cacheDir: join(fixture.root, ".pdev", "instructions-paths"),
      contextFiles: [{ path: fixture.agentsPath, content: fixture.agentsContent }],
      skills,
    });

    const result = await executeList(createProjectInstructionState(prepared), { query: "needle" });
    expect(result.text).toContain("[redacted-path]");
    for (const path of paths) expect(result.text).not.toContain(path);
  });

  it("caps adversarial metadata and the complete result size", async () => {
    const fixture = await createFixture(0);
    const longDescription = `${fixture.root} ${"needle ".repeat(2_000)}`;
    const longSkills = Array.from({ length: 12 }, (_, index) => createSkill(fixture.root, index, longDescription));
    const prepared = await prepareProjectInstructions({
      cwd: fixture.root,
      cacheDir: join(fixture.root, ".pdev", "instructions-long"),
      contextFiles: [{ path: fixture.agentsPath, content: fixture.agentsContent }],
      skills: longSkills,
    });

    const result = await executeList(createProjectInstructionState(prepared), { query: "needle" });
    expect(result.parsed.skills).toHaveLength(10);
    expect(result.parsed.skills.every((skill) => skill.description.length <= 500)).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(32_768);
    expect(result.text).not.toContain(fixture.root);

    const expansiveSkills = Array.from({ length: 12 }, (_, index) => createSkill(fixture.root, index + 100));
    for (const skill of expansiveSkills) {
      skill.name = "\u0001".repeat(120);
      skill.description = "\u0002".repeat(500);
    }
    const expansive = await prepareProjectInstructions({
      cwd: fixture.root,
      cacheDir: join(fixture.root, ".pdev", "instructions-expansive"),
      contextFiles: [{ path: fixture.agentsPath, content: fixture.agentsContent }],
      skills: expansiveSkills,
    });
    await expect(executeList(createProjectInstructionState(expansive), {})).rejects.toThrow(/bounded result limit/i);
  });
});
