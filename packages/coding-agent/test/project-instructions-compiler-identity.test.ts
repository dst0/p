import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProjectInstructionCompiler, prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler identity", () => {
  it("does not reuse a successful compilation across explicit compiler identities", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-project-compiler-identity-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, ".git"));
    const agentsPath = join(root, "AGENTS.md");
    const content = Array.from(
      { length: 90 },
      (_, index) => `## Rule ${index}\n\nAlways preserve identity invariant ${index}. ${"detail ".repeat(12)}\n`,
    ).join("");
    writeFileSync(agentsPath, content);
    const createCompiler = (): ProjectInstructionCompiler =>
      vi.fn(async (request) => createProjectInstructionCompilation(request));
    const firstCompiler = createCompiler();
    const secondCompiler = createCompiler();
    const options = {
      cwd: root,
      cacheDir: join(root, ".pdev", "instructions"),
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
    };

    const first = await prepareProjectInstructions({
      ...options,
      compiler: firstCompiler,
      compilerIdentity: "model/a",
    });
    const second = await prepareProjectInstructions({
      ...options,
      compiler: secondCompiler,
      compilerIdentity: "model/b",
    });

    expect(firstCompiler).toHaveBeenCalledOnce();
    expect(secondCompiler).toHaveBeenCalledOnce();
    expect(second.manifest.inputHash).not.toBe(first.manifest.inputHash);
  });
});
