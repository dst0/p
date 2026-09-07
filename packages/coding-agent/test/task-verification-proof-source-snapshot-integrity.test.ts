import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { recomputeCriticalProofSelections } from "../src/core/task-verification/critical-proof-selection-recompute.ts";
import { frozenSourceOutputRestoreError } from "../src/core/task-verification/critical-proof-source-output-revalidation.ts";
import { exactFinalByteProofDomains } from "../src/core/task-verification/evidence-critical-proof-source.ts";
import { classifyExactFileBytesAssertion } from "../src/core/task-verification/exact-file-assertion-classifier.ts";
import { exactFileAssertionProvesCriterion } from "../src/core/task-verification/exact-file-criterion-matcher.ts";
import { inspectRequirementSourceFile } from "../src/core/task-verification/requirement-source-file.ts";
import {
  captureSourceWorkspaceSnapshot,
  changedSourcePaths,
  computeWorkspaceEffectHash,
  readWorkspaceEffectPathState,
} from "../src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

describe("proof source and workspace snapshot integrity", () => {
  it("records Git file, symlink, directory, missing, ignored, and excluded states", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-proof-source-git-snapshot-"));
    try {
      await mkdir(join(cwd, "empty"));
      await writeFile(join(cwd, "tracked.txt"), "before\n");
      await writeFile(join(cwd, "ignored.txt"), "ignored\n");
      await writeFile(join(cwd, ".gitignore"), "ignored.txt\n");
      await symlink("tracked.txt", join(cwd, "linked.txt"));
      initializeRepository(cwd);

      const before = await captureSourceWorkspaceSnapshot(cwd, ["tracked.txt", "linked.txt", "empty", "missing.txt"]);
      expect(before?.gitRepository).toBe(true);
      expect(before?.get("tracked.txt")).toBe(`file:-:${sha256("before\n")}`);
      expect(before?.get("linked.txt")).toBe(`symlink:${sha256("tracked.txt")}`);
      expect(before?.get("empty")).toBe("directory");
      expect(before?.get("missing.txt")).toBe("missing");
      expect(before?.get("ignored.txt")).toBe(`file:-:${sha256("ignored\n")}`);

      await writeFile(join(cwd, "tracked.txt"), "after\n");
      const after = await captureSourceWorkspaceSnapshot(cwd, ["tracked.txt", "linked.txt", "empty", "missing.txt"]);
      expect(changedSourcePaths(before!, after!)).toEqual(["tracked.txt"]);

      const excluded = await captureSourceWorkspaceSnapshot(cwd, ["tracked.txt", "linked.txt"], ["tracked.txt"]);
      expect(excluded?.has("tracked.txt")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("walks a non-Git workspace and hashes synchronous state changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-proof-source-fallback-snapshot-"));
    try {
      await mkdir(join(cwd, "nested"));
      await writeFile(join(cwd, "nested/value.txt"), "one\n");
      await symlink("nested/value.txt", join(cwd, "value-link.txt"));

      const snapshot = await captureSourceWorkspaceSnapshot(cwd, ["nested", "missing.txt"], ["nested/value.txt"]);
      expect(snapshot?.gitRepository).toBe(false);
      expect(snapshot?.get("nested")).toBe("directory");
      expect(snapshot?.get("missing.txt")).toBe("missing");
      expect(snapshot?.has("nested/value.txt")).toBe(false);
      expect(snapshot?.get("value-link.txt")).toBe(`symlink:${sha256("nested/value.txt")}`);

      const beforeHash = computeWorkspaceEffectHash(cwd, ["nested/value.txt", "value-link.txt"]);
      await writeFile(join(cwd, "nested/value.txt"), "two\n");
      const afterHash = computeWorkspaceEffectHash(cwd, ["nested/value.txt", "value-link.txt"]);
      expect(beforeHash).toBeDefined();
      expect(afterHash).toBeDefined();
      expect(afterHash).not.toBe(beforeHash);
      expect(readWorkspaceEffectPathState(cwd, "nested/value.txt")).toBe(`file:-:${sha256("two\n")}`);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("recomputes frozen source-output obligations from the recorded baseline", () => {
    const sourceText =
      "Export deterministic newline-terminated JSONL.\nJSONL import must always reject any truncation or extra data.\n";
    const sourceSha256 = sha256(sourceText);
    const domains = exactFinalByteProofDomains(sourceText);
    expect(domains).toEqual(["event-log"]);
    const result = recomputeCriticalProofSelections(
      "/workspace",
      [{ sourcePath: "FORMAT.md", selectedAtPromptId: "prompt-1", sourceSha256: "stale" }],
      [
        {
          sourcePath: "FORMAT.md",
          authorizedAtPromptId: "prompt-1",
          authorizedCriterion: "FORMAT.md has exact bytes",
          baselineState: `file:-:${sourceSha256}`,
          criticalDomains: domains,
        },
      ],
    );

    expect(result.failures).toEqual([]);
    expect(result.selections).toEqual([{ sourcePath: "FORMAT.md", selectedAtPromptId: "prompt-1", sourceSha256 }]);
    expect(
      result.obligations.map(({ sourcePath, sourceSha256: hash, artifactDomain }) => ({
        sourcePath,
        hash,
        artifactDomain,
      })),
    ).toEqual([{ sourcePath: "FORMAT.md", hash: sourceSha256, artifactDomain: "event-log" }]);
  });

  it("rejects a frozen source output with a lost baseline or non-file replacement", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-proof-source-output-state-"));
    try {
      await writeFile(join(cwd, "FORMAT.md"), "before\n");
      const sourceSha256 = sha256("before\n");
      const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
      controller.state = {
        ...controller.state,
        taskPrompts: [
          {
            id: "prompt-1",
            text: "Implement the behavior from FORMAT.md and edit FORMAT.md as requested.\n[source-output:FORMAT.md]",
          },
        ],
        criticalProofSourceOutputs: [
          {
            sourcePath: "FORMAT.md",
            authorizedAtPromptId: "prompt-1",
            authorizedCriterion: "FORMAT.md has exact bytes",
            baselineState: `file:-:${sourceSha256}`,
            criticalDomains: ["event-log"],
          },
        ],
        criticalProofObligations: [
          {
            id: "obligation-1",
            policy: "remove_exact_final_byte",
            sourcePath: "FORMAT.md",
            sourceSha256,
            artifactDomain: "event-log",
          },
        ],
        taskOwnedPaths: ["FORMAT.md"],
        taskOwnedPathBaselines: [{ path: "FORMAT.md", state: "wrong-baseline" }],
      };
      await writeFile(join(cwd, "FORMAT.md"), "after\n");
      expect(frozenSourceOutputRestoreError(controller)).toContain("pre-mutation bytes");

      controller.state.taskOwnedPathBaselines = [{ path: "FORMAT.md", state: `file:-:${sourceSha256}` }];
      await rm(join(cwd, "FORMAT.md"));
      await mkdir(join(cwd, "FORMAT.md"));
      expect(frozenSourceOutputRestoreError(controller)).toContain("changed regular file");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects absent exact-file targets and preserves natural-path authority", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-proof-source-assertion-"));
    try {
      await writeFile(join(cwd, "status.txt"), "ready\n");
      expect(
        classifyExactFileBytesAssertion({
          cwd,
          taskOwnedPaths: ["missing.txt"],
          descriptor: "diff <(printf 'ready\\n') missing.txt",
          isError: false,
        }),
      ).toBeUndefined();
      const claim = classifyExactFileBytesAssertion({
        cwd,
        taskOwnedPaths: ["status.txt"],
        descriptor: "diff <(printf 'ready\\n') status.txt",
        isError: false,
      });
      expect(claim).toBeDefined();
      expect(
        exactFileAssertionProvesCriterion('status.txt contains exactly the newline-terminated line "ready"', claim!),
      ).toBe(true);
      expect(
        exactFileAssertionProvesCriterion(
          'status.txt.backup contains exactly the newline-terminated line "ready"',
          claim!,
        ),
      ).toBe(false);
      expect(inspectRequirementSourceFile(cwd, "status.txt", 1024)).toContain("Git-tracked");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function initializeRepository(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], {
    cwd,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
