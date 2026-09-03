import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
import { formatFocusedSelectorExample } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const ORIGINAL_FORMAT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must reject removal of only the final LF byte.",
  "",
].join("\n");
const UPDATED_FORMAT = `${ORIGINAL_FORMAT}Clarification: preserve configured record order.\n`;

describe("authoritative source requested as task output", () => {
  it("preserves immutable source authority while allowing an explicitly declared edit", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness);
      const original = await selectSource(harness, true);
      const checklist = completionChecklist(original);
      const recorded = await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["FORMAT.md"],
        source_output_paths: ["FORMAT.md"],
        completion_checklist: checklist,
      });
      expect(recorded).toContain("Completion checklist recorded");
      expect.soft(JSON.stringify(harness.controller.toolDefinition.parameters)).toContain('"source_output_paths"');

      await editFormat(harness, cwd);
      const retained = requiredObligation(harness);
      expect(retained.id).toBe(original.id);
      expect(original.sourceSha256).toBe(sha256(ORIGINAL_FORMAT));
      expect(retained.sourceSha256).toBe(original.sourceSha256);
      expect(retained.sourceSha256).not.toBe(sha256(UPDATED_FORMAT));
      const restored = createTaskVerificationController(harness.sessionManager, "evidence");
      expect(restored.restoreError).toBeUndefined();
      expect(restored.currentState.criticalProofSourceOutputs).toEqual(
        harness.controller.currentState.criticalProofSourceOutputs,
      );

      const proofRef = evidenceHandle(await focusedProof(harness, original.id));
      const outputRef = evidenceHandle(await exactOutputProof(harness));
      expect(await ready(harness, [[proofRef], [proofRef]])).not.toContain("verification_token:");
      expect(await ready(harness, [[outputRef], [outputRef]])).not.toContain("verification_token:");
      const readiness = await ready(harness, [
        [proofRef, outputRef],
        [proofRef, outputRef],
      ]);
      expect(readiness).toContain("verification_token:");
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps finish blocked when the authoritative source edit was not declared as output", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness);
      const original = await selectSource(harness, false);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["FORMAT.md"],
          completion_checklist: completionChecklist(original),
        }),
      ).toContain("Completion checklist recorded");

      await editFormat(harness, cwd);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          source_output_paths: ["FORMAT.md"],
          completion_checklist: completionChecklist(original),
        }),
      ).toContain("must be declared before the task first mutates FORMAT.md");
      const proofRef = evidenceHandle(await focusedProof(harness, original.id));
      const outputRef = evidenceHandle(await exactOutputProof(harness));
      expect(
        await ready(harness, [
          [proofRef, outputRef],
          [proofRef, outputRef],
        ]),
      ).toContain("changed after its critical proof boundary was recorded");
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.reason).toContain(
        "changed after its critical proof boundary was recorded",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("captures the original source baseline for a pathless shell deletion", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(
        harness,
        "Implement the FORMAT.md behavior, then delete FORMAT.md as requested.\n[source-output:FORMAT.md]",
      );
      const outputCriterion = "FORMAT.md is deleted";
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["FORMAT.md"],
          source_output_paths: ["FORMAT.md"],
          completion_checklist: [outputCriterion],
        }),
      ).toContain("append");
      const obligation = requiredObligation(harness);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [outputCriterion, evidenceCriticalProofRequirement(obligation).acceptanceCriterion],
        }),
      ).toContain("Completion checklist recorded");

      const deleteArgs = { command: "rm FORMAT.md" };
      const deleteCall = evidenceToolCall("bash", deleteArgs);
      expect(await beforeEvidenceTool(harness.agent, "bash", deleteArgs, deleteCall)).toBeUndefined();
      rmSync(join(cwd, "FORMAT.md"));
      await afterEvidenceTool(harness.agent, "bash", deleteArgs, "", deleteCall);
      expect(harness.controller.currentState.taskOwnedPathBaselines).toContainEqual({
        path: "FORMAT.md",
        state: `file:-:${sha256(ORIGINAL_FORMAT)}`,
      });

      const proofRef = evidenceHandle(await focusedProof(harness, obligation.id));
      const absentArgs = { command: "test ! -e FORMAT.md" };
      const absentCall = evidenceToolCall("bash", absentArgs);
      expect(await beforeEvidenceTool(harness.agent, "bash", absentArgs, absentCall)).toBeUndefined();
      const absentRef = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", absentArgs, "FORMAT.md absent", absentCall),
      );
      expect(await ready(harness, [[absentRef], [proofRef]])).toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-authoritative-source-output-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "FORMAT.md"), ORIGINAL_FORMAT);
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

