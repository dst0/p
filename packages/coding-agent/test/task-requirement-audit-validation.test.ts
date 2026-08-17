import { describe, expect, it } from "vitest";
import { sourcePromptsForState } from "../src/core/task-verification/requirement-audit-hashing.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    type: "behavior",
    text: "The completion gate enforces the requested behavior",
    acceptance_criterion: "Current focused evidence proves the gate",
    source_prompt_indexes: [1],
    ...overrides,
  };
}

describe("requirement-audit validation", () => {
  it("does not invent source prompts before a task is declared", () => {
    expect(sourcePromptsForState(emptyState("empty-task"))).toEqual([]);
  });

  it("rejects inactive and stale readiness contexts", async () => {
    const inactive = createRequirementAuditHarness();
    expect(
      await callRequirementAudit(inactive.controller, {
        action: "define",
        requirements: [requirement()],
        ignored_source_prompts: [],
      }),
    ).toContain("Requirement audit is not active");

    const stale = createRequirementAuditHarness();
    await reachAuditEvidenceReady(stale);
    stale.controller.state.taskPrompts![0]!.text = "Changed without readiness invalidation";
    await nextModelTurn(stale);
    expect(
      await callRequirementAudit(stale.controller, {
        action: "define",
        requirements: [requirement()],
        ignored_source_prompts: [],
      }),
    ).toContain("accumulated user requirements changed");
  });

  it("rejects malformed and conflicting definitions before freezing the requirement set", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const cases = [
      {
        input: { requirements: [requirement({ type: "unsupported" })], ignored_source_prompts: [] },
        expected: "unsupported type",
      },
      {
        input: { requirements: [requirement({ acceptance_criterion: "   " })], ignored_source_prompts: [] },
        expected: "needs concrete text and acceptance_criterion",
      },
      {
        input: { requirements: [requirement({ source_prompt_indexes: [0] })], ignored_source_prompts: [] },
        expected: "invalid source_prompt_index",
      },
      {
        input: {
          requirements: [requirement()],
          ignored_source_prompts: [{ source_prompt_index: 1, reason: "   " }],
        },
        expected: "invalid or lacks a reason",
      },
      {
        input: {
          requirements: [requirement()],
          ignored_source_prompts: [{ source_prompt_index: 1, reason: "Not a task requirement" }],
        },
        expected: "cannot be both referenced and ignored",
      },
    ];

    for (const { input, expected } of cases) {
      await nextModelTurn(harness);
      expect(await callRequirementAudit(harness.controller, { action: "define", ...input })).toContain(expected);
      expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
    }

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "define",
        requirements: [requirement()],
        ignored_source_prompts: [],
      }),
    ).toContain("Defined 1 atomic requirement");
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "define",
        requirements: [requirement()],
        ignored_source_prompts: [],
      }),
    ).toContain("Requirement definitions are already fixed");
  });

  it("rejects verdicts before definition and evidence from an older mutation revision", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef: oldEvidence } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "A verdict cannot precede the definitions.",
        evidence_refs: [oldEvidence],
      }),
    ).toContain("No requirement verdict is currently expected");

    await nextModelTurn(harness);
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/gate.ts",
      edits: [{ oldText: "new", newText: "newer" }],
    });
    const freshEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/gate-revision-two.test.ts" },
        { text: "revision-two regression passed" },
      ),
    );
    await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The revised gate is enforced", evidence_refs: [freshEvidence] }],
      unresolved_failures: [],
    });
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [requirement()],
      ignored_source_prompts: [],
    });
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "Old evidence must not certify the revised implementation.",
        evidence_refs: [oldEvidence],
      }),
    ).toContain("Verdict evidence must come from mutation revision 2");
  });

  it("fails closed for a corrupted audit cursor or requirement hash", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [requirement()],
      ignored_source_prompts: [],
    });

    harness.controller.state.requirementAudit.nextRequirementIndex = 1;
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "A corrupted cursor must not issue a certificate.",
        evidence_refs: [evidenceRef],
      }),
    ).toContain("no pending requirement");

    harness.controller.state.requirementAudit.nextRequirementIndex = 0;
    harness.controller.state.requirementAudit.requirementSetHash = "corrupted";
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        requirement_id: "R1",
        passed: true,
        reason: "Valid evidence cannot repair corrupted certificate inputs.",
        evidence_refs: [evidenceRef],
      }),
    ).toContain("Requirement or source hashes changed during audit");
    expect(harness.controller.currentState.readiness?.status).toBe("evidence_ready");
  });
});
