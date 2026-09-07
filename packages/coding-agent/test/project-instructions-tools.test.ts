import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { hashText } from "../src/core/project-instructions/content.ts";
import { createProjectInstructionState, prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import { PROJECT_INSTRUCTION_READ_MAX_BYTES } from "../src/core/project-instructions/limits.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createReadRulesToolDefinition } from "../src/core/tools/read-rules.ts";
import { createReadSkillsToolDefinition } from "../src/core/tools/read-skills.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];
const extensionContext = {} as ExtensionContext;

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "p-project-tools-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const agentsContent = Array.from(
    { length: 80 },
    (_, index) => `## Topic ${index}\n\nAlways follow topic ${index}. ${"detail ".repeat(12)}\n`,
  ).join("");
  writeFileSync(agentsPath, agentsContent);
  const baseDir = join(root, ".agents", "skills", "review");
  mkdirSync(join(baseDir, "references"), { recursive: true });
  const filePath = join(baseDir, "SKILL.md");
  writeFileSync(filePath, "---\nname: review\ndescription: Review changes\n---\n\nRead references/checklist.md.\n");
  writeFileSync(join(baseDir, "references", "checklist.md"), "Verify boundaries.\n");
  const skill: Skill = {
    name: "review",
    description: "Review changes",
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
  return { root, agentsPath, agentsContent, skill };
}

