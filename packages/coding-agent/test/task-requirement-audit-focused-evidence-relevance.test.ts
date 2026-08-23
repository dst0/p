import { describe, expect, it } from "vitest";
import type { RequirementAuditInput } from "../src/core/task-verification/types.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  withAuditProofWitnesses,
} from "./task-requirement-audit-test-harness.ts";

type RequirementDefinition = NonNullable<RequirementAuditInput["requirements"]>[number];

async function auditFocusedEvidence(
  requirement: RequirementDefinition,
  command: string,
  output = "Test Files 1 passed (1) Tests 1 passed (1)",
): Promise<string> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [requirement],
    ignored_source_prompts: [],
  });
  const definedRequirement = harness.controller.currentState.requirementAudit.requirements[0]!;
  const evidenceRef = auditEvidenceHandle(
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command },
      { text: withAuditProofWitnesses(output, definedRequirement) },
    ),
  );
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "The focused test is claimed as proof.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
}

describe("focused high-risk evidence relevance", () => {
  it.each([
    {
      requirement: {
        type: "constraint" as const,
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      command: "vitest --run test/authorization-invalid-completion-token-logging.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Integrity: serialized content tampering is rejected",
        acceptance_criterion: "A one-byte change to serialized content is rejected",
        source_prompt_indexes: [1],
      },
      command: "vitest --run test/integrity-serialized-content-logging.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Security: CSRF requests are rejected",
        acceptance_criterion: "A CSRF form token rejects a forged request",
        source_prompt_indexes: [1],
      },
      command: "vitest --run test/csrf-form-preview.test.ts",
    },
  ])("rejects same-object evidence for a conflicting behavior: $command", async ({ requirement, command }) => {
    expect(await auditFocusedEvidence(requirement, command)).toContain("requires focused executable evidence");
  });

  it("accepts evidence that includes the required behavior alongside another behavior", async () => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      "vitest --run test/unauthorized-invalid-completion-token-validation-rejects.test.ts",
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });

  it("requires the selector to preserve the requirement input polarity", async () => {
    const requirement = {
      type: "constraint" as const,
      text: "Security: unauthorized completion tokens are rejected",
      acceptance_criterion: "Authorization rejects an invalid completion token",
      source_prompt_indexes: [1],
    };
    expect(
      await auditFocusedEvidence(requirement, "vitest --run test/authorization-rejects-valid-completion-token.test.ts"),
    ).toContain("requires focused executable evidence");
    expect(
      await auditFocusedEvidence(
        requirement,
        "vitest --run test/authorization-rejects-invalid-unauthorized-completion-token.test.ts",
      ),
    ).toContain("Requirement audit passed: 1/1");
  });

  it.each([
    {
      command: "vitest --run --testNamePattern 'authorization rejects invalid unauthorized completion token'",
      output: "Test Files 1 passed (1) Tests 1 passed (1)",
    },
    {
      command: "vitest --run test/authorization-rejects-invalid-unauthorized-completion-token.test.ts",
      output: "Tests: 1 passed (1) Tests: 0 failed (0)",
    },
  ])("accepts a matching selector with an unambiguously passing result: $command", async ({ command, output }) => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      command,
      output,
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });

  it.each([
    {
      command: "vitest --run test/authorization/rejects/completion-token-logging.test.ts",
      output: "Test Files 1 passed (1) Tests 1 passed (1)",
    },
    {
      command: "AUTHORIZATION_RESULT=rejects vitest --run test/completion-token-logging.test.ts",
      output: "Test Files 1 passed (1) Tests 1 passed (1)",
    },
    {
      command: "vitest --run test/completion-token-logging.test.ts",
      output: "Authorization rejects the invalid completion token. Test Files 1 passed (1) Tests 1 passed (1)",
    },
  ])("does not take domain or behavior proof from command/output context: $command", async ({ command, output }) => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      command,
      output,
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("does not treat arbitrary stdout as semantic evidence", async () => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      "vitest --run test/completion-token-logging.test.ts",
      "Authorization rejects the invalid unauthorized completion token. Tests 1 passed (1)",
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("uses an explicit test-name selector instead of a better-looking file path", async () => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      "vitest --run test/authorization-invalid-completion-token-rejected.test.ts --testNamePattern 'logs valid completion token'",
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("does not assemble one invariant from separate test-file selectors", async () => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      "vitest --run test/authorization-invalid-completion-token.test.ts test/rejected-behavior.test.ts",
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it.each([
    {
      requirement: {
        type: "behavior" as const,
        text: "Idempotent command retry",
        acceptance_criterion: "A duplicate commandId retry returns the original result",
        source_prompt_indexes: [1],
      },
      unrelated: "vitest --run test/idempotency-duplicate-commandId-original-result-audited.test.ts",
      matching: "vitest --run test/idempotency-duplicate-commandId-retry-returns-original-result.test.ts",
    },
    {
      requirement: {
        type: "behavior" as const,
        text: "Atomic batch rollback",
        acceptance_criterion: "A failed batch rolls back pre-batch state",
        source_prompt_indexes: [1],
      },
      unrelated: "vitest --run test/atomic-failed-batch-validates-pre-batch-state.test.ts",
      matching: "vitest --run test/atomic-failed-batch-rolls-back-pre-batch-state.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Idempotency rejects commandId reuse",
        acceptance_criterion: "A reused commandId throws ValidationError",
        source_prompt_indexes: [1],
      },
      unrelated: "vitest --run test/idempotency-reused-commandId-validationError-logged.test.ts",
      matching: "vitest --run test/idempotency-reused-commandId-throws-validationError.test.ts",
    },
  ])("matches the observable high-risk behavior: $matching", async ({ requirement, unrelated, matching }) => {
    expect(await auditFocusedEvidence(requirement, unrelated)).toContain("requires focused executable evidence");
    expect(await auditFocusedEvidence(requirement, matching)).toContain("Requirement audit passed: 1/1");
  });

  it.each([
    "=== RUN rejects unauthorized completion token",
    "Tests 1 failed (1)",
    "Tests 1 passed (1) Tests 1 failed (1)",
    "Test Files 1 passed (1) Failed Tests 1",
    "Test Files 1 passed (1) Tests 4 skipped (4)",
    "--- FAIL: rejects unauthorized completion token",
  ])("rejects non-passing or contradictory test output: %s", async (output) => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Security: unauthorized completion tokens are rejected",
        acceptance_criterion: "Authorization rejects an invalid completion token",
        source_prompt_indexes: [1],
      },
      "vitest --run test/authorization-rejects-invalid-completion-token.test.ts",
      output,
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("accepts a concise invariant when its selector names the domain and behavior", async () => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Access is denied",
        acceptance_criterion: "Authorization required",
        source_prompt_indexes: [1],
      },
      "vitest --run test/access-denied.test.ts",
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });

  it.each([
    "vitest --run test/checksum-integrity-preserved.test.ts",
    "vitest --run test/logging/checksum-integrity-preserved.test.ts",
  ])("accepts concise evidence with its only meaningful concrete term: %s", async (command) => {
    const result = await auditFocusedEvidence(
      {
        type: "constraint",
        text: "Integrity is preserved",
        acceptance_criterion: "A checksum test passes",
        source_prompt_indexes: [1],
      },
      command,
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });
});
