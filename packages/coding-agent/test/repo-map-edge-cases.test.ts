import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getWorktreeFingerprint } from "../src/core/repo-map-fingerprint.ts";
import { indexFile } from "../src/core/repo-map-helpers.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "p-repo-map-edge-"));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("repo map edge cases", () => {
  it("fingerprints missing and quoted git status paths", () => {
    const root = createTempProject();
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
    expect(spawnSync("git", ["config", "core.quotePath", "true"], { cwd: root }).status).toBe(0);
    mkdirSync(join(root, "src"));

    const deletedPath = join(root, "src/deleted.ts");
    writeFileSync(deletedPath, "export const deleted = true;\n");
    expect(spawnSync("git", ["add", "src/deleted.ts"], { cwd: root }).status).toBe(0);
    rmSync(deletedPath);
    writeFileSync(join(root, "src/a b.ts"), "x");
    writeFileSync(join(root, "src/é.ts"), "x");

    const fingerprint = getWorktreeFingerprint(root);

    expect(fingerprint).toContain("src/deleted.ts:missing");
    expect(fingerprint).toMatch(/src\/a b\.ts:1:\d+/);
    expect(fingerprint).toContain(String.raw`"src/\303\251.ts":missing`);
  });

  it("indexes CommonJS imports, export lists, escaped literals, and unknown extensions", () => {
    const root = createTempProject();
    const modulePath = join(root, "module.cjs");
    writeFileSync(
      modulePath,
      [
        'const dependency = require("legacy-module");',
        'const literal = "escaped \\" export { ignored }";',
        "const original = 1;",
        "const plain = 2;",
        "export { original as renamed, plain, plain };",
      ].join("\n"),
    );

    const moduleFile = indexFile(root, modulePath, "test-sha");

    expect(moduleFile.language).toBe("javascript");
    expect(moduleFile.imports).toEqual(["legacy-module"]);
    expect(moduleFile.exports).toEqual([
      { name: "renamed", kind: "export" },
      { name: "plain", kind: "export" },
    ]);
    expect(moduleFile.summary).toBe("Exports renamed, plain.");

    const missingFile = indexFile(root, join(root, "README"), "test-sha");
    expect(missingFile).toMatchObject({
      language: "text",
      imports: [],
      exports: [],
      summary: "No exported symbols detected.",
    });

    const customPath = join(root, "notes.custom");
    writeFileSync(customPath, "plain text\n");
    expect(indexFile(root, customPath, "test-sha").language).toBe("custom");
  });
});
