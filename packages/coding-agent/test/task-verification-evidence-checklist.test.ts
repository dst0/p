import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
import {
  exactFinalByteProofDomains,
  sourceRequiresExactFinalByteProof,
} from "../src/core/task-verification/evidence-critical-proof-source.ts";
import { formatFocusedSelectorExample } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  afterEvidenceTool as afterTool,
  beforeEvidenceTool as beforeTool,
  callEvidenceVerification as callVerification,
  createEvidenceHarness as createHarness,
  evidenceHandle,
  evidenceToolCall as toolCall,
} from "./task-verification-evidence-test-harness.ts";

describe("evidence-mode completion checklist", () => {
  it("exposes only checklist, readiness, and status actions to the provider", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const schema = JSON.stringify(controller.toolDefinition.parameters);
    expect(schema).toContain('"const":"status"');
    expect(schema).toContain('"const":"record_completion_checklist"');
    expect(schema).toContain('"const":"ready_to_finish"');
    expect(schema).toContain('"completion_checklist"');
    expect(schema).toContain('"evidence_refs_by_check"');
    expect(schema).not.toContain('"const":"declare_task"');
    expect(schema).not.toContain('"task_kind"');
    expect(schema).not.toContain('"baseline_method"');
    expect(schema).not.toContain('"final_method"');
  });

  it("derives the terminal-byte obligation only from one shared serialized-artifact domain", () => {
    expect(
      sourceRequiresExactFinalByteProof(
        "exportLog returns newline-terminated JSONL.\nfromLog validates structure. Any truncation or extra data throws ValidationError.",
      ),
    ).toBe(true);
    expect(sourceRequiresExactFinalByteProof("Export newline-terminated JSONL.")).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof(
        "Export newline-terminated JSONL. Image import rejects any image truncation or extra pixels.",
      ),
    ).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof("JSONL export ends with LF. Truncated JSONL must always be rejected."),
    ).toBe(true);
    expect(
      exactFinalByteProofDomains(
        "Every exported CSV invoice ends with LF. Any truncation of the invoice must be rejected.",
      ),
    ).toEqual(["serialized-artifact"]);
    expect(
      exactFinalByteProofDomains(
        "Every exported CSV invoice ends with LF. Any truncation of the video must be rejected.",
      ),
    ).toEqual([]);
  });

  it("freezes one behavior checklist before mutation and focuses terminal-byte truncation proof", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-checklist-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    const readme = [
      "# Contract",
      "Export deterministic newline-terminated JSONL.",
      "JSONL import must reject any truncation or extra data.",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "README.md"), readme);
    execFileSync("git", ["add", "README.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      const message = {
        role: "user" as const,
        content: "Implement the persistence contract from README.md and add regression tests.",
        timestamp: 100,
      };
      await harness.emit({ type: "turn_start" });
      await harness.emit({ type: "message_end", message });

      const writeArgs = { path: "src/store.ts", content: "export {};\n" };
      expect((await beforeTool(harness.agent, "write", writeArgs))?.block).toBe(true);

      await afterTool(harness.agent, "read", { path: "README.md" }, readme);
      const genericChecklist = await callVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["All tests pass", "TypeScript typecheck passes"],
      });
      expect(genericChecklist).toContain("observable requested behavior");

      const recorded = await callVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [
          "Export emits deterministic newline-terminated JSONL",
          "JSONL import rejects truncation caused by removing exactly the final LF byte",
        ],
      });
      expect(recorded).toContain("Completion checklist recorded");

      const writeCall = toolCall("write", writeArgs);
      expect((await beforeTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "src/store.ts"), writeArgs.content);
      await afterTool(harness.agent, "write", writeArgs, "wrote file", writeCall);

      const broadEvidence = evidenceHandle(
        await afterTool(harness.agent, "bash", { command: "npm test" }, "Tests 42 passed"),
      );
      const broadReady = await callVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[broadEvidence], [broadEvidence]],
        unresolved_failures: [],
      });
      expect(broadReady).toContain("same-run P_PROOF_V1 exact-byte witness");

      const exportEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "vitest --run test/log-persistence.test.ts -t 'newline terminated export'" },
          "Test Files 1 passed (1)\nTests 1 passed (1)",
        ),
      );
      const obligation = harness.controller.currentState.criticalProofObligations?.[0];
      if (!obligation) throw new Error("Missing critical proof obligation");
      const truncationEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          {
            command: `vitest --run test/log-persistence.test.ts -t '${formatFocusedSelectorExample(evidenceCriticalProofRequirement(obligation))}'`,
          },
          ["Test Files 1 passed (1)", "Tests 1 passed (1)", proofFrame(obligation.id)].join("\n"),
        ),
      );
      const ready = await callVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[exportEvidence], [truncationEvidence]],
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");

      const finishArgs: Record<string, unknown> = { status: "success" };
      expect((await beforeTool(harness.agent, "finish_work", finishArgs))?.block).not.toBe(true);
      expect(finishArgs.files_changed).toEqual(["src/store.ts"]);
      expect(finishArgs.verification_token).toBe(harness.controller.currentState.readiness?.token);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("stales the frozen checklist after a substantive follow-up but leaves reads and tests ungated", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-checklist-epoch-"));
    execFileSync("git", ["init", "-q"], { cwd });
    mkdirSync(join(cwd, "src"));
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Implement the parser behavior.", timestamp: 100 },
      });
      expect((await beforeTool(harness.agent, "read", { path: "README.md" }))?.block).not.toBe(true);
      expect((await beforeTool(harness.agent, "bash", { command: "npm test" }))?.block).not.toBe(true);
      expect(
        await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["The parser accepts valid input"],
        }),
      ).toContain("Completion checklist recorded");

      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Also reject malformed input without partial state.", timestamp: 101 },
      });
      const writeArgs = { path: "src/parser.ts", content: "export {};\n" };
      expect((await beforeTool(harness.agent, "write", writeArgs))?.block).toBe(true);
      expect(
        await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["The parser accepts valid input", "Malformed input is rejected without partial state"],
        }),
      ).toContain("Completion checklist recorded");
      expect((await beforeTool(harness.agent, "write", writeArgs))?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function proofFrame(requirementId: string | undefined): string {
  if (!requirementId) throw new Error("Missing critical proof obligation");
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
