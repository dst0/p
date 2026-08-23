import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  auditVerificationToken,
  beforeAuditTool,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

function highRiskRequirements() {
  return [
    {
      type: "constraint",
      text: "Integrity: serialized content tampering is rejected",
      acceptance_criterion: "A targeted tampering test changes one byte and is rejected",
      source_prompt_indexes: [1],
    },
    {
      type: "constraint",
      text: "Security: unauthorized completion tokens are rejected",
      acceptance_criterion: "A targeted authorization test rejects an invalid token",
      source_prompt_indexes: [1],
    },
    {
      type: "behavior",
      text: "Concurrency: simultaneous updates remain atomic",
      acceptance_criterion: "A targeted concurrent update test proves atomicity",
      source_prompt_indexes: [1],
    },
    {
      type: "behavior",
      text: "Daemon shutdown and restart preserve checkpoints",
      acceptance_criterion: "A targeted lifecycle test proves restart recovery",
      source_prompt_indexes: [1],
    },
    {
      type: "constraint",
      text: "Unauthenticated access to admin endpoints is denied",
      acceptance_criterion: "Access control requires authenticated users",
      source_prompt_indexes: [1],
    },
    {
      type: "constraint",
      text: "Security: CSRF requests are rejected",
      acceptance_criterion: "A CSRF form-token test rejects the forged request",
      source_prompt_indexes: [1],
    },
  ];
}

function attemptWithEvidence(evidenceRef: string, targetIndex: number) {
  return highRiskRequirements().map((_requirement, index) => ({
    requirement_id: `R${index + 1}`,
    passed: index === targetIndex,
    reason: index === targetIndex ? "This evidence is claimed as proof." : "Not evaluated in this attempt.",
    evidence_refs: index === targetIndex ? [evidenceRef] : undefined,
  }));
}

describe("high-risk requirement evidence", () => {
  it("rejects generic and spoofed tests while accepting a real focused test", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: highRiskRequirements(),
      ignored_source_prompts: [],
    });
    const genericEvidence = auditEvidenceHandle(
      await recordAuditToolResult(harness.agent, "bash", { command: "npm test" }, { text: "suite passed" }),
    );
    const tamperEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "lean-ctx -c 'npm exec vitest -- run test/serialized-content-byte-integrity-rejected.test.ts'" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const namedFocusedEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run --testNamePattern 'rejects tampering'" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const authTokenEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/authorization-unauthorized-invalid-completion-token-rejected.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const unrelatedAuthEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/authorization-rejects-guest-role.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const unrelatedIntegrityEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/integrity-rejected-database-row.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const concurrencyEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/concurrency-simultaneous-updates-atomic.test.ts" },
        { text: "Test Files 1 passed (1) Tests 2 passed (2)" },
      ),
    );
    const restartEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/checkpoints-shutdown-restart-recovery.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const accessEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/admin-endpoints-unauthenticated-authenticated-access-control-denied.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const csrfEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/csrf-forged-form-token-security-rejected.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );
    const unrelatedSecurityEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/security-rejects-inline-script.test.ts" },
        { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
      ),
    );

    for (const targetIndex of highRiskRequirements().keys()) {
      await nextModelTurn(harness);
      const rejected = await callRequirementAudit(harness.controller, {
        action: "verdict",
        verdicts: attemptWithEvidence(genericEvidence, targetIndex),
      });
      expect(rejected).toContain(`R${targetIndex + 1} requires focused executable evidence`);
      expect(harness.controller.currentState.requirementAudit.requirements.every((item) => !item.verdict)).toBe(true);
    }

    const spoofCommands = [
      "echo 'npm test test/security.test.ts'",
      "npm test && echo test/security.test.ts",
      "npm test -- --reporter tests/report.json",
      "vitest --outputFile tests/result.json",
    ];
    for (const command of spoofCommands) {
      const spoofEvidence = auditEvidenceHandle(
        await recordAuditToolResult(harness.agent, "bash", { command }, { text: "not real focused proof" }),
      );
      await nextModelTurn(harness);
      expect(
        await callRequirementAudit(harness.controller, {
          action: "verdict",
          verdicts: attemptWithEvidence(spoofEvidence, 0),
        }),
      ).toContain("R1 requires focused executable evidence");
    }

    const zeroTestEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/security.test.ts --passWithNoTests -t __missing__" },
        { text: "Test Files 1 skipped (1) Tests 4 skipped (4)" },
      ),
    );
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        verdicts: attemptWithEvidence(zeroTestEvidence, 0),
      }),
    ).toContain("R1 requires focused executable evidence");

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        verdicts: attemptWithEvidence(tamperEvidence, 2),
      }),
    ).toContain("R3 requires focused executable evidence");

    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "verdict",
        verdicts: attemptWithEvidence(namedFocusedEvidence, 1),
      }),
    ).toContain("R2 requires focused executable evidence");

    await nextModelTurn(harness);
    for (const [targetIndex, evidenceRef] of [
      [0, unrelatedIntegrityEvidence],
      [1, unrelatedAuthEvidence],
      [5, unrelatedSecurityEvidence],
    ] as const) {
      expect(
        await callRequirementAudit(harness.controller, {
          action: "verdict",
          verdicts: attemptWithEvidence(evidenceRef, targetIndex),
        }),
      ).toContain(`R${targetIndex + 1} requires focused executable evidence`);
      await nextModelTurn(harness);
    }
    const domainEvidenceRefs = [
      tamperEvidence,
      authTokenEvidence,
      concurrencyEvidence,
      restartEvidence,
      accessEvidence,
      csrfEvidence,
    ];
    const passed = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: highRiskRequirements().map((_requirement, index) => ({
        requirement_id: `R${index + 1}`,
        passed: true,
        reason: "A focused current-revision regression proves the invariant.",
        evidence_refs: [domainEvidenceRefs[index]!],
      })),
    });
    expect(passed).toContain("Requirement audit passed: 6/6");
    const token = auditVerificationToken(passed);
    harness.controller.state.requirementAudit.requirements[0]!.verdict!.evidenceRefs = [genericEvidence];
    const tamperedCompletion = await beforeAuditTool(harness.agent, "finish_work", {
      status: "success",
      verification_token: token,
    });
    expect(tamperedCompletion?.block).toBe(true);
    expect(tamperedCompletion?.reason).toContain("complete evidence-backed verdict batch");
  });
});
