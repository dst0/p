import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  captureSourceWorkspaceSnapshot,
  changedSourcePaths,
} from "../src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts";

const execFileAsync = promisify(execFile);

describe("Git-ignored workspace effect snapshots", () => {
  it("detects pathless changes to an ordinary ignored asset", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-ignored-effect-"));
    try {
      await mkdir(join(cwd, "generated"));
      await mkdir(join(cwd, "node_modules/pkg"), { recursive: true });
      await writeFile(join(cwd, ".gitignore"), "generated/\nnode_modules/\n");
      await writeFile(join(cwd, "generated/report.json"), '{"status":"old"}\n');
      await writeFile(join(cwd, "node_modules/pkg/index.js"), "export {};\n");
      await execFileAsync("git", ["init", "-q"], { cwd });
      const before = await captureSourceWorkspaceSnapshot(cwd);
      await writeFile(join(cwd, "generated/report.json"), '{"status":"new"}\n');
      const after = await captureSourceWorkspaceSnapshot(cwd);

      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(before?.has("node_modules/pkg/index.js")).toBe(false);
      expect(changedSourcePaths(before!, after!)).toEqual(["generated/report.json"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
