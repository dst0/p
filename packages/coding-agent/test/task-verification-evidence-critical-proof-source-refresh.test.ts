import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
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

describe("evidence-mode critical proof source refresh", () => {
  it("blocks stale source proof at readiness, publish, and finish, then replaces the obligation on reread", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Implement the store according to FORMAT.md.", timestamp: 100 },
      });
      await afterEvidenceTool(harness.agent, "read", { path: "FORMAT.md" }, EXACT_LOG_CONTRACT);
      const original = harness.controller.currentState.criticalProofObligations?.[0];
      if (!original) throw new Error("missing original exact-byte obligation");
      const criterion = evidenceCriticalProofRequirement(original).acceptanceCriterion;
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [criterion],
      });
      const writeArgs = { path: "src/store.ts", content: "export {};\n" };
      const writeCall = evidenceToolCall("write", writeArgs);
      await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall);
      writeFileSync(join(cwd, "src/store.ts"), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote file", writeCall);
      const originalEvidence = evidenceHandle(await focusedProofEvidence(harness, original.id, criterion));
      expect(await ready(harness, originalEvidence)).toContain("verification_token:");

      const updatedContract = `${EXACT_LOG_CONTRACT}Rejected input leaves the import cursor unchanged.\n`;
      writeFileSync(join(cwd, "FORMAT.md"), updatedContract);
      expect(await ready(harness, originalEvidence)).toContain(
        "changed after its critical proof boundary was recorded",
      );
      expect((await beforeEvidenceTool(harness.agent, "bash", { command: "git push" }))?.reason).toContain(
        "changed after its critical proof boundary was recorded",
      );
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.reason).toContain(
        "changed after its critical proof boundary was recorded",
      );

      await afterEvidenceTool(harness.agent, "read", { path: "FORMAT.md" }, updatedContract);
      const replacement = harness.controller.currentState.criticalProofObligations?.[0];
      if (!replacement) throw new Error("missing replacement exact-byte obligation");
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
      expect(replacement.id).not.toBe(original.id);
      expect(replacement.sourceSha256).not.toBe(original.sourceSha256);
      expect(await ready(harness, originalEvidence)).toContain("same-run P_PROOF_V1 exact-byte witness");
      const replacementEvidence = evidenceHandle(await focusedProofEvidence(harness, replacement.id, criterion));
      expect(await ready(harness, replacementEvidence)).toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-evidence-critical-source-refresh-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "FORMAT.md"), EXACT_LOG_CONTRACT);
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

async function focusedProofEvidence(
  harness: ReturnType<typeof createEvidenceHarness>,
  requirementId: string,
  criterion: string,
) {
  const obligation = harness.controller.currentState.criticalProofObligations?.find(
    (candidate) => candidate.id === requirementId,
  );
  if (!obligation) throw new Error("missing focused proof obligation");
  const selector = `${evidenceCriticalProofRequirement(obligation).text} ${criterion}`;
  return afterEvidenceTool(
    harness.agent,
    "bash",
    { command: `vitest --run test/store.test.ts -t '${selector}'` },
    `Tests 1 passed (1)\n${proofFrame(requirementId)}`,
  );
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

async function ready(harness: ReturnType<typeof createEvidenceHarness>, evidenceRef: string) {
  return callEvidenceVerification(harness.controller, {
    action: "ready_to_finish",
    evidence_refs_by_check: [[evidenceRef]],
    unresolved_failures: [],
  });
}
