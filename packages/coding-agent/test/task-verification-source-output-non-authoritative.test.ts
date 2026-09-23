import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callEvidenceVerification, createEvidenceHarness } from "./task-verification-evidence-test-harness.ts";

describe("source_output_paths declared for a non-authoritative path", () => {
  it("does not demand authorization and still records the checklist", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Fix the bug in sub (it adds instead of subtracting).",
          timestamp: 100,
        },
      });

      const result = await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        source_output_paths: ["src/math.ts"],
        completion_checklist: ["sub(a, b) returns a minus b"],
      });

      expect(result).not.toContain("requires explicit user authorization");
      expect(result).not.toContain("source-output:");
      expect(result).not.toContain("active authoritative source selection");
      expect(result).toContain("Completion checklist recorded");
      expect(harness.controller.currentState.criticalProofSourceOutputs ?? []).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still requires the standalone marker for a real authoritative source", async () => {
    const cwd = createRepository();
    writeFileSync(join(cwd, "SPEC.md"), "Preserve stable behavior.\n");
    harnessCommit(cwd);
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Implement behavior according to SPEC.md, and edit SPEC.md itself too.",
          timestamp: 100,
        },
      });

      const result = await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["SPEC.md"],
        source_output_paths: ["SPEC.md"],
        completion_checklist: ["SPEC.md is the requested source output"],
      });

      expect(result).toContain("requires explicit user authorization");
      expect(result).toContain("[source-output:SPEC.md]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-non-authoritative-source-output-"));
  writeFileSync(join(cwd, "placeholder.txt"), "placeholder\n");
  harnessCommit(cwd);
  return cwd;
}

function harnessCommit(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
    cwd,
  });
}