async function prepareFixture() {
  const fixture = createFixture();
  const prepared = await prepareProjectInstructions({
    cwd: fixture.root,
    cacheDir: join(fixture.root, ".pdev", "instructions"),
    contextFiles: [{ path: fixture.agentsPath, content: fixture.agentsContent }],
    skills: [fixture.skill],
    compiler: async (request) =>
      createProjectInstructionCompilation(
        request,
        Object.fromEntries(request.modules.map((module) => [module.id, `When ${module.title} applies`])),
      ),
  });
  const state = createProjectInstructionState(prepared);
  return { ...fixture, prepared, state };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("logical reader schemas", () => {
  it("emits fully anchored nonempty namespace patterns for OpenAI-compatible parsers", async () => {
    const fixture = await prepareFixture();
    const cases = [
      {
        namespace: "rules",
        schema: createReadRulesToolDefinition(fixture.state).parameters,
        valid: "rules/catalog.md",
        invalid: ["rules/", "skills/catalog.md", "fallback.md"],
      },
      {
        namespace: "skills",
        schema: createReadSkillsToolDefinition(fixture.state).parameters,
        valid: "skills/catalog.md",
        invalid: ["skills/", "rules/catalog.md", "fallback.md"],
      },
    ];

    for (const entry of cases) {
      const itemSchema: object = entry.schema.properties.links.items;
      const pattern = "pattern" in itemSchema ? itemSchema.pattern : undefined;
      if (typeof pattern !== "string") {
        throw new Error(`${entry.namespace} reader schema is missing a string pattern`);
      }
      expect.soft(pattern, `${entry.namespace} pattern`).toMatch(/^\^.+\$$/u);
      expect.soft(new RegExp(pattern).test(entry.valid)).toBe(true);
      expect.soft(Value.Check(entry.schema, { links: [entry.valid] })).toBe(true);
      for (const invalid of entry.invalid) {
        expect.soft(new RegExp(pattern).test(invalid), invalid).toBe(false);
        expect.soft(Value.Check(entry.schema, { links: [invalid] }), invalid).toBe(false);
      }
    }
  });
});

describe("read_rules", () => {
  it("reads only cataloged links and detects stale or tampered cache content", async () => {
    const fixture = await prepareFixture();
    const tool = createReadRulesToolDefinition(fixture.state);
    const rule = fixture.prepared.manifest.rules[0];
    const result = await tool.execute(
      "call",
      { links: ["rules/catalog.md", rule.link] },
      undefined,
      undefined,
      extensionContext,
    );
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.content[0].type === "text" ? result.content[0].text : "").toContain("Always follow topic 0");

    await expect(
      tool.execute("call", { links: ["rules/../manifest.json"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/invalid|catalog/i);
    writeFileSync(join(fixture.prepared.versionDir, rule.file), "tampered\n");
    await expect(tool.execute("call", { links: [rule.link] }, undefined, undefined, extensionContext)).rejects.toThrow(
      /integrity/i,
    );

    writeFileSync(fixture.agentsPath, `${fixture.agentsContent}\nNew rule.\n`);
    await expect(
      tool.execute("call", { links: ["rules/catalog.md"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/stale/i);
  });

  it("reads only explicitly manifest-bound catalog pages", async () => {
    const fixture = await prepareFixture();
    const pageLink = "rules/catalog-pages/1.md";
    const pageContent = "# Rule catalog page\n\nBounded page content.\n";
    mkdirSync(join(fixture.prepared.versionDir, "rules", "catalog-pages"));
    writeFileSync(join(fixture.prepared.versionDir, pageLink), pageContent);
    fixture.prepared.manifest.rulesCatalogPages.push({
      link: pageLink,
      file: pageLink,
      contentHash: hashText(pageContent),
    });
    const tool = createReadRulesToolDefinition(fixture.state);

    const result = await tool.execute("call", { links: [pageLink] }, undefined, undefined, extensionContext);
    expect(result.content[0].type === "text" ? result.content[0].text : "").toContain("Bounded page content");
    await expect(
      tool.execute("call", { links: ["rules/catalog-pages/not-listed.md"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/cataloged/i);
  });

  it("rejects uncataloged rules and a forged immutable-version identity", async () => {
    const fixture = await prepareFixture();
    const tool = createReadRulesToolDefinition(fixture.state);

    await expect(
      tool.execute("call", { links: ["rules/not-cataloged.md"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/not cataloged/i);

    fixture.state.current = {
      ...fixture.prepared,
      versionDir: join(fixture.prepared.versionDir, "forged-version"),
    };
    await expect(
      tool.execute("call", { links: ["rules/catalog.md"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/version identity/i);
  });

  it.each(["missing", "directory"] as const)("rejects a %s authoritative source", async (state) => {
    const fixture = await prepareFixture();
    const tool = createReadRulesToolDefinition(fixture.state);
    rmSync(fixture.agentsPath);
    if (state === "directory") mkdirSync(fixture.agentsPath);

    await expect(
      tool.execute("call", { links: ["rules/catalog.md"] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/unreadable|regular file/i);
  });
});

describe("read_skills", () => {
  it("reads cataloged skill roots and relative resources without permitting escape", async () => {
    const fixture = await prepareFixture();
    const tool = createReadSkillsToolDefinition(fixture.state);
    const skill = fixture.prepared.manifest.skills[0];
    const relativeLink = skill.link.replace(/SKILL\.md$/, "references/checklist.md");
    const result = await tool.execute(
      "call",
      { links: [skill.link, relativeLink] },
      undefined,
      undefined,
      extensionContext,
    );
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("Review changes");
    expect(text).toContain("Verify boundaries.");

    await expect(
      tool.execute(
        "call",
        { links: [skill.link.replace("SKILL.md", "../AGENTS.md")] },
        undefined,
        undefined,
        extensionContext,
      ),
    ).rejects.toThrow(/invalid|catalog/i);
    const outside = join(fixture.root, "outside.md");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(fixture.skill.baseDir, "references", "outside.md"));
    const outsideLink = skill.link.replace(/SKILL\.md$/, "references/outside.md");
    await expect(
      tool.execute("call", { links: [outsideLink] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/outside/i);
  });

  it("rejects an oversized relative resource before reading it into the response", async () => {
    const fixture = await prepareFixture();
    const skill = fixture.prepared.manifest.skills[0];
    const resourcePath = join(fixture.skill.baseDir, "references", "oversized.md");
    writeFileSync(resourcePath, "x".repeat(PROJECT_INSTRUCTION_READ_MAX_BYTES + 1));
    const resourceLink = skill.link.replace(/SKILL\.md$/, "references/oversized.md");
    const tool = createReadSkillsToolDefinition(fixture.state);

    await expect(
      tool.execute("call", { links: [resourceLink] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/read limit/i);
  });

  it("rejects missing or non-file resources and a stale skill root", async () => {
    const fixture = await prepareFixture();
    const skill = fixture.prepared.manifest.skills[0];
    const prefix = skill.link.replace(/SKILL\.md$/u, "");
    const tool = createReadSkillsToolDefinition(fixture.state);

    await expect(
      tool.execute("call", { links: [`${prefix}references/missing.md`] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/does not exist/i);
    await expect(
      tool.execute("call", { links: [`${prefix}references`] }, undefined, undefined, extensionContext),
    ).rejects.toThrow(/regular file/i);

    writeFileSync(fixture.skill.filePath, "changed skill root\n");
    await expect(tool.execute("call", { links: [skill.link] }, undefined, undefined, extensionContext)).rejects.toThrow(
      /stale/i,
    );
  });
});
