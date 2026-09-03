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

const CRITERION = "importHistory throws on any truncation and does not retain partial history";

describe("evidence-mode high-risk selector feedback", () => {
  it("turns a semantically incomplete focused selector into one bounded repair", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-high-risk-selector-feedback-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Implement safe calculation-history import.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [CRITERION],
      });
      await recordSuccessfulMutation(harness, cwd);

      for (const command of [
        "node --test test/calculator.history.test.ts",
        "node --test test/calculator.truncation.test.ts",
        'node --test --test-name-pattern "truncation.*throws.*partial" test/calculator.truncation.test.ts',
      ]) {
        const incomplete = evidenceHandle(
          await afterEvidenceTool(harness.agent, "bash", { command }, "Tests 1 passed"),
        );
        const feedback = await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          evidence_refs_by_check: [[incomplete]],
          unresolved_failures: [],
        });

        expect(feedback).toContain("focused selector did not name the complete invariant");
        expect(feedback).toContain(CRITERION);
        expect(feedback).toContain("run only that named case");
        expect(feedback).not.toContain("truncation.*throws.*partial");
        expect(feedback).not.toContain("calculator.history.test.ts");
        expect(feedback).not.toContain("calculator.truncation.test.ts");
      }

      const complete = evidenceHandle(
        await afterEvidenceTool(
          harness.agent,
          "bash",
          { command: `node --test --test-name-pattern "${CRITERION}" test/calculator.truncation.test.ts` },
          "Tests 1 passed",
        ),
      );
      const ready = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[complete]],
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps generic suites on the existing fail-closed guidance", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-high-risk-selector-generic-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Implement safe calculation-history import.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [CRITERION],
      });
      await recordSuccessfulMutation(harness, cwd);
      const broad = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: "npm test" }, "Tests 48 passed"),
      );
      const feedback = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[broad]],
        unresolved_failures: [],
      });
      expect(feedback).toContain("requires a relevant focused passing test");
      expect(feedback).not.toContain("run only that named case");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

async function recordSuccessfulMutation(harness: ReturnType<typeof createEvidenceHarness>, cwd: string): Promise<void> {
  const args = { path: "store.ts", content: "export {};\n" };
  const call = evidenceToolCall("write", args);
  await beforeEvidenceTool(harness.agent, "write", args, call);
  writeFileSync(join(cwd, args.path), args.content);
  await afterEvidenceTool(harness.agent, "write", args, "wrote store.ts", call);
}
