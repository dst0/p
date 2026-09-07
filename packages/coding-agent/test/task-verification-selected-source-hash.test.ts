import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import {
  createTaskVerificationController,
  TASK_VERIFICATION_STATE_CUSTOM_TYPE,
} from "../src/core/task-verification.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

describe("selected authoritative-source hash binding", () => {
  it("blocks response-only completion when selected source bytes change concurrently", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Treat SPEC.md as authoritative and explain its answer.",
          timestamp: 100,
        },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["The response accurately explains the answer defined by SPEC.md"],
          verification_scope: "response_only",
        }),
      ).toContain("Completion checklist recorded");
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      const selectedSha = harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256;
      expect(selectedSha).toMatch(/^[a-f0-9]{64}$/u);

      writeFileSync(join(cwd, "SPEC.md"), "The authoritative answer is beta.\n");
      const result = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("SPEC.md changed after it was selected");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["The response accurately explains the answer defined by SPEC.md"],
          verification_scope: "response_only",
        }),
      ).toContain("changed after it was selected");
      expect(harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256).toBe(selectedSha);
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).toBe(true);

      await afterEvidenceTool(
        harness.agent,
        "read",
        { path: "SPEC.md", offset: 1, limit: 1 },
        "The authoritative answer is beta.",
      );
      expect(harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256).toBe(selectedSha);
      await afterEvidenceTool(harness.agent, "read", { path: "SPEC.md" }, "The authoritative answer is beta.\n");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["The response accurately explains the answer defined by SPEC.md"],
          verification_scope: "response_only",
        }),
      ).toContain("already recorded");
      expect(harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256).not.toBe(selectedSha);
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not adopt bytes written after the tracked read returned", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Use SPEC.md as authoritative and explain it.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["SPEC.md"],
        completion_checklist: ["The response explains SPEC.md"],
        verification_scope: "response_only",
      });
      const selectedSha = harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256;

      writeFileSync(join(cwd, "SPEC.md"), "The authoritative answer is beta.\n");
      await afterEvidenceTool(harness.agent, "read", { path: "SPEC.md" }, "The authoritative answer is alpha.\n");

      expect(harness.controller.currentState.criticalProofSourceSelections?.[0]?.sourceSha256).toBe(selectedSha);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["The response explains SPEC.md"],
          verification_scope: "response_only",
        }),
      ).toContain("changed after it was selected");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each([undefined, "not-a-sha"])("fails closed when restored selection hash is %s", (sourceSha256) => {
    const sessionManager = SessionManager.inMemory();
    const state = emptyState("invalid-selected-source", "evidence");
    state.taskPrompts = [{ id: "user-1", text: "Use SPEC.md as authoritative." }];
    state.criticalProofSourceSelections = [
      {
        sourcePath: "SPEC.md",
        selectedAtPromptId: "user-1",
        ...(sourceSha256 === undefined ? {} : { sourceSha256 }),
      } as never,
    ];
    sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, state);

    const restored = createTaskVerificationController(sessionManager, "evidence");

    expect(restored.restoreError).toContain("latest persisted task-verification state is invalid");
  });

  it("does not block a real-effect finish while the selected source is unchanged", async () => {
    const cwd = createRepository();
    mkdirSync(join(cwd, "src"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Implement the answer from SPEC.md in src/answer.ts.",
          timestamp: 100,
        },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["src/answer.ts exports the answer defined by SPEC.md"],
          verification_scope: "runtime_behavior",
        }),
      ).toContain("Completion checklist recorded");
      const writeArgs = { path: "src/answer.ts", content: 'export const answer = "alpha";\n' };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote answer", writeCall);
      const evidenceRef = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: writeArgs.path }, writeArgs.content),
      );
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toEqual([evidenceRef]);

      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-selected-source-hash-"));
  writeFileSync(join(cwd, "SPEC.md"), "The authoritative answer is alpha.\n");
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
