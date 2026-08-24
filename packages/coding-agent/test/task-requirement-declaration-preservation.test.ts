import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  computeRequirementSetHash,
  computeStateUserRequirementsHash,
} from "../src/core/task-verification/requirement-audit-hashing.ts";
import {
  auditEvidenceHandle,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("task declaration requirement preservation", () => {
  it("keeps a valid fixed definition live across pre-mutation task reclassification", async () => {
    const fixture = await acceptedReferencedDefinition();
    try {
      const evidenceRef = auditEvidenceHandle(
        await recordAuditToolResult(
          fixture.harness.agent,
          "bash",
          { command: "node --test validator.test.js" },
          { text: "focused authenticity test passed" },
        ),
      );
      const stateBeforePass = fixture.harness.controller.state;
      stateBeforePass.readiness = {
        status: "evidence_ready",
        acceptanceChecks: [{ criterion: "The authenticity contract passes", evidenceRefs: [evidenceRef] }],
        verifiedMutationRevision: stateBeforePass.mutationRevision,
        userRequirementsHash: stateBeforePass.requirementAudit.userRequirementsHash,
        requirementSetHash: stateBeforePass.requirementAudit.requirementSetHash,
      };
      await nextModelTurn(fixture.harness);
      expect(
        await callRequirementAudit(fixture.harness.controller, {
          action: "verdict",
          verdicts: [
            {
              requirement_id: "R1",
              passed: true,
              reason: "Focused evidence proves byte-identical candidates are accepted.",
              evidence_refs: [evidenceRef],
            },
          ],
        }),
      ).toContain("Requirement audit passed: 1/1");
      const passedAudit = structuredClone(fixture.harness.controller.currentState.requirementAudit);
      expect(passedAudit.status).toBe("passed");
      expect(passedAudit.verifiedMutationRevision).toBe(0);
      const expectedRequirements = structuredClone(passedAudit.requirements);
      for (const requirement of expectedRequirements) requirement.verdict = undefined;

      const declared = await callTaskVerification(fixture.harness.controller, {
        action: "declare_task",
        task_kind: "behavior_change",
        task_summary: "Implement the accepted authenticity contract",
      });

      const state = fixture.harness.controller.currentState;
      expect(declared).toContain("Task declared");
      expect(state.taskKind).toBe("behavior_change");
      expect(state.baseline).toMatchObject({ required: true, status: "pending" });
      expect(state.final.status).toBe("pending");
      expect(state.readiness?.status).toBe("pending");
      expect(state.requirementAudit).toMatchObject({
        status: "verifying",
        nextRequirementIndex: 0,
        userRequirementsHash: passedAudit.userRequirementsHash,
        requirementSetHash: passedAudit.requirementSetHash,
      });
      expect(state.requirementAudit.requirements).toEqual(expectedRequirements);
      expect(state.requirementAudit.verifiedMutationRevision).toBeUndefined();
      expect(state.requirementAudit.userRequirementsHash).toBe(computeStateUserRequirementsHash(state));
      expect(state.requirementAudit.requirementSetHash).toBe(
        computeRequirementSetHash(
          state.requirementAudit.requirements,
          state.requirementAudit.ignoredSourcePrompts,
          state.requirementAudit.ignoredSourceClauses,
        ),
      );

      await callTaskVerification(fixture.harness.controller, {
        action: "authorize_baseline_test",
        test_paths: ["validator.test.js"],
      });
      await recordAuditToolResult(fixture.harness.agent, "edit", {
        path: "validator.test.js",
        edits: [{ oldText: "placeholder", newText: "failing authenticity regression" }],
      });
      const command = "node --test validator.test.js";
      const baselineEvidence = auditEvidenceHandle(
        await recordAuditToolResult(
          fixture.harness.agent,
          "bash",
          { command },
          { isError: true, text: "expected authenticity baseline failure" },
        ),
      );
      await callTaskVerification(fixture.harness.controller, {
        action: "record_baseline",
        baseline_method: "failing_regression_test",
        hypothesis: "The current implementation violates the accepted authenticity contract",
        conclusion: "The focused regression reproduces the missing behavior",
        evidence_refs: [baselineEvidence],
        unresolved_assumptions: [],
      });
      expect(
        await beforeAuditTool(fixture.harness.agent, "edit", {
          path: "validator.js",
          edits: [{ oldText: "before", newText: "after" }],
        }),
      ).toBeUndefined();
      await recordAuditToolResult(fixture.harness.agent, "write", {
        path: "validator.js",
        content: "export const valid = true;\n",
      });
      const postMutationEvidenceRef = auditEvidenceHandle(
        await recordAuditToolResult(
          fixture.harness.agent,
          "bash",
          { command },
          { text: "focused authenticity test passed" },
        ),
      );
      await nextModelTurn(fixture.harness);
      const ready = await callTaskVerification(fixture.harness.controller, {
        action: "ready_to_finish",
        acceptance_checks: [
          { criterion: "The authenticity contract passes", evidence_refs: [postMutationEvidenceRef] },
        ],
        unresolved_failures: [],
      });
      expect(ready).toContain("Reusing the existing 1-item requirement set");
    } finally {
      rmSync(fixture.cwd, { recursive: true, force: true });
    }
  });

  it("does not treat a stale requirement-set hash as a frozen definition", async () => {
    const fixture = await acceptedReferencedDefinition();
    try {
      fixture.harness.controller.state.requirementAudit.requirementSetHash = "stale-requirement-set-hash";

      await callTaskVerification(fixture.harness.controller, {
        action: "declare_task",
        task_kind: "behavior_change",
        task_summary: "Implement the accepted authenticity contract",
      });

      expect(fixture.harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");

      const gate = await beforeAuditTool(fixture.harness.agent, "edit", {
        path: "validator.js",
        edits: [{ oldText: "before", newText: "after" }],
      });

      expect(gate?.block).toBe(true);
      expect(gate?.reason).toContain("Define the prepared referenced requirements");
      await nextModelTurn(fixture.harness);
      expect(await callRequirementAudit(fixture.harness.controller, definitionInput())).toContain(
        "Defined 1 atomic requirement",
      );
    } finally {
      rmSync(fixture.cwd, { recursive: true, force: true });
    }
  });

  it("does not clear a missing frozen-source restoration error during reclassification", async () => {
    const fixture = await acceptedReferencedDefinition();
    try {
      fixture.harness.controller.restoreError = "requirement-source snapshot README.md is missing or corrupt";
      fixture.harness.controller.requirementSourceTexts.clear();

      await callTaskVerification(fixture.harness.controller, {
        action: "declare_task",
        task_kind: "feature",
        task_summary: "Implement the accepted authenticity contract",
      });

      expect(fixture.harness.controller.restoreError).toContain("requirement-source snapshot README.md");
      expect(fixture.harness.controller.currentState.requirementAudit.status).toBe("pending");
      const gate = await beforeAuditTool(fixture.harness.agent, "edit", {
        path: "validator.js",
        edits: [{ oldText: "before", newText: "after" }],
      });
      expect(gate?.block).toBe(true);
      expect(gate?.reason).toContain("Cannot change the workspace");
    } finally {
      rmSync(fixture.cwd, { recursive: true, force: true });
    }
  });
});

async function acceptedReferencedDefinition(): Promise<{ harness: RequirementAuditHarness; cwd: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "p-task-declaration-requirements-"));
  writeFileSync(join(cwd, "README.md"), "# Authenticity\n\nReturn true for a byte-identical candidate.\n");
  git(cwd, "init", "-q");
  git(cwd, "config", "maintenance.auto", "false");
  git(cwd, "config", "gc.auto", "0");
  git(cwd, "add", "README.md");
  const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
  await sendAuditUserPrompt(harness, "Implement every requirement from README.md in validator.js.", 300);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "docs",
    task_summary: "Implement every requirement from README.md in validator.js",
  });
  expect(
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    }),
  ).toContain("Prepared 1 immutable requirement-source snapshot");
  await nextModelTurn(harness);
  expect(await callRequirementAudit(harness.controller, definitionInput())).toContain("Defined 1 atomic requirement");
  return { harness, cwd };
}

function definitionInput() {
  return {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "Return true for a byte-identical candidate",
        acceptance_criterion: "isAuthentic returns true when the candidate is byte-identical to the original",
        source_clause_ids: ["S2-C2"],
      },
    ],
    ignored_source_prompts: [
      { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
    ],
    ignored_source_clauses: [],
  } as const;
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
