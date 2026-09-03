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

describe("evidence-mode explicit controller proof obligation", () => {
  it.each([
    {
      prompt: "Update README.md documentation to explain P_PROOF_V1.",
      criterion: "README.md explains the P_PROOF_V1 protocol label",
      path: "README.md",
    },
    {
      prompt: "Rename the runtime constant P_PROOF_V1 without changing behavior.",
      criterion: "The runtime constant is renamed without changing behavior",
      path: "store.ts",
    },
    {
      prompt: "Refactor the helper that emits P_PROOF_V1 without changing behavior.",
      criterion: "The helper is refactored without changing behavior",
      path: "helper.ts",
    },
    {
      prompt: "The runtime must preserve P_PROOF_V1 as an internal protocol label during this refactor.",
      criterion: "The runtime preserves the internal protocol label during the refactor",
      path: "protocol.ts",
    },
    {
      prompt: "The runtime must not emit P_PROOF_V1 during dry runs.",
      criterion: "Dry runs do not emit the protocol frame",
      path: "dry-run.ts",
    },
    {
      prompt: "The validator should reject commands that emit P_PROOF_V1 outside tests.",
      criterion: "The validator rejects protocol frames emitted outside tests",
      path: "validator.ts",
    },
    {
      prompt: "The regression does not have to emit P_PROOF_V1 before completion.",
      criterion: "The regression remains optional",
      path: "optional-regression.ts",
    },
    {
      prompt: "The refactor does not require the regression to emit P_PROOF_V1 before completion.",
      criterion: "The refactor keeps the regression optional",
      path: "optional-refactor.ts",
    },
  ])(
    "does not mistake an informational token mention for a proof demand: $prompt",
    async ({ prompt, criterion, path }) => {
      const cwd = mkdtempSync(join(tmpdir(), "p-explicit-proof-mention-"));
      const harness = createEvidenceHarness(cwd);
      try {
        await harness.emit({ type: "turn_start" });
        await harness.emit({
          type: "message_end",
          message: { role: "user", content: prompt, timestamp: 100 },
        });
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [criterion],
        });
        const writeArgs = { path, content: "verified\n" };
        const writeCall = evidenceToolCall("write", writeArgs);
        await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall);
        writeFileSync(join(cwd, path), writeArgs.content);
        await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote requested file", writeCall);
        const evidenceRefs = [
          evidenceHandle(await afterEvidenceTool(harness.agent, "read", { path }, writeArgs.content)),
        ];
        if (path === "validator.ts") {
          evidenceRefs.push(
            evidenceHandle(
              await afterEvidenceTool(
                harness.agent,
                "bash",
                { command: `node --test --test-name-pattern "${criterion}" test/validator.test.ts` },
                "Tests 1 passed",
              ),
            ),
          );
        }
        const result = await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          evidence_refs_by_check: [evidenceRefs],
          unresolved_failures: [],
        });
        expect(result).not.toContain("no critical proof obligation is active");
        expect(result).toContain("verification_token:");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it.each([
    "Add a regression with the controller-required proof witness.",
    "Add a regression that must emit a P_PROOF_V1 witness.",
    "P_PROOF_V1 needs to be emitted by the regression before completion.",
    "Ensure P_PROOF_V1 is emitted by the regression before completion.",
    "Require the regression to emit P_PROOF_V1 before completion.",
    "The regression has to emit P_PROOF_V1 before completion.",
    "Dry runs must not emit P_PROOF_V1, but the regression must emit P_PROOF_V1 before completion.",
  ])("fails closed when a task requires controller proof but discovery produced no obligation: %s", async (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), "p-explicit-proof-obligation-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: prompt,
          timestamp: 100,
        },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["Store returns imported records unchanged"],
      });
      const writeArgs = { path: "store.ts", content: "export {};\n" };
      const writeCall = evidenceToolCall("write", writeArgs);
      await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote store.ts", writeCall);
      const passing = evidenceHandle(
        await afterEvidenceTool(
          harness.agent,
          "bash",
          {
            command: 'node --test --test-name-pattern "Store returns imported records unchanged" test/store.test.ts',
          },
          "Tests 1 passed",
        ),
      );

      const feedback = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[passing]],
        unresolved_failures: [],
      });
      expect(feedback).toContain("no critical proof obligation is active");
      expect(feedback).toContain("Re-read the explicitly referenced authoritative source");
      expect(feedback).not.toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
