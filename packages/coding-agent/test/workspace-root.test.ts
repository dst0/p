import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuleIndex, createRulesContext } from "../src/core/project-rules.ts";
import { readRepoMap, updateRepoMap } from "../src/core/repo-map.ts";
import { findWorkspaceRoot } from "../src/core/workspace-root.ts";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("canonical workspace root and isolated scope", () => {
  it("resolves nested cwd to single git root without creating nested .pdev", () => {
    const root = createTempDir("p-scope-root-");
    const gitDir = join(root, ".git");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");

    const nested = join(root, "src", "nested", "child");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
    mkdirSync(join(root, ".pdev/rules"), { recursive: true });
    writeFileSync(join(root, ".pdev/rules/main.md"), "# Guidelines\n- Must verify nested root.\n");

    expect(findWorkspaceRoot(nested)).toBe(realpathSync(root));

    const map = updateRepoMap(nested);
    expect(map.root).toBe(realpathSync(root));
    expect(existsSync(join(root, ".pdev/cache/repo-map.json"))).toBe(true);
    expect(existsSync(join(nested, ".pdev"))).toBe(false);

    const rulesIndex = buildRuleIndex(nested);
    expect(rulesIndex.cwd).toBe(realpathSync(root));
    expect(rulesIndex.snippets.some((s) => s.text === "Must verify nested root.")).toBe(true);

    const rulesCtx = createRulesContext(nested, "verify");
    expect(rulesCtx).toContain("Must verify nested root.");
  });

  it("persists repo map at .pdev/cache/repo-map.json and ignores old .pdev/state cache", () => {
    const root = createTempDir("p-scope-cache-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/code.ts"), "export const x = 42;\n");

    mkdirSync(join(root, ".pdev/state"), { recursive: true });
    writeFileSync(join(root, ".pdev/state/repo-map.json"), "invalid old content");

    expect(readRepoMap(root)).toBeUndefined();

    const map = updateRepoMap(root);
    expect(map.root).toBe(realpathSync(root));
    expect(existsSync(join(root, ".pdev/cache/repo-map.json"))).toBe(true);

    const readBack = readRepoMap(root);
    expect(readBack?.files).toHaveLength(1);
    expect(readBack?.files[0]?.path).toBe("src/code.ts");
  });

  it("replaces repo map file atomically with valid content and no leftover tmp files", () => {
    const root = createTempDir("p-scope-atomic-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");

    updateRepoMap(root);
    const initialContent = readFileSync(join(root, ".pdev/cache/repo-map.json"), "utf8");
    expect(JSON.parse(initialContent)).toHaveProperty("version", 1);

    writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");
    updateRepoMap(root);

    const updatedContent = readFileSync(join(root, ".pdev/cache/repo-map.json"), "utf8");
    const parsed = JSON.parse(updatedContent) as { files: Array<{ path: string }> };
    expect(parsed.files.map((f) => f.path)).toContain("src/b.ts");

    const cacheFiles = readdirSync(join(root, ".pdev/cache"));
    const tmpFiles = cacheFiles.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("falls back to canonicalized cwd when not in a git repo", () => {
    const nonGit = createTempDir("p-scope-nongit-");
    const nestedNonGit = join(nonGit, "sub", "folder");
    mkdirSync(nestedNonGit, { recursive: true });

    expect(findWorkspaceRoot(nestedNonGit)).toBe(realpathSync(nestedNonGit));

    writeFileSync(join(nestedNonGit, "file.ts"), "export const nonGit = true;\n");
    updateRepoMap(nestedNonGit);
    expect(existsSync(join(nestedNonGit, ".pdev/cache/repo-map.json"))).toBe(true);
  });

  it("handles git worktree .git file", () => {
    const worktreeDir = createTempDir("p-scope-worktree-");
    writeFileSync(join(worktreeDir, ".git"), "gitdir: /path/to/main/.git/worktrees/wt1\n");
    mkdirSync(join(worktreeDir, "src"), { recursive: true });
    writeFileSync(join(worktreeDir, "src/wt.ts"), "export const worktree = true;\n");

    expect(findWorkspaceRoot(worktreeDir)).toBe(realpathSync(worktreeDir));

    const nestedWt = join(worktreeDir, "src");
    expect(findWorkspaceRoot(nestedWt)).toBe(realpathSync(worktreeDir));
  });

  it("cleans up temp file when write or rename fails", () => {
    const root = createTempDir("p-scope-failure-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/fail.ts"), "export const f = 1;\n");
    mkdirSync(join(root, ".pdev/cache/repo-map.json"), { recursive: true });

    expect(() => updateRepoMap(root)).toThrow();

    const files = readdirSync(join(root, ".pdev/cache"));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
