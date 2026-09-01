import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
import {
  formatFocusedSelectorExample,
  formatRequirementProofWitnessTemplates,
} from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const EXACT_LOG_CONTRACT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must always reject any truncation or extra data.",
  "",
].join("\n");

describe("evidence-mode compaction restoration", () => {
  it("restores checklist guidance, blocks a new prompt epoch, and finishes with fresh focused proof", async () => {
    const cwd = createRepository({ "SPEC.md": EXACT_LOG_CONTRACT });
    const initial = createEvidenceHarness(cwd);
    try {
      const firstPrompt = {
        role: "user" as const,
        content: "Implement the event store contract from SPEC.md.",
        timestamp: 100,
      };
      const firstKeptEntryId = initial.sessionManager.appendMessage(firstPrompt);
      await emitPrompt(initial, firstPrompt.content, firstPrompt.timestamp);
      await afterEvidenceTool(initial.agent, "read", { path: "SPEC.md" }, EXACT_LOG_CONTRACT);
      const obligation = initial.controller.currentState.criticalProofObligations?.[0];
      if (!obligation) throw new Error("missing exact-byte obligation");
      const requirement = evidenceCriticalProofRequirement(obligation);
      const criteria = ["Event store preserves configured records in order", requirement.acceptanceCriterion];
      expect(
        await callEvidenceVerification(initial.controller, {
          action: "record_completion_checklist",
          completion_checklist: criteria,
        }),
      ).toContain("Completion checklist recorded");

      initial.sessionManager.appendCompaction("Continue the event-store implementation.", firstKeptEntryId, 800, 120);
      const restored = createEvidenceHarness(cwd, initial.sessionManager);
      expect(restored.controller.restoreError).toBeUndefined();
      expect(restored.controller.currentState.completionChecklist?.criteria).toEqual(criteria);
      const nextAction = restored.controller.formatNextRequirement();
      expect(nextAction).toContain(`1. ${criteria[0]}`);
      expect(nextAction).toContain(`2. ${criteria[1]}`);
      expect(nextAction).toContain(
        `Required exact focused case selector: ${formatFocusedSelectorExample(requirement)}`,
      );
      expect(nextAction).toContain(
        `Required same-test witness: ${formatRequirementProofWitnessTemplates(requirement)}`,
      );

      await emitPrompt(restored, "Also preserve configured record ordering after reload.", 101);
      const writeArgs = { path: "src/store.ts", content: "export const ready = true;\n" };
      expect((await beforeEvidenceTool(restored.agent, "write", writeArgs))?.block).toBe(true);
      const currentCriteria = ["Event store preserves configured records in order after reload", criteria[1]];
      expect(
        await callEvidenceVerification(restored.controller, {
          action: "record_completion_checklist",
          completion_checklist: currentCriteria,
        }),
      ).toContain("Completion checklist recorded");

      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(restored.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "src/store.ts"), writeArgs.content);
      await afterEvidenceTool(restored.agent, "write", writeArgs, "wrote store", writeCall);
      const proofEvidence = evidenceHandle(
        await afterEvidenceTool(
          restored.agent,
          "bash",
          { command: `vitest --run test/store.test.ts -t '${formatFocusedSelectorExample(requirement)}'` },
          `Tests 1 passed (1)\n${proofFrame(obligation.id)}`,
        ),
      );
      const ready = await callEvidenceVerification(restored.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[proofEvidence], [proofEvidence]],
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");
      const finishArgs: Record<string, unknown> = { status: "success" };
      expect((await beforeEvidenceTool(restored.agent, "finish_work", finishArgs))?.block).not.toBe(true);
      expect(finishArgs.files_changed).toEqual(["src/store.ts"]);
      expect(finishArgs.verification_token).toBe(restored.controller.currentState.readiness?.token);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("restores overflow blocking and recovers after explicit source narrowing", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`SPEC-${index + 1}.md`, EXACT_LOG_CONTRACT]),
    );
    const cwd = createRepository(files);
    const initial = createEvidenceHarness(cwd);
    try {
      const prompt = `Implement the contracts from ${Object.keys(files).join(", ")}.`;
      const firstKeptEntryId = initial.sessionManager.appendMessage({ role: "user", content: prompt, timestamp: 100 });
      await emitPrompt(initial, prompt, 100);
      for (const path of Object.keys(files)) {
        await afterEvidenceTool(initial.agent, "read", { path }, EXACT_LOG_CONTRACT);
      }
      expect(initial.controller.currentState.criticalProofObligationOverflow).toBe(true);
      initial.sessionManager.appendCompaction("Five source boundaries discovered.", firstKeptEntryId, 800, 120);

      const restored = createEvidenceHarness(cwd, initial.sessionManager);
      expect(restored.controller.restoreError).toBeUndefined();
      expect(restored.controller.currentState.criticalProofObligationOverflow).toBe(true);
      const writeArgs = { path: "src/store.ts", content: "export {};\n" };
      expect((await beforeEvidenceTool(restored.agent, "write", writeArgs))?.reason).toContain(
        "More than four distinct critical proof boundaries",
      );

      await emitPrompt(restored, "Do not use SPEC-5.md as a requirement source.", 101);
      expect(restored.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
      const criteria = (restored.controller.currentState.criticalProofObligations ?? []).map(
        (obligation) => evidenceCriticalProofRequirement(obligation).acceptanceCriterion,
      );
      expect(criteria).toHaveLength(4);
      expect(
        await callEvidenceVerification(restored.controller, {
          action: "record_completion_checklist",
          completion_checklist: criteria,
        }),
      ).toContain("Completion checklist recorded");
      expect((await beforeEvidenceTool(restored.agent, "write", writeArgs))?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(files: Readonly<Record<string, string>>): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-evidence-compaction-"));
  mkdirSync(join(cwd, "src"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
    cwd,
  });
  return cwd;
}

async function emitPrompt(harness: ReturnType<typeof createEvidenceHarness>, content: string, timestamp: number) {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

function proofFrame(requirementId: string): string {
  return `P_PROOF_V1 ${JSON.stringify({
    requirementId,
    policy: "remove_exact_final_byte",
    facts: {
      originalBase64: Buffer.from("x\n").toString("base64"),
      candidateBase64: Buffer.from("x").toString("base64"),
      outcome: "threw",
    },
  })}`;
}
