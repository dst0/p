import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import {
  captureSourceWorkspaceSnapshot,
  type SourceWorkspaceSnapshot,
} from "../src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts";
import { updatedWorkspaceEffectLedger } from "../src/core/task-verification/taskverificationcontroller-methods/workspace-effect-ledger.ts";
import { TaskVerificationController } from "../src/core/task-verification.ts";

function nonGitSnapshot(state: string): SourceWorkspaceSnapshot {
  const entries = Array.from({ length: 129 }, (_, index) => [`assets/item-${index}.txt`, state] as const);
  const snapshot = new Map(entries) as SourceWorkspaceSnapshot;
  snapshot.gitRepository = false;
  return snapshot;
}

function nonGitEntries(entries: readonly (readonly [string, string])[]): SourceWorkspaceSnapshot {
  const snapshot = new Map(entries) as SourceWorkspaceSnapshot;
  snapshot.gitRepository = false;
  return snapshot;
}

describe("non-Git workspace effect ledger overflow", () => {
  it("fails readiness closed when the bounded task-owned path ledger overflows", () => {
    const state = emptyState("non-git-overflow");
    const update = updatedWorkspaceEffectLedger(state, nonGitSnapshot("missing"), nonGitSnapshot("file:changed"));
    const controller = new TaskVerificationController(SessionManager.inMemory());
    controller.state = { ...controller.state, ...update, mutationRevision: 1 };

    expect(update.taskOwnedPaths).toHaveLength(128);
    expect(update.taskOwnedPathOverflow).toBe(true);
    expect(update.taskOwnedPathTrackingFailed).toBe(false);
    expect(
      controller.readyToFinish({
        action: "ready_to_finish",
        acceptance_checks: [],
        unresolved_failures: [],
      } as never).message,
    ).toContain("task-owned workspace path ledger exceeded its bound");
  });

  it("fails readiness closed when the fallback snapshot candidate set overflows", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-non-git-snapshot-overflow-"));
    try {
      const candidates = Array.from({ length: 5_001 }, (_, index) => `assets/item-${index}.txt`);
      const snapshot = await captureSourceWorkspaceSnapshot(cwd, candidates);
      const controller = new TaskVerificationController(SessionManager.inMemory(cwd));
      const update = updatedWorkspaceEffectLedger(controller.state, snapshot, snapshot);
      controller.state = { ...controller.state, ...update, mutationRevision: 1 };

      expect(snapshot).toBeUndefined();
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

  it("retains original baselines while task changes are added and reverted", () => {
    const state = emptyState("non-git-baselines");
    const original = nonGitEntries([
      ["docs/guide.md", "file:old-guide"],
      ["settings.json", "file:old-settings"],
    ]);
    const firstAfter = nonGitEntries([
      ["docs/guide.md", "file:new-guide"],
      ["settings.json", "file:old-settings"],
    ]);
    const first = updatedWorkspaceEffectLedger(state, original, firstAfter);
    const secondAfter = nonGitEntries([
      ["docs/guide.md", "file:old-guide"],
      ["settings.json", "file:new-settings"],
    ]);
    const second = updatedWorkspaceEffectLedger({ ...state, ...first }, firstAfter, secondAfter);

    expect(second.taskOwnedPaths).toEqual(["settings.json"]);
    expect(second.taskOwnedPathBaselines).toEqual([{ path: "settings.json", state: "file:old-settings" }]);
  });
});
