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
});