async function sendPrompt(
  harness: ReturnType<typeof createEvidenceHarness>,
  content = "Implement the behavior required by FORMAT.md and edit FORMAT.md itself to add the clarification.\n[source-output:FORMAT.md]",
): Promise<void> {
  await harness.emit({ type: "turn_start" });
  await harness.emit({
    type: "message_end",
    message: {
      role: "user",
      content,
      timestamp: 100,
    },
  });
}

function requiredObligation(harness: ReturnType<typeof createEvidenceHarness>) {
  const obligation = harness.controller.currentState.criticalProofObligations?.[0];
  if (!obligation) throw new Error("missing authoritative FORMAT.md critical-proof obligation");
  return obligation;
}

async function selectSource(harness: ReturnType<typeof createEvidenceHarness>, taskOutput: boolean) {
  const result = await callEvidenceVerification(harness.controller, {
    action: "record_completion_checklist",
    authoritative_source_paths: ["FORMAT.md"],
    ...(taskOutput ? { source_output_paths: ["FORMAT.md"] } : {}),
    completion_checklist: [exactOutputCriterion()],
  });
  expect(result).toContain("append");
  return requiredObligation(harness);
}

function completionChecklist(obligation: ReturnType<typeof requiredObligation>): string[] {
  return [exactOutputCriterion(), evidenceCriticalProofRequirement(obligation).acceptanceCriterion];
}

function exactOutputCriterion(): string {
  return `FORMAT.md has exact bytes with a terminal newline; exact_file_bytes("FORMAT.md",${JSON.stringify(UPDATED_FORMAT)})`;
}

async function editFormat(harness: ReturnType<typeof createEvidenceHarness>, cwd: string): Promise<void> {
  const args = {
    path: "FORMAT.md",
    edits: [{ oldText: ORIGINAL_FORMAT, newText: UPDATED_FORMAT }],
  };
  const call = evidenceToolCall("edit", args);
  expect((await beforeEvidenceTool(harness.agent, "edit", args, call))?.block).not.toBe(true);
  writeFileSync(join(cwd, "FORMAT.md"), UPDATED_FORMAT);
  await afterEvidenceTool(harness.agent, "edit", args, "edited FORMAT.md", call);
}

async function focusedProof(harness: ReturnType<typeof createEvidenceHarness>, requirementId: string) {
  const obligation = requiredObligation(harness);
  const selector = formatFocusedSelectorExample(evidenceCriticalProofRequirement(obligation));
  const args = { command: `vitest --run test/store.test.ts -t '${selector}'` };
  const call = evidenceToolCall("bash", args);
  expect(await beforeEvidenceTool(harness.agent, "bash", args, call)).toBeUndefined();
  return afterEvidenceTool(harness.agent, "bash", args, `Tests 1 passed (1)\n${proofFrame(requirementId)}`, call);
}

async function exactOutputProof(harness: ReturnType<typeof createEvidenceHarness>) {
  const command = `diff <(printf '${UPDATED_FORMAT.replaceAll("\n", "\\n")}') FORMAT.md`;
  return afterEvidenceTool(harness.agent, "bash", { command }, "");
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

async function ready(
  harness: ReturnType<typeof createEvidenceHarness>,
  evidenceRefsByCheck: string[][],
): Promise<string> {
  return callEvidenceVerification(harness.controller, {
    action: "ready_to_finish",
    evidence_refs_by_check: evidenceRefsByCheck,
    unresolved_failures: [],
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
