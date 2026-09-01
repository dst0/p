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

const STATUS_CONTENT = "build: green\ndeploy: ready\n";
const STATUS_CRITERION =
  'status.txt has exact bytes with a terminal newline; exact_file_bytes("status.txt","build: green\\ndeploy: ready\\n")';
const MODEL_GENERATED_STATUS_CRITERION =
  "status.txt contains exactly two newline-terminated lines: 'build: green' and 'deploy: ready'";

describe("evidence-mode exact non-code content shell proof", () => {
  it("associates a literal assertion with a model-generated natural criterion", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-natural-exact-content-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Create the exact two-line status.txt report.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [MODEL_GENERATED_STATUS_CRITERION],
      });
      const writeArgs = { path: "status.txt", content: STATUS_CONTENT };
      const writeCall = evidenceToolCall("write", writeArgs);
      await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall);
      writeFileSync(join(cwd, "status.txt"), STATUS_CONTENT);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote status.txt", writeCall);

      const wrongCommand = "diff <(printf 'build: red\\ndeploy: blocked\\n') status.txt";
      const wrongCall = evidenceToolCall("bash", { command: wrongCommand });
      await afterEvidenceTool(harness.agent, "bash", { command: wrongCommand }, "1c1,2", wrongCall, true);
      const command = "diff <(printf 'build: green\\ndeploy: ready\\n') status.txt";
      const exactCall = evidenceToolCall("bash", { command });
      await afterEvidenceTool(harness.agent, "bash", { command }, "", exactCall);

      const rejected = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[`@${wrongCall.id}`]],
        unresolved_failures: [],
      });
      expect(rejected).toContain("failed evidence cannot prove readiness");

      const result = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[`@${exactCall.id}`]],
        unresolved_failures: [],
      });
      expect(result).toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("accepts an exact path-and-bytes shell assertion but not reads or an unrelated generic suite", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-exact-content-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Create status.txt with exactly these two newline-terminated lines: build: green; deploy: ready.",
          timestamp: 100,
        },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [STATUS_CRITERION],
        }),
      ).toContain("Completion checklist recorded");

      const writeArgs = { path: "status.txt", content: STATUS_CONTENT };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "status.txt"), STATUS_CONTENT);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote status.txt", writeCall);

      const otherWriteArgs = { path: "other.txt", content: STATUS_CONTENT };
      const otherWriteCall = evidenceToolCall("write", otherWriteArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", otherWriteArgs, otherWriteCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "other.txt"), STATUS_CONTENT);
      await afterEvidenceTool(harness.agent, "write", otherWriteArgs, "wrote other.txt", otherWriteCall);

      const readEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: "status.txt" }, STATUS_CONTENT),
      );
      const readOnly = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[readEvidence]],
        unresolved_failures: [],
      });
      expect(readOnly).toContain("requires a relevant focused passing test");

      const genericEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: "npm test" }, "Tests 42 passed"),
      );
      const genericReady = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[genericEvidence]],
        unresolved_failures: [],
      });
      expect(genericReady).toContain("requires a relevant focused passing test");

      const unrelatedCommand = "diff <(printf 'build: green\\ndeploy: ready\\n') other.txt";
      const unrelatedEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: unrelatedCommand }, ""),
      );
      const unrelatedReady = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[unrelatedEvidence]],
        unresolved_failures: [],
      });
      expect(unrelatedReady).toContain("requires a relevant focused passing test");

      const exactCommand = "diff <(printf 'build: green\\ndeploy: ready\\n') status.txt && echo EXACT MATCH";
      const exactEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: exactCommand }, "EXACT MATCH"),
      );
      expect(harness.controller.evidence.get(exactEvidence)?.mutationRevision).toBe(
        harness.controller.currentState.mutationRevision,
      );
      const exactReady = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[exactEvidence]],
        unresolved_failures: [],
      });
      expect(exactReady).toContain("verification_token:");

      writeFileSync(join(cwd, "status.txt"), "build: red\ndeploy: blocked\n");
      const changedReady = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[exactEvidence]],
        unresolved_failures: [],
      });
      expect(changedReady).toContain("requires a relevant focused passing test");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
