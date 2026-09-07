import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

describe("evidence-mode finish requested-evidence revalidation", () => {
  it.each([
    ["Implement the feature and run tests.", "explicitly requires tests"],
    ["Implement the feature and run typecheck.", "explicitly requires type checking"],
  ])("blocks a restored-looking ready state without newly requested evidence", async (prompt, expected) => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-finish-revalidate-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Implement the feature.", timestamp: 100 },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["The feature returns the requested value"],
        }),
      ).toContain("Completion checklist recorded");
      const writeArgs = { path: "src/feature.ts", content: "export const value = 1;\n" };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote feature", writeCall);
      const readEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: writeArgs.path }, writeArgs.content),
      );
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toEqual([readEvidence]);

      harness.controller.state.taskPrompts![0]!.text = prompt;
      const finish = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });
      expect(finish?.block).toBe(true);
      expect(finish?.reason).toContain(expected);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
