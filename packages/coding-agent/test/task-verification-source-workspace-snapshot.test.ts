import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureSourceWorkspaceSnapshot,
  changedSourcePaths,
} from "../src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts";

describe("task verification source workspace snapshots", () => {
  it("tracks the source side of a Git rename to a non-source path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-source-snapshot-rename-"));
    try {
      await mkdir(join(cwd, "src"));
      await mkdir(join(cwd, "docs"));
      await writeFile(join(cwd, "src/value.ts"), "export const value = true;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", "."], { cwd });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"], {
        cwd,
      });
      const before = await captureSourceWorkspaceSnapshot(cwd);
      await rename(join(cwd, "src/value.ts"), join(cwd, "docs/value.md"));
      execFileSync("git", ["add", "-A"], { cwd });
      const after = await captureSourceWorkspaceSnapshot(cwd);

      expect(before).toBeDefined();
      expect(after?.get("src/value.ts")).toBe("missing");
      expect(changedSourcePaths(before!, after!)).toEqual(["src/value.ts"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
