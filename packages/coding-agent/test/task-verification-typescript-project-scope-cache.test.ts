import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { typeScriptProjectsCoverSources } from "../src/core/task-verification/typescript-project-scope.ts";

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

it("clears minimatch cache correctly when it overflows", () => {
  const workspace = mkdtempSync(join(tmpdir(), "p-task-verification-test-cache-"));
  workspaces.push(workspace);
  writeFileSync(join(workspace, "empty.ts"), "");

  // Create 505 different exclude patterns to force the cache to clear inside matchesPattern
  const excludes = Array.from({ length: 505 })
    .map((_, i) => `"excludeDir${i}/**/*"`)
    .join(",");
  writeFileSync(join(workspace, "tsconfig.json"), `{"compilerOptions":{"strict":true},"exclude":[${excludes}]}`);

  expect(typeScriptProjectsCoverSources([workspace], ["empty.ts"], workspace, workspace)).toBe(true);
});
