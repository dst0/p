import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { captureSourceWorkspaceSnapshot } from "../src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts";
import { updatedWorkspaceEffectLedger } from "../src/core/task-verification/taskverificationcontroller-methods/workspace-effect-ledger.ts";
import { TaskVerificationController } from "../src/core/task-verification.ts";

const execFileAsync = promisify(execFile);

describe("unrepresentable workspace effect paths", () => {
  it("fails Git tracking closed instead of dropping control or backslash filenames", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-unrepresentable-effect-"));
    const newlinePath = "line\nbreak.txt";
    const backslashPath = "literal\\slash.txt";
    try {
      await execFileAsync("git", ["init", "-q"], { cwd });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd });
      await Promise.all([
        writeFile(join(cwd, "normal.txt"), "old\n"),
        writeFile(join(cwd, newlinePath), "old\n"),
        writeFile(join(cwd, backslashPath), "old\n"),
      ]);
      await execFileAsync("git", ["add", "--", "normal.txt", newlinePath, backslashPath], { cwd });
      await execFileAsync("git", ["commit", "-qm", "initial"], { cwd });
      const before = await captureSourceWorkspaceSnapshot(cwd);
      await Promise.all([
        writeFile(join(cwd, "normal.txt"), "new\n"),
        writeFile(join(cwd, newlinePath), "new\n"),
        writeFile(join(cwd, backslashPath), "new\n"),
      ]);
      const after = await captureSourceWorkspaceSnapshot(cwd);
      const controller = new TaskVerificationController(SessionManager.inMemory(cwd));
      const update = updatedWorkspaceEffectLedger(emptyState("unrepresentable"), before, after);
      controller.state = { ...controller.state, ...update, mutationRevision: 1 };

      expect(before).toBeDefined();
      expect(after).toBeUndefined();
      expect(update.taskOwnedPathTrackingFailed).toBe(true);
      expect(
        controller.readyToFinish({
          action: "ready_to_finish",
          acceptance_checks: [],
          unresolved_failures: [],
        } as never).message,
      ).toContain("could not identify the actual task-owned workspace paths");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
