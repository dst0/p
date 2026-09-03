import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const RUNTIME_CONTRACT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must reject removal of only the final LF byte.",
  "",
].join("\n");

describe("non-runtime tasks with explicitly selected authoritative sources", () => {
  it("uses an explicit non-runtime scope for Japanese documentation without runtime proof debt", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "SPEC.md の要件から GUIDE.md のドキュメントを作成してください。", 100);
      const criterion = "GUIDE.md explains that event-log imports reject truncation removing exactly the final LF byte";
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: [criterion],
          verification_scope: "non_runtime_content",
        }),
      ).toContain("Completion checklist recorded");

      expect(harness.controller.currentState.criticalProofSourceSelections).toEqual([
        {
          sourcePath: "SPEC.md",
          selectedAtPromptId: expect.any(String),
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ]);
      expect.soft(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect.soft(harness.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
      expect.soft(harness.controller.currentState.completionChecklist?.verificationScope).toBe("non_runtime_content");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [criterion],
          verification_scope: "runtime_behavior",
        }),
      ).toContain("same-prompt completion checklist cannot change its verification_scope");

      const writeArgs = { path: "GUIDE.md", content: `${criterion}.\n` };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "GUIDE.md"), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote GUIDE.md", writeCall);
      const evidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: "GUIDE.md" }, writeArgs.content),
      );
      expect
        .soft(
          await callEvidenceVerification(harness.controller, {
            action: "ready_to_finish",
            evidence_refs_by_check: [[evidence]],
            unresolved_failures: [],
          }),
        )
        .toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("restores Spanish investigation scope without creating runtime proof debt", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Investiga el comportamiento descrito en SPEC.md y redacta los hallazgos.", 100);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["The findings accurately describe the event-log truncation contract"],
          verification_scope: "non_runtime_content",
        }),
      ).toContain("Completion checklist recorded");
      const restored = createEvidenceHarness(cwd, harness.sessionManager);
      expect(restored.controller.restoreError).toBeUndefined();
      expect(restored.controller.currentState.completionChecklist?.verificationScope).toBe("non_runtime_content");
      expect(restored.controller.currentState.criticalProofSourceSelections).toEqual([
        {
          sourcePath: "SPEC.md",
          selectedAtPromptId: expect.any(String),
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ]);
      expect(restored.controller.currentState.criticalProofObligations).toEqual([]);
      expect(restored.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-non-runtime-source-selection-"));
  writeFileSync(join(cwd, "SPEC.md"), RUNTIME_CONTRACT);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "SPEC.md"], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
    cwd,
  });
  return cwd;
}

async function sendPrompt(
  harness: ReturnType<typeof createEvidenceHarness>,
  content: string,
  timestamp: number,
): Promise<void> {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}
