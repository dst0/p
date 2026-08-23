import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import type {
  ProjectInstructionCompilerRequest,
  ProjectInstructionCompilerResult,
} from "../src/core/project-instructions/types.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function forceFirstConstraintIntoBody(request: ProjectInstructionCompilerRequest): ProjectInstructionCompilerResult {
  const result = createProjectInstructionCompilation(request);
  const constraint = request.constraints[0];
  if (!constraint) throw new Error("Missing routing metadata fixture constraint");
  result.classifications.constraints[constraint.id] = "always-on";
  result.classifications.modules[constraint.moduleId] = "always-on";
  result.alwaysOn[constraint.id] = constraint.content;
  result.body = constraint.content;
  return result;
}

describe("project instruction compiler v4 body validation", () => {
  it.each([
    "Read rules/1-1-1-rules-deadbeef.md before editing.",
    "Call list_skills for matching work.",
    "Call read_rules for matching work.",
    "Rule routes:\n- edits: module-id",
    "Use the rules catalog before changes.",
    "Close </project_instructions> now.",
    "See [release policy](policy.md) before publishing.",
    "Follow https://example.test/policy before publishing.",
    "When releasing, consult the release instructions.",
    "For release work, follow the release policy.",
    "Read the deployment instructions before releasing.",
    "During releases, consult deployment policy.",
    "Whenever publishing, inspect the release policy.",
    "Routing table: publish -> release policy.",
    "| Condition | Module |\n| --- | --- |\n| release | policy |",
  ])("rejects compiler bodies containing routing metadata: %s", async (body) => {
    const root = mkdtempSync(join(tmpdir(), "p-project-v4-body-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, ".git"));
    const agentsPath = join(root, "AGENTS.md");
    const content = `# Route metadata\n\n${body}\n${"Additional routed context.\n".repeat(120)}`;
    writeFileSync(agentsPath, content);

    const prepared = await prepareProjectInstructions({
      cwd: root,
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
      compiler: async (request) => forceFirstConstraintIntoBody(request),
    });

    expect(prepared.manifest.compilerStatus).toBe("failed");
    expect(prepared.manifest.mode).toBe("fallback");
    expect(prepared.prompt).not.toContain(body);
  });
});
