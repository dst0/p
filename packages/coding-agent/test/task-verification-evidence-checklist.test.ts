import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  persistedCompletionChecklistIsCanonical,
  validatedCompletionChecklist,
} from "../src/core/task-verification/completion-checklist-policy.ts";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
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
  it("rejects process-only combinations without rejecting behavioral or artifact outcomes", () => {
    for (const criterion of [
      "All existing tests and typecheck pass",
      "npm run check and npm run test pass",
      "Tests are green",
      "npm test and npm run check both pass",
      "type checks and tests pass",
      "npm test should pass",
      "All tests pass without failures",
    ]) {
      expect(validatedCompletionChecklist([criterion])).toContain("observable requested behavior");
    }

    expect(
      validatedCompletionChecklist([
        "The parser rejects malformed input without retaining partial state",
        "Export creates the requested deterministic newline-terminated JSONL artifact",
      ]),
    ).toEqual([
      "The parser rejects malformed input without retaining partial state",
      "Export creates the requested deterministic newline-terminated JSONL artifact",
    ]);
    expect(
      validatedCompletionChecklist([
        'exportHistory prepends exactly {"count":N} metadata and ends with exactly one LF',
        "All npm test cases pass",
      ]),
    ).toEqual(['exportHistory prepends exactly {"count":N} metadata and ends with exactly one LF']);
    expect(
      validatedCompletionChecklist([
        "All npm test cases pass",
        'exportHistory prepends exactly {"count":N} metadata and ends with exactly one LF',
      ]),
    ).toEqual(['exportHistory prepends exactly {"count":N} metadata and ends with exactly one LF']);
    expect(
      persistedCompletionChecklistIsCanonical([
        'exportHistory prepends exactly {"count":N} metadata and ends with exactly one LF',
        "All npm test cases pass",
      ]),
    ).toBe(false);
  });

  it("exposes bounded intent, checklist, readiness, and status actions to the provider", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const schema = JSON.stringify(controller.toolDefinition.parameters);
    expect(schema).toContain('"const":"status"');
    expect(schema).toContain('"const":"record_completion_checklist"');
    expect(schema).toContain('"const":"ready_to_finish"');
    expect(schema).toContain('"completion_checklist"');
    expect(schema).toContain('"maxItems":24');
    expect(schema).toContain('"authoritative_source_paths"');
    expect(schema).toContain('"evidence_refs_by_check"');
    expect(schema).toContain('"const":"declare_task"');
    expect(schema).toContain('"task_kind"');
    expect(schema).not.toContain('"baseline_method"');
    expect(schema).not.toContain('"final_method"');
    const guidelines = controller.toolDefinition.promptGuidelines?.join("\n") ?? "";
    expect(controller.toolDefinition.description).toContain("response-only or mutating tasks");
    expect(guidelines).toContain("reread the user request and authoritative sources once");
    expect(guidelines).toContain("controller does not reconstruct an exhaustive free-text clause matrix");
    expect(controller.toolDefinition.promptSnippet).toContain("after effects");
    expect(guidelines).toContain('"response_only" only for a user-visible answer');
    expect(guidelines).toContain('set verification_scope to "response_only", and do not call ready_to_finish');
    expect(guidelines).toContain("unclassified requested intent");
    expect(guidelines).toContain("same-prompt declaration cannot be changed");
  });

  it("freezes one behavior checklist before mutation and focuses terminal-byte truncation proof", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-evidence-checklist-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    const specification = [
      "# History format specification",
      'The first record must be metadata with exactly {"count":N}.',
      "The next N records must be supplied records in order.",
      "Every non-empty export must end with exactly one LF byte.",
      "Import must reject malformed JSON, count mismatches, removal of a complete trailing record, and removal of only the final LF byte.",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "SPEC.md"), specification);
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      const message = {
        role: "user" as const,
        content: "Treat SPEC.md as the authoritative specification and implement the history format.",
        timestamp: 100,
      };
      await harness.emit({ type: "turn_start" });
      await harness.emit({ type: "message_end", message });
      const discovered = harness.controller.currentState.criticalProofObligations?.[0];
      if (!discovered) throw new Error("Missing prompt-discovered critical proof obligation");
      expect(discovered.sourcePath).toBe("SPEC.md");
      expect(discovered.artifactDomain).toBe("serialized-artifact");

      const writeArgs = { path: "src/store.ts", content: "export {};\n" };
      expect((await beforeTool(harness.agent, "write", writeArgs))?.block).toBe(true);

      await afterTool(harness.agent, "read", { path: join(cwd, "..", "SPEC.md") }, specification);
      expect(harness.controller.currentState.criticalProofObligations?.[0]?.id).toBe(discovered.id);
      await afterTool(harness.agent, "read", { path: join(cwd, "SPEC.md") }, specification);
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
      for (const processOnlyCriterion of [
        "All tests pass",
        "TypeScript typecheck passes",
        "npm run typecheck passes (no TS errors)",
        "npm run test passes (full suite including existing tests)",
      ]) {
        const genericChecklist = await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [processOnlyCriterion],
        });
        expect(genericChecklist).toContain("observable requested behavior");
      }

      const recorded = await callVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [
          'Export starts with exactly {"count":N} metadata, emits all N supplied records in order as newline-terminated JSONL, and every non-empty export ends with exactly one LF byte',
          "Serialized artifact import rejects truncation caused by removing exactly the final LF byte",
          "All npm test cases pass",
        ],
      });
      expect(recorded).toContain("Completion checklist recorded");
      expect(harness.controller.currentState.completionChecklist?.criteria).toEqual([
        'Export starts with exactly {"count":N} metadata, emits all N supplied records in order as newline-terminated JSONL, and every non-empty export ends with exactly one LF byte',
        "Serialized artifact import rejects truncation caused by removing exactly the final LF byte",
      ]);

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
      const incompleteReady = await callVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[exportEvidence], [truncationEvidence]],
        unresolved_failures: [],
      });
      expect(incompleteReady).toContain("did not name the complete invariant");
      const exactMetadataEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          {
            command:
              "vitest --run test/log-persistence.test.ts -t 'export starts with exactly count only metadata emits all n supplied records in order as newline terminated jsonl and every non empty export ends with exactly one lf byte'",
          },
          "Test Files 1 passed (1)\nTests 1 passed (1)",
        ),
      );
      const ready = await callVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[exactMetadataEvidence], [truncationEvidence]],
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
