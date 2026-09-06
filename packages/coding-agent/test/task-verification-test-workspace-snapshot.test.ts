import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureTestWorkspaceSnapshot,
  changedTestPaths,
} from "../src/core/task-verification/taskverificationcontroller-methods/test-workspace-snapshot.ts";

describe("task verification test workspace snapshots", () => {
  it("detects a test renamed to a non-test path by a pathless mutation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-snapshot-rename-"));
    try {
      await mkdir(join(cwd, "test"));
      await mkdir(join(cwd, "src"));
      await writeFile(join(cwd, "test/a.test.js"), "export const value = true;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", "."], { cwd });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"], {
        cwd,
      });
      const before = await captureTestWorkspaceSnapshot(cwd);
      await rename(join(cwd, "test/a.test.js"), join(cwd, "src/a.js"));
      execFileSync("git", ["add", "-A"], { cwd });
      const after = await captureTestWorkspaceSnapshot(cwd);

      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(changedTestPaths(before!, after!)).toContain("test/a.test.js");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("excludes ignored dependency output without losing ignored workspace tests", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-snapshot-ignored-dependencies-"));
    try {
      await mkdir(join(cwd, "node_modules/dependency/tests"), { recursive: true });
      await mkdir(join(cwd, "dist/tests"), { recursive: true });
      await mkdir(join(cwd, "test"));
      await writeFile(join(cwd, ".gitignore"), "node_modules/\ndist/\ntest/\n");
      for (let offset = 0; offset < 2_001; offset += 100) {
        const count = Math.min(100, 2_001 - offset);
        await Promise.all(
          Array.from({ length: count }, (_, index) =>
            writeFile(
              join(cwd, `node_modules/dependency/tests/case-${offset + index}.test.js`),
              "ignored dependency test\n",
            ),
          ),
        );
      }
      await writeFile(join(cwd, "dist/tests/generated.test.js"), "ignored build test\n");
      await writeFile(join(cwd, "test/ignored.test.js"), "export const value = 1;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", ".gitignore"], { cwd });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"], {
        cwd,
      });

      const before = await captureTestWorkspaceSnapshot(cwd);
      await writeFile(join(cwd, "test/ignored.test.js"), "export const value = 200;\n");
      const after = await captureTestWorkspaceSnapshot(cwd);

      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect([...before!.keys()]).toEqual(["test/ignored.test.js"]);
      expect([...after!.keys()]).toEqual(["test/ignored.test.js"]);
      expect(changedTestPaths(before!, after!)).toEqual(["test/ignored.test.js"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
