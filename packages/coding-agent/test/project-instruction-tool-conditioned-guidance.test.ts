import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "./project-instruction-delivery-fixture.ts";

const extensionContext = {} as ExtensionContext;
const extensionMarker = "EXTENSION_APPEND_MARKER";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("tool-conditioned project-instruction guidance", () => {
  it("tracks live logical-reader availability without losing extension prompt content", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const skill = createSkill(workspace.root);
    workspace.resourceLoader.getSkills = () => ({ skills: [skill], diagnostics: [] });
    workspace.resourceLoader.getAppendSystemPrompt = () => [extensionMarker];
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-tool-conditioned-guidance"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: async () => {
        throw new Error("compiler unavailable");
      },
      tools: ["read", "read_rules", "read_skills"],
    });
    try {
      const prepared = session._projectInstructions.state.current;
      expect(prepared?.manifest.mode).toBe("fallback");
      if (!prepared) throw new Error("Expected prepared project instructions");
      const fallbackPath = getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash);

      session.setActiveToolsByName(["read"]);
      expect(session.getActiveToolNames()).toEqual(["read"]);
      assertExtensionMarkerPreserved(session.systemPrompt);
      expect.soft(guidanceVisibility(projectInstructionBlock(session.systemPrompt), fallbackPath)).toEqual({
        fallback: true,
        listSkills: false,
        readRules: true,
        readSkills: true,
        ruleCatalog: false,
        skillCatalog: false,
      });

      session.setActiveToolsByName(["read", "read_rules"]);
      expect(session.getActiveToolNames()).toEqual(["read", "read_rules"]);
      assertExtensionMarkerPreserved(session.systemPrompt);
      const rulesOnlyBlock = projectInstructionBlock(session.systemPrompt);
      expect.soft(guidanceVisibility(rulesOnlyBlock, fallbackPath)).toEqual({
        fallback: false,
        listSkills: false,
        readRules: true,
        readSkills: false,
        ruleCatalog: true,
        skillCatalog: false,
      });
      const readRules = session.getToolDefinition("read_rules");
      expect(readRules).toBeDefined();
      if (!readRules) throw new Error("Expected read_rules");
      const rule = prepared.manifest.rules.find((candidate) => candidate.title === "Security changes");
      expect(rule).toBeDefined();
      if (!rule) throw new Error("Expected the security rule module");
      const rulesResult = await readRules.execute(
        "read-rule-catalog",
        { links: [prepared.manifest.rulesCatalogFile, rule.link] },
        undefined,
        undefined,
        extensionContext,
      );
      const rulesText = textContent(rulesResult.content);
      expect(rulesText).toContain(rule.link);
      expect(rulesText).toContain("Always protect credentials before edits.");

      session.setActiveToolsByName(["read", "read_skills"]);
      expect(session.getActiveToolNames()).toEqual(["read", "read_skills"]);
      assertExtensionMarkerPreserved(session.systemPrompt);
      const skillsOnlyBlock = projectInstructionBlock(session.systemPrompt);
      expect.soft(guidanceVisibility(skillsOnlyBlock, fallbackPath)).toEqual({
        fallback: false,
        listSkills: false,
        readRules: false,
        readSkills: true,
        ruleCatalog: false,
        skillCatalog: false,
      });
      const readSkills = session.getToolDefinition("read_skills");
      expect(readSkills).toBeDefined();
      if (!readSkills) throw new Error("Expected read_skills");
      expect(readSkills.description).toContain("skills/catalog.md");
      const skillRecord = prepared.manifest.skills[0];
      expect(skillRecord?.name).toBe("conditioned-guidance");
      if (!skillRecord) throw new Error("Expected a cataloged skill");
      const skillsResult = await readSkills.execute(
        "read-skill-catalog",
        { links: [prepared.manifest.skillsCatalogFile, skillRecord.link] },
        undefined,
        undefined,
        extensionContext,
      );
      const skillsText = textContent(skillsResult.content);
      expect(skillsText).toContain(skillRecord.link);
      expect(skillsText).toContain("Apply conditioned skill guidance.");

      session.setActiveToolsByName(["read"]);
      assertExtensionMarkerPreserved(session.systemPrompt);
      expect.soft(guidanceVisibility(projectInstructionBlock(session.systemPrompt), fallbackPath)).toEqual({
        fallback: true,
        listSkills: false,
        readRules: true,
        readSkills: true,
        ruleCatalog: false,
        skillCatalog: false,
      });
    } finally {
      session.dispose();
    }
  });
});

function projectInstructionBlock(prompt: string): string {
  const match = prompt.match(/<project_instructions\b[^>]*>[\s\S]*?<\/project_instructions>/u);
  if (!match) throw new Error("Expected a project-instruction block");
  return match[0];
}

function createSkill(root: string): Skill {
  const baseDir = join(root, "conditioned-guidance-skill");
  const filePath = join(baseDir, "SKILL.md");
  mkdirSync(baseDir);
  writeFileSync(
    filePath,
    "---\nname: conditioned-guidance\ndescription: Conditioned guidance fixture\n---\n\nApply conditioned skill guidance.\n",
  );
  return {
    name: "conditioned-guidance",
    description: "Conditioned guidance fixture",
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "test", baseDir }),
    disableModelInvocation: false,
  };
}

function assertExtensionMarkerPreserved(prompt: string): void {
  expect(prompt.split(extensionMarker).length - 1).toBe(1);
  expect(projectInstructionBlock(prompt)).not.toContain(extensionMarker);
}

function guidanceVisibility(block: string, fallbackPath: string) {
  return {
    fallback: block.includes(fallbackPath) || block.includes("fallback.md"),
    listSkills: block.includes("list_skills"),
    readRules: block.includes("read_rules"),
    readSkills: block.includes("read_skills"),
    ruleCatalog: block.includes("rules/catalog.md"),
    skillCatalog: block.includes("skills/catalog.md"),
  };
}

function textContent(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n");
}
