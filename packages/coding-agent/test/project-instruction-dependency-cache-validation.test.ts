import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCachedProjectInstructions } from "../src/core/project-instructions/cache.ts";
import { computeProjectInstructionResultHash } from "../src/core/project-instructions/manifest.ts";
import { prepareProjectInstructions } from "../src/core/project-instructions/processor.ts";
import type { ProjectInstructionManifest } from "../src/core/project-instructions/types.ts";
import { findWorkspaceRoot } from "../src/core/workspace-root.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction dependency cache validation", () => {
  it.each(["missing", "cycle", "malformed"] as const)(
    "rejects a persisted catalog with a %s dependency",
    async (failure) => {
      const root = mkdtempSync(join(tmpdir(), "p-rule-dependency-cache-"));
      temporaryDirectories.push(root);
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      const agentsPath = join(root, "AGENTS.md");
      const content = [
        `# Foundation\n\nPreserve the foundation.\n${"Foundation detail.\n".repeat(90)}`,
        `# Implementation\n\nApply the implementation.\n${"Implementation detail.\n".repeat(90)}`,
      ].join("\n");
      writeFileSync(agentsPath, content);
      const prepared = await prepareProjectInstructions({
        cwd: root,
        contextFiles: [{ path: agentsPath, content }],
        skills: [],
        compiler: async (request) => {
          const result = createProjectInstructionCompilation(request);
          return Object.assign(result, { requires: { [request.modules[1].id]: [request.modules[0].id] } });
        },
      });
      const expected = {
        sources: prepared.manifest.sources,
        modules: prepared.manifest.rules.map((record) => ({
          id: record.id,
          link: record.link,
          title: record.title,
          sourcePath: record.sourcePath,
          content: readFileSync(join(prepared.versionDir, record.file), "utf8"),
        })),
        skills: prepared.manifest.skills,
      };
      const loadOptions = {
        cacheDir: prepared.cacheDir,
        workspaceRoot: realpathSync(findWorkspaceRoot(root)),
        agentsHash: prepared.manifest.agentsHash,
        inputHash: prepared.manifest.inputHash,
        compilerVersion: prepared.manifest.compilerVersion,
        expected,
      };
      expect(loadCachedProjectInstructions(loadOptions)).toBeDefined();

      const manifestPath = join(prepared.versionDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ProjectInstructionManifest;
      if (failure === "missing") manifest.rules[1].requires = ["rules/missing.md"];
      else if (failure === "cycle") manifest.rules[0].requires = [manifest.rules[1].link];
      else manifest.rules[0].requires = "rules/missing.md" as unknown as string[];
      manifest.resultHash = computeProjectInstructionResultHash(manifest);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const version = `${manifest.inputHash}-${manifest.resultHash}`;
      const versionDir = join(prepared.cacheDir, "versions", version);
      renameSync(prepared.versionDir, versionDir);
      writeFileSync(
        join(prepared.cacheDir, "current.json"),
        `${JSON.stringify({ schemaVersion: 1, agentsHash: manifest.agentsHash, inputHash: manifest.inputHash, version }, null, 2)}\n`,
      );
      const fallbackPath = join(prepared.cacheDir, "inputs", manifest.inputHash, "fallback.md");
      writeFileSync(fallbackPath, readFileSync(fallbackPath, "utf8").replaceAll(prepared.versionDir, versionDir));

      expect(loadCachedProjectInstructions(loadOptions)).toBeUndefined();
    },
  );
});
