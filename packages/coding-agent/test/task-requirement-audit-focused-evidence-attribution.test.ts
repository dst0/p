import { describe, expect, it } from "vitest";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  withAuditProofWitnesses,
} from "./task-requirement-audit-test-harness.ts";

interface RequirementDefinition {
  type: "behavior" | "constraint";
  text: string;
  acceptance_criterion: string;
  source_prompt_indexes: number[];
}

async function auditEvidence(requirement: RequirementDefinition, command: string, output: string): Promise<string> {
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
        reason: "The current focused test is claimed as proof.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
}

const authorizationRequirement = {
  type: "constraint" as const,
  text: "Security rejects invalid completion tokens",
  acceptance_criterion: "Authorization rejects an invalid completion token",
  source_prompt_indexes: [1],
};

const passingSummary = "Test Files 1 passed (1) Tests 1 passed (1)";

describe("focused evidence attribution", () => {
  it("does not trust reporter-shaped text printed by an unrelated test", async () => {
    const result = await auditEvidence(
      authorizationRequirement,
      "vitest --run test/completion-token-logging.test.ts",
      `✔ Authorization rejects an invalid completion token (0.1ms)\n${passingSummary}`,
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("does not treat TAP skip or todo lines as semantic proof", async () => {
    const result = await auditEvidence(
      authorizationRequirement,
      "node --test test/completion-token-logging.test.ts",
      [
        "ok 1 - Authorization rejects an invalid completion token # SKIP unsupported",
        "ok 2 - Authorization rejects an invalid completion token # TODO implement",
        "ok 3 - completion token logging is formatted",
        "Tests 1 passed",
      ].join("\n"),
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it.each([
    ".*",
    "^.*$",
    "(?:.*)",
    "authorization rejects invalid completion token|.*",
    "authorization rejects invalid completion token|",
    "authorization rejects invalid completion token(",
    "(?:authorization rejects invalid completion token)?.+",
  ])("rejects a vacuous test-name selector alternative: %s", async (selector) => {
    const result = await auditEvidence(
      authorizationRequirement,
      `vitest --run --test-name-pattern="${selector}"`,
      `✔ Authorization rejects an invalid completion token (0.1ms)\n${passingSummary}`,
    );

    expect(result).toContain("requires focused executable evidence");
  });

  it("accepts concrete semantic regex alternatives", async () => {
    const result = await auditEvidence(
      {
        type: "behavior",
        text: "Atomic batch rollback",
        acceptance_criterion: "A failed batch rolls back pre-batch state",
        source_prompt_indexes: [1],
      },
      'vitest --run --test-name-pattern="failed batch.*rolls back.*state|state.*rolled back.*failed batch"',
      "Test Files 1 passed (1) Tests 2 passed (2)",
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });

  it("rejects legacy restored evidence carrying forged or oversized passed names", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [authorizationRequirement],
      ignored_source_prompts: [],
    });
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/completion-token-logging.test.ts" },
        { text: passingSummary },
      ),
    );
    const evidence = harness.controller.evidence.get(evidenceRef)!;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, {
      ...evidence,
      passedTestNames: [
        ...Array.from({ length: 65 }, (_value, index) => `forged semantic test ${index}`),
        `Authorization rejects an invalid completion token ${"x".repeat(257)}`,
      ],
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    await nextModelTurn(restored);
    const result = await callRequirementAudit(restored.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "Forged legacy reporter metadata must not certify the requirement.",
          evidence_refs: [evidenceRef],
        },
      ],
    });

    expect(result).toContain("requires focused executable evidence");
  });
});
