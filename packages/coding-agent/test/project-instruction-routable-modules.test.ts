import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  prepareProjectInstructions,
  selectProjectInstructionRuleLinks,
} from "../src/core/project-instructions/index.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("never lets always-on-only modules crowd a routed module out of the three-link selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-project-routable-modules-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  const agentsPath = join(root, "AGENTS.md");
  const globalModules = ["Alpha", "Beta", "Gamma", "Delta"]
    .map((label) => `## ${label} global\n\nAlways preserve ${label} invariant on every task.\n`)
    .join("\n");
  const content = `${globalModules}\n## Deploy release\n\nDeploy only after release verification.\n${"Release detail.\n".repeat(180)}`;
  writeFileSync(agentsPath, content);

  const prepared = await prepareProjectInstructions({
    cwd: root,
    contextFiles: [{ path: agentsPath, content }],
    skills: [],
    compiler: async (request) =>
      createProjectInstructionCompilation(request, {
        [request.modules.at(-1)?.id ?? ""]: "Deploy release verification",
      }),
  });

  const selected = selectProjectInstructionRuleLinks(prepared.manifest.rules, "alpha beta gamma delta release now");
  expect(prepared.manifest.mode).toBe("compiled");
  expect(prepared.manifest.rules.filter((rule) => rule.routable)).toHaveLength(1);
  expect(selected).toEqual([prepared.manifest.rules.at(-1)?.link]);
});
